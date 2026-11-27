import { isValidUuid, validateUserId } from '@/domain/value-objects/Identifiers';

export const SYNC_LOCK_PREFIX = 'laxmilens_sync_';
export const SYNC_CHANNEL_PREFIX = 'laxmilens_sync_';

export type CrossTabSyncEventType = 'syncStarted' | 'syncCompleted' | 'restoreCompleted';

export interface CrossTabSyncMessage {
  readonly type: CrossTabSyncEventType;
  readonly userId: string;
  readonly sessionGeneration: number;
  readonly sourceTabId: string;
  readonly timestamp: string;
  readonly syncedCount?: number;
  readonly pulledCount?: number;
  readonly failedCount?: number;
}

export interface WebLockRequestOptions {
  mode?: 'exclusive' | 'shared';
  ifAvailable?: boolean;
}

export interface WebLockProvider {
  request<T>(
    name: string,
    options: WebLockRequestOptions,
    callback: (lock: unknown | null) => Promise<T>
  ): Promise<T>;
}

export interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  addEventListener?(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener?(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
}

export type BroadcastChannelFactory = (name: string) => BroadcastChannelLike;

const VALID_EVENT_TYPES: ReadonlySet<string> = new Set([
  'syncStarted',
  'syncCompleted',
  'restoreCompleted'
]);

export function getUserSyncLockName(userId: string): string {
  return `${SYNC_LOCK_PREFIX}${validateUserId(userId)}`;
}

export function getUserSyncChannelName(userId: string): string {
  return `${SYNC_CHANNEL_PREFIX}${validateUserId(userId)}`;
}

export function resolveDefaultWebLockProvider(): WebLockProvider | null {
  if (
    typeof navigator !== 'undefined' &&
    navigator.locks &&
    typeof navigator.locks.request === 'function'
  ) {
    return {
      request<T>(
        name: string,
        options: WebLockRequestOptions,
        callback: (lock: unknown | null) => Promise<T>
      ): Promise<T> {
        return navigator.locks.request(
          name,
          options,
          ((lock: unknown) => callback(lock)) as unknown as (lock: Lock | null) => T
        );
      }
    };
  }
  return null;
}

export function resolveDefaultBroadcastChannelFactory(): BroadcastChannelFactory | null {
  if (typeof BroadcastChannel === 'function') {
    return (name: string) => new BroadcastChannel(name);
  }
  return null;
}

export function parseValidatedCrossTabMessage(
  raw: unknown
): CrossTabSyncMessage | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate.type !== 'string' ||
    !VALID_EVENT_TYPES.has(candidate.type)
  ) {
    return null;
  }

  if (typeof candidate.userId !== 'string' || !isValidUuid(candidate.userId)) {
    return null;
  }

  if (
    typeof candidate.sourceTabId !== 'string' ||
    candidate.sourceTabId.trim().length === 0
  ) {
    return null;
  }

  if (
    typeof candidate.sessionGeneration !== 'number' ||
    !Number.isSafeInteger(candidate.sessionGeneration) ||
    candidate.sessionGeneration < 1
  ) {
    return null;
  }

  if (
    typeof candidate.timestamp !== 'string' ||
    Number.isNaN(Date.parse(candidate.timestamp))
  ) {
    return null;
  }

  return {
    type: candidate.type as CrossTabSyncEventType,
    userId: validateUserId(candidate.userId),
    sessionGeneration: candidate.sessionGeneration,
    sourceTabId: candidate.sourceTabId.trim(),
    timestamp: candidate.timestamp,
    ...(typeof candidate.syncedCount === 'number' ? { syncedCount: candidate.syncedCount } : {}),
    ...(typeof candidate.pulledCount === 'number' ? { pulledCount: candidate.pulledCount } : {}),
    ...(typeof candidate.failedCount === 'number' ? { failedCount: candidate.failedCount } : {})
  };
}

export class CrossTabSyncCoordinator {
  public readonly tabId: string;
  private channel: BroadcastChannelLike | null = null;
  private channelUserId: string | null = null;
  private messageHandler: ((event: MessageEvent<unknown>) => void) | null = null;
  private readonly lastSeenGenerationByTab = new Map<string, number>();
  private disposed = false;

  constructor(
    private readonly options: {
      lockProvider?: WebLockProvider | null;
      broadcastChannelFactory?: BroadcastChannelFactory | null;
      tabId?: string;
    } = {}
  ) {
    this.tabId =
      options.tabId ??
      (typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `tab-${Math.random().toString(36).slice(2)}`);
  }

  private getLockProvider(): WebLockProvider | null {
    if (this.options.lockProvider !== undefined) {
      return this.options.lockProvider;
    }
    return resolveDefaultWebLockProvider();
  }

  private getChannelFactory(): BroadcastChannelFactory | null {
    if (this.options.broadcastChannelFactory !== undefined) {
      return this.options.broadcastChannelFactory;
    }
    return resolveDefaultBroadcastChannelFactory();
  }

  /**
   * Acquires the per-user Web Lock `laxmilens_sync_<userId>` when supported,
   * falling back cleanly to running directly when Web Locks are unavailable.
   */
  public async runWithExclusiveLock<T>(params: {
    userId: string;
    ifAvailable?: boolean;
    onContention: () => T | Promise<T>;
    work: () => Promise<T>;
  }): Promise<T> {
    const lockProvider = this.getLockProvider();
    if (!lockProvider) {
      return await params.work();
    }

    const lockName = getUserSyncLockName(params.userId);
    const ifAvailable = params.ifAvailable ?? true;

    return await lockProvider.request(
      lockName,
      { mode: 'exclusive', ifAvailable },
      async (lock) => {
        if (!lock) {
          return await params.onContention();
        }
        return await params.work();
      }
    );
  }

  /**
   * Binds a per-user BroadcastChannel for cross-tab notifications while validating
   * message user ownership, active session checks, and monotonic sender generation.
   */
  public bindUserChannel(params: {
    userId: string;
    isSessionValid: (userId: string) => boolean;
    onMessage: (message: CrossTabSyncMessage) => void;
  }): void {
    if (this.disposed) {
      return;
    }

    const validatedUserId = validateUserId(params.userId);
    if (this.channel && this.channelUserId === validatedUserId) {
      return;
    }

    this.closeChannel();

    const factory = this.getChannelFactory();
    if (!factory) {
      return;
    }

    try {
      const channelName = getUserSyncChannelName(validatedUserId);
      const channel = factory(channelName);
      const handler = (event: MessageEvent<unknown>) => {
        if (this.disposed || this.channelUserId !== validatedUserId) {
          return;
        }

        const parsed = parseValidatedCrossTabMessage(event?.data);
        if (!parsed) {
          return;
        }

        // Ignore same-tab echo or cross-user messages
        if (parsed.sourceTabId === this.tabId || parsed.userId !== validatedUserId) {
          return;
        }

        if (!params.isSessionValid(validatedUserId)) {
          return;
        }

        const previousGen = this.lastSeenGenerationByTab.get(parsed.sourceTabId);
        if (previousGen !== undefined && parsed.sessionGeneration < previousGen) {
          return;
        }
        this.lastSeenGenerationByTab.set(parsed.sourceTabId, parsed.sessionGeneration);

        params.onMessage(parsed);
      };

      if (typeof channel.addEventListener === 'function') {
        channel.addEventListener('message', handler);
      } else {
        channel.onmessage = handler;
      }

      this.channel = channel;
      this.channelUserId = validatedUserId;
      this.messageHandler = handler;
    } catch {
      this.closeChannel();
    }
  }

  public broadcast(params: {
    type: CrossTabSyncEventType;
    userId: string;
    sessionGeneration: number;
    syncedCount?: number;
    pulledCount?: number;
    failedCount?: number;
  }): void {
    if (this.disposed) {
      return;
    }

    let validatedUserId: string;
    try {
      validatedUserId = validateUserId(params.userId);
    } catch {
      return;
    }

    if (!this.channel || this.channelUserId !== validatedUserId) {
      return;
    }

    const message: CrossTabSyncMessage = {
      type: params.type,
      userId: validatedUserId,
      sessionGeneration: Math.max(1, Math.floor(params.sessionGeneration)),
      sourceTabId: this.tabId,
      timestamp: new Date().toISOString(),
      ...(params.syncedCount !== undefined ? { syncedCount: params.syncedCount } : {}),
      ...(params.pulledCount !== undefined ? { pulledCount: params.pulledCount } : {}),
      ...(params.failedCount !== undefined ? { failedCount: params.failedCount } : {})
    };

    try {
      this.channel.postMessage(message);
    } catch {
      // Ignore BroadcastChannel postMessage failures after tab unload/close
    }
  }

  public closeChannel(): void {
    const channel = this.channel;
    const handler = this.messageHandler;
    this.channel = null;
    this.channelUserId = null;
    this.messageHandler = null;
    this.lastSeenGenerationByTab.clear();

    if (channel) {
      try {
        if (handler && typeof channel.removeEventListener === 'function') {
          channel.removeEventListener('message', handler);
        } else {
          channel.onmessage = null;
        }
        channel.close();
      } catch {
        // Ignore close errors
      }
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.closeChannel();
  }
}

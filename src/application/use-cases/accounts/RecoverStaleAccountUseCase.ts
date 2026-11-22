import { LaxmiLensDB, db } from '@/infrastructure/database/local/DexieDatabase';
import {
  ISupabaseAccountRepository,
  SupabaseAccountRepository
} from '@/infrastructure/database/cloud/repositories/SupabaseAccountRepository';
import { AuthPort } from '@/application/ports/AuthPort';
import { defaultAuthAdapter } from '@/infrastructure/auth/SupabaseAuthAdapter';
import { SyncAuthError } from '@/infrastructure/sync/errors/SyncErrors';
import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';

export const TARGET_RECOVERY_ACCOUNT_ID = 'ee20c2ca-c698-47c5-9daf-e96c88c61dfb';

export interface RecoveryAccountState {
  isArchived: boolean;
  version: number;
  name: string;
}

export interface RecoveryInspectionResult {
  accountId: string;
  canRecover: boolean;
  isAlreadyRecovered: boolean;
  blockReason?: string;
  local: RecoveryAccountState | null;
  cloud: RecoveryAccountState;
  pendingOutboxRecords: LocalOutboxRecord[];
  staleRestoreRecord: LocalOutboxRecord | null;
}

export interface RecoveryExecutionResult {
  success: boolean;
  alreadyRecovered: boolean;
  accountId: string;
  before: {
    local: RecoveryAccountState;
    cloud: RecoveryAccountState;
    pendingOutboxCount: number;
  };
  after: {
    local: RecoveryAccountState;
    deletedOutboxRecordId?: number;
    remainingOutboxCount: number;
  };
  message: string;
}

/**
 * RecoverStaleAccountUseCase
 *
 * Narrowly scoped, developer-only recovery use case for accounts whose remote archive
 * committed to Supabase (v3, is_archived = true) but whose local IndexedDB state stagnated
 * at v2 (isArchived = false), leaving a stale restore event (v3, is_archived = false).
 *
 * Safety Invariants:
 * 1. Strict authentication & cross-tenant ownership check.
 * 2. Pre-flight verification of exact cloud state (is_archived = true, version = 3).
 * 3. Pre-flight verification of local account state.
 * 4. Refuses recovery if an unacknowledged archive event is still pending in outbox.
 * 5. Single atomic Dexie read-write transaction covering [accounts, syncOutbox].
 * 6. Deletes ONLY the confirmed stale restore event. Unrelated outbox events are untouched.
 * 7. Zero remote cloud mutations (strictly read-only from Supabase perspective).
 * 8. Idempotent: repeated recovery is a safe no-op.
 */
export class RecoverStaleAccountUseCase {
  constructor(
    private readonly cloudAccountRepo: ISupabaseAccountRepository = new SupabaseAccountRepository(),
    private readonly database: LaxmiLensDB = db,
    private readonly authPort: AuthPort = defaultAuthAdapter
  ) {}

  /**
   * Performs read-only inspection of local and cloud states without making any mutations.
   */
  public async inspect(accountId: string = TARGET_RECOVERY_ACCOUNT_ID): Promise<RecoveryInspectionResult> {
    const currentUser = await this.authPort.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      throw new SyncAuthError('Recovery inspection aborted: User is not authenticated.');
    }

    // 1. Fetch cloud account
    const cloudAccount = await this.cloudAccountRepo.findById(accountId);
    if (!cloudAccount) {
      throw new Error(`Recovery aborted: Account '${accountId}' not found in Supabase cloud.`);
    }

    if (cloudAccount.user_id !== currentUser.id) {
      throw new SyncAuthError(`Recovery aborted: Cloud account '${accountId}' belongs to a different user.`);
    }

    const cloudState: RecoveryAccountState = {
      isArchived: cloudAccount.is_archived,
      version: cloudAccount.version,
      name: cloudAccount.name
    };

    // 2. Fetch local account
    const localRecord = await this.database.accounts.get(accountId);
    const localState: RecoveryAccountState | null = localRecord
      ? {
          isArchived: localRecord.isArchived,
          version: localRecord.version,
          name: localRecord.name
        }
      : null;

    // 3. Inspect outbox records for this account
    const allOutbox = await this.database.syncOutbox.toArray();
    const accountOutbox = allOutbox.filter(
      (entry) => entry.entity === 'accounts' && entry.entityId === accountId
    );

    const pendingArchiveEvent = accountOutbox.find(
      (entry) => entry.operation === 'UPDATE' && entry.payload?.is_archived === true
    );

    const staleRestoreRecord =
      accountOutbox.find(
        (entry) =>
          entry.operation === 'UPDATE' &&
          entry.payload?.is_archived === false &&
          entry.payload?.version === 3
      ) || null;

    const isAlreadyRecovered = Boolean(
      localState && localState.isArchived === true && localState.version === 3 && !staleRestoreRecord
    );

    let canRecover = true;
    let blockReason: string | undefined;

    if (!localRecord) {
      canRecover = false;
      blockReason = `Local account '${accountId}' not found in IndexedDB.`;
    } else if (cloudAccount.version !== 3 || !cloudAccount.is_archived) {
      canRecover = false;
      blockReason = `Cloud account state is unexpected: is_archived = ${cloudAccount.is_archived}, version = ${cloudAccount.version}. Expected is_archived = true, version = 3.`;
    } else if (pendingArchiveEvent) {
      canRecover = false;
      blockReason = `Unacknowledged archive event (outbox ID ${pendingArchiveEvent.id}) is still pending in outbox. Resolve archive sync first.`;
    } else if (!isAlreadyRecovered && (localRecord.version !== 2 || localRecord.isArchived !== false)) {
      canRecover = false;
      blockReason = `Local account state is unexpected: isArchived = ${localRecord.isArchived}, version = ${localRecord.version}. Expected isArchived = false, version = 2.`;
    }

    return {
      accountId,
      canRecover,
      isAlreadyRecovered,
      blockReason,
      local: localState,
      cloud: cloudState,
      pendingOutboxRecords: accountOutbox,
      staleRestoreRecord
    };
  }

  /**
   * Executes the atomic recovery procedure in local IndexedDB.
   */
  public async execute(accountId: string = TARGET_RECOVERY_ACCOUNT_ID): Promise<RecoveryExecutionResult> {
    const inspection = await this.inspect(accountId);

    if (inspection.isAlreadyRecovered) {
      const remainingOutbox = await this.database.syncOutbox.toArray();
      return {
        success: true,
        alreadyRecovered: true,
        accountId,
        before: {
          local: inspection.local!,
          cloud: inspection.cloud,
          pendingOutboxCount: inspection.pendingOutboxRecords.length
        },
        after: {
          local: inspection.local!,
          remainingOutboxCount: remainingOutbox.length
        },
        message: `Account '${accountId}' is already fully recovered (isArchived = true, version = 3). No changes were made.`
      };
    }

    if (!inspection.canRecover) {
      throw new Error(inspection.blockReason || 'Recovery pre-flight validation failed.');
    }

    const localBefore = inspection.local!;
    const cloudBefore = inspection.cloud;
    const staleRestoreEvent = inspection.staleRestoreRecord;
    const deletedRecordId = typeof staleRestoreEvent?.id === 'number' ? staleRestoreEvent.id : undefined;

    // Single Dexie read-write transaction covering [accounts, syncOutbox]
    await this.database.transaction('rw', [this.database.accounts, this.database.syncOutbox], async () => {
      // 1. Update local account state to match verified cloud archive state (version 3, isArchived = true)
      await this.database.accounts.update(accountId, {
        isArchived: true,
        version: 3,
        status: 'archived',
        updatedAt: new Date().toISOString()
      });

      // 2. Remove ONLY the confirmed stale restore event that would incorrectly restore at version 3
      if (deletedRecordId !== undefined) {
        await this.database.syncOutbox.delete(deletedRecordId);
      }
    });

    const localAfterRecord = await this.database.accounts.get(accountId);
    const localAfter: RecoveryAccountState = {
      isArchived: localAfterRecord!.isArchived,
      version: localAfterRecord!.version,
      name: localAfterRecord!.name
    };

    const remainingOutbox = await this.database.syncOutbox.toArray();

    return {
      success: true,
      alreadyRecovered: false,
      accountId,
      before: {
        local: localBefore,
        cloud: cloudBefore,
        pendingOutboxCount: inspection.pendingOutboxRecords.length
      },
      after: {
        local: localAfter,
        deletedOutboxRecordId: deletedRecordId,
        remainingOutboxCount: remainingOutbox.length
      },
      message: `Account '${accountId}' successfully reconciled with cloud state. Local version advanced to 3, isArchived set to true, and stale restore outbox event ${deletedRecordId ? `(ID ${deletedRecordId})` : ''} removed.`
    };
  }
}

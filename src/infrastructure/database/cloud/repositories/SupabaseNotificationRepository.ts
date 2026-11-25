import { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';
import {
  CloudNotificationRow,
  NotificationRowMapper,
  normalizeAndValidateCloudMetadata
} from '../mappers/NotificationRowMapper';
import {
  isCompatibleNotificationCategoryProgression,
  NOTIFICATION_CATEGORY_RANK,
  NOTIFICATION_SEVERITY_RANK
} from '@/domain/services/NotificationIdentityService';
import { isValidUuid, validateUserId } from '@/domain/value-objects/Identifiers';
import {
  SyncAuthError,
  SyncConflictError,
  SyncDatabaseError
} from '@/infrastructure/sync/errors/SyncErrors';

export interface NotificationQueryOptions {
  includeDeleted?: boolean;
}

export interface ISupabaseNotificationRepository {
  insert(notification: CloudNotificationRow): Promise<CloudNotificationRow>;
  updatePartial(
    id: string,
    userId: string,
    patch: Partial<CloudNotificationRow>,
    expectedVersion: number
  ): Promise<CloudNotificationRow>;
  softDelete(
    id: string,
    userId: string,
    deletedAt: string,
    expectedVersion: number,
    targetVersion?: number
  ): Promise<CloudNotificationRow>;
  findById(
    id: string,
    userId: string,
    options?: NotificationQueryOptions
  ): Promise<CloudNotificationRow | null>;
  findByDedupeKey(
    userId: string,
    dedupeKey: string,
    options?: NotificationQueryOptions
  ): Promise<CloudNotificationRow | null>;
  findAll(
    userId: string,
    options?: NotificationQueryOptions
  ): Promise<CloudNotificationRow[]>;
}

function areMetadataObjectsEqual(left: unknown, right: unknown): boolean {
  const a = normalizeAndValidateCloudMetadata(left) as Record<string, unknown>;
  const b = normalizeAndValidateCloudMetadata(right) as Record<string, unknown>;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => a[k] === b[k]);
}

function areTimestampsEqual(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return new Date(a).getTime() === new Date(b).getTime();
}

export class SupabaseNotificationRepository implements ISupabaseNotificationRepository {
  constructor(private readonly client: SupabaseClient = supabase) {}

  public async insert(notification: CloudNotificationRow): Promise<CloudNotificationRow> {
    if (!notification.user_id || notification.user_id.trim().length === 0) {
      throw new SyncAuthError('Cannot insert notification: user_id is missing or unauthenticated.');
    }

    NotificationRowMapper.validateCloudRow(notification);
    if (notification.deleted_at !== null && notification.deleted_at !== undefined) {
      throw new Error('Cannot insert a notification with deleted_at already set.');
    }
    if (notification.version !== 1) {
      throw new SyncConflictError(
        `Cannot insert notification '${notification.id}': initial version must be 1, got ${notification.version}.`
      );
    }

    const { data, error } = await this.client
      .from('notifications')
      .insert(notification)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return await this.reconcileDuplicateInsert(notification);
      }
      if (error.code === '23514' || error.code === '40001') {
        throw new SyncConflictError(error.message);
      }
      if (error.code === '42501') {
        throw new SyncDatabaseError(
          'RLS permission denied: Cannot insert notification for this user context.',
          '42501',
          error
        );
      }
      throw new SyncDatabaseError(
        `Failed to insert notification '${notification.id}': ${error.message}`,
        error.code,
        error
      );
    }

    if (!data) {
      throw new SyncDatabaseError('Insert succeeded but no notification row was returned.');
    }

    const verified = data as CloudNotificationRow;
    NotificationRowMapper.validateCloudRow(verified);
    this.verifyPersistedIdentity(verified, notification.id, notification.user_id);
    return verified;
  }

  public async updatePartial(
    id: string,
    userId: string,
    patch: Partial<CloudNotificationRow>,
    expectedVersion: number
  ): Promise<CloudNotificationRow> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot update notification: userId is missing.');
    }
    const validatedUserId = validateUserId(userId);
    if (!isValidUuid(id)) {
      throw new Error(`Invalid notification ID '${id}': must be a valid UUID.`);
    }
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error(`Invalid expectedVersion '${expectedVersion}' for notification update.`);
    }

    const targetVersion = patch.version ?? expectedVersion + 1;
    if (!Number.isSafeInteger(targetVersion) || targetVersion !== expectedVersion + 1) {
      throw new Error(
        `Invalid target version '${targetVersion}' for expectedVersion '${expectedVersion}'.`
      );
    }

    const sanitizedPatch: Partial<CloudNotificationRow> = {
      ...patch,
      version: targetVersion,
      updated_at: patch.updated_at ?? new Date().toISOString()
    };
    delete (sanitizedPatch as Record<string, unknown>).id;
    delete (sanitizedPatch as Record<string, unknown>).user_id;
    delete (sanitizedPatch as Record<string, unknown>).dedupe_key;
    delete (sanitizedPatch as Record<string, unknown>).created_at;
    delete (sanitizedPatch as Record<string, unknown>).deleted_at;

    const { data, error } = await this.client
      .from('notifications')
      .update(sanitizedPatch)
      .eq('id', id)
      .eq('user_id', validatedUserId)
      .eq('version', expectedVersion)
      .is('deleted_at', null)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === '40001' || error.code === '23514') {
        throw new SyncConflictError(
          `Conflict or monotonic invariant violation updating notification '${id}': ${error.message}`
        );
      }
      if (error.code === '42501') {
        throw new SyncDatabaseError(
          'RLS permission denied: Cannot update notification for this user context.',
          '42501',
          error
        );
      }
      throw new SyncDatabaseError(
        `Failed to update notification '${id}': ${error.message}`,
        error.code,
        error
      );
    }

    if (data) {
      const verified = data as CloudNotificationRow;
      NotificationRowMapper.validateCloudRow(verified);
      this.verifyPersistedIdentity(verified, id, validatedUserId, targetVersion);
      return verified;
    }

    const existing = await this.findById(id, validatedUserId, { includeDeleted: true });
    if (!existing) {
      throw new SyncConflictError(
        `Notification '${id}' was not found in cloud or is inaccessible.`
      );
    }
    if (existing.user_id !== validatedUserId) {
      throw new SyncConflictError(
        `Notification '${id}' belongs to another user.`,
        existing
      );
    }
    if (existing.deleted_at !== null && existing.deleted_at !== undefined) {
      throw new SyncConflictError(
        `Notification '${id}' was deleted (tombstoned) in cloud and cannot be updated.`,
        existing
      );
    }

    if (
      existing.version === targetVersion &&
      this.arePatchFieldsMatching(existing, sanitizedPatch)
    ) {
      return existing;
    }

    throw new SyncConflictError(
      `Optimistic concurrency conflict updating notification '${id}': cloud version is ${existing.version}, expected previous version ${expectedVersion}.`,
      existing
    );
  }

  public async softDelete(
    id: string,
    userId: string,
    deletedAt: string,
    expectedVersion: number,
    targetVersion?: number
  ): Promise<CloudNotificationRow> {
    const validatedUserId = validateUserId(userId);
    if (!isValidUuid(id)) {
      throw new Error(`Invalid notification ID '${id}'.`);
    }
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error(`Invalid expectedVersion '${expectedVersion}' for notification delete.`);
    }

    const parsedDeleted = new Date(deletedAt);
    if (isNaN(parsedDeleted.getTime())) {
      throw new Error(`Invalid deletedAt '${deletedAt}' for notification softDelete.`);
    }
    const resolvedDeletedAt = parsedDeleted.toISOString();
    const resolvedTargetVersion = targetVersion ?? expectedVersion + 1;
    if (resolvedTargetVersion !== expectedVersion + 1) {
      throw new Error(
        `Invalid targetVersion '${resolvedTargetVersion}' for expectedVersion '${expectedVersion}'.`
      );
    }

    const { data, error } = await this.client
      .from('notifications')
      .update({
        deleted_at: resolvedDeletedAt,
        version: resolvedTargetVersion,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('user_id', validatedUserId)
      .eq('version', expectedVersion)
      .is('deleted_at', null)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === '40001' || error.code === '23514') {
        throw new SyncConflictError(error.message);
      }
      throw new SyncDatabaseError(
        `Failed to delete notification '${id}': ${error.message}`,
        error.code,
        error
      );
    }

    if (data) {
      const verified = data as CloudNotificationRow;
      NotificationRowMapper.validateCloudRow(verified);
      this.verifyPersistedIdentity(verified, id, validatedUserId, resolvedTargetVersion);
      return verified;
    }

    const current = await this.findById(id, validatedUserId, { includeDeleted: true });
    if (!current) {
      throw new SyncConflictError(`Notification '${id}' not found in cloud for delete.`);
    }
    if (current.deleted_at && current.version === resolvedTargetVersion) {
      return current;
    }

    throw new SyncConflictError(
      `Conflict deleting notification '${id}' (cloud version ${current.version}, expected ${expectedVersion}).`,
      current
    );
  }

  public async findById(
    id: string,
    userId: string,
    options: NotificationQueryOptions = {}
  ): Promise<CloudNotificationRow | null> {
    const validatedUserId = validateUserId(userId);
    if (!isValidUuid(id)) {
      return null;
    }

    let query = this.client
      .from('notifications')
      .select('*')
      .eq('id', id)
      .eq('user_id', validatedUserId);

    if (!options.includeDeleted) {
      query = query.is('deleted_at', null);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new SyncDatabaseError(error.message, error.code, error);
    }
    if (!data) return null;

    const row = data as CloudNotificationRow;
    NotificationRowMapper.validateCloudRow(row);
    if (row.user_id !== validatedUserId) {
      throw new SyncAuthError(`Retrieved notification '${row.id}' belongs to another user.`);
    }
    if (!options.includeDeleted && row.deleted_at) {
      return null;
    }
    return row;
  }

  public async findByDedupeKey(
    userId: string,
    dedupeKey: string,
    options: NotificationQueryOptions = {}
  ): Promise<CloudNotificationRow | null> {
    const validatedUserId = validateUserId(userId);
    const trimmedKey = dedupeKey.trim();
    if (!trimmedKey) return null;

    let query = this.client
      .from('notifications')
      .select('*')
      .eq('user_id', validatedUserId)
      .eq('dedupe_key', trimmedKey);

    if (!options.includeDeleted) {
      query = query.is('deleted_at', null);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new SyncDatabaseError(error.message, error.code, error);
    }
    if (!data) return null;

    const row = data as CloudNotificationRow;
    NotificationRowMapper.validateCloudRow(row);
    if (row.user_id !== validatedUserId) {
      throw new SyncAuthError(`Retrieved notification '${row.id}' belongs to another user.`);
    }
    if (!options.includeDeleted && row.deleted_at) {
      return null;
    }
    return row;
  }

  public async findAll(
    userId: string,
    options: NotificationQueryOptions = {}
  ): Promise<CloudNotificationRow[]> {
    const validatedUserId = validateUserId(userId);

    let query = this.client
      .from('notifications')
      .select('*')
      .eq('user_id', validatedUserId);

    if (!options.includeDeleted) {
      query = query.is('deleted_at', null);
    }

    const { data, error } = await query.order('updated_at', { ascending: false });
    if (error) {
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    const rows = (data ?? []) as CloudNotificationRow[];
    for (const row of rows) {
      NotificationRowMapper.validateCloudRow(row);
      if (row.user_id !== validatedUserId) {
        throw new SyncAuthError(`Retrieved notification '${row.id}' belongs to another user.`);
      }
    }

    return options.includeDeleted ? rows : rows.filter((r) => !r.deleted_at);
  }

  private async reconcileDuplicateInsert(
    attempted: CloudNotificationRow
  ): Promise<CloudNotificationRow> {
    const [existingById, existingByDedupe] = await Promise.all([
      this.findById(attempted.id, attempted.user_id, { includeDeleted: true }),
      this.findByDedupeKey(attempted.user_id, attempted.dedupe_key, { includeDeleted: true })
    ]);

    if (existingByDedupe && existingByDedupe.id !== attempted.id) {
      throw new SyncConflictError(
        `Notification slot (${attempted.dedupe_key}) is already occupied in cloud by a different ID '${existingByDedupe.id}'.`,
        existingByDedupe
      );
    }

    const existing = existingById ?? existingByDedupe;
    if (!existing) {
      throw new SyncConflictError(
        `Notification '${attempted.id}' conflicted in cloud and could not be retrieved under current RLS.`
      );
    }
    if (existing.user_id !== attempted.user_id) {
      throw new SyncConflictError(
        `Notification '${attempted.id}' belongs to another user.`,
        existing
      );
    }
    if (existing.deleted_at !== null && existing.deleted_at !== undefined) {
      throw new SyncConflictError(
        `Notification '${attempted.id}' was tombstoned in cloud and cannot be re-inserted.`,
        existing
      );
    }
    if (existing.dedupe_key !== attempted.dedupe_key) {
      throw new SyncConflictError(
        `Notification ID '${attempted.id}' exists with different dedupe_key '${existing.dedupe_key}'.`,
        existing
      );
    }
    if (
      existing.entity_type === attempted.entity_type &&
      existing.entity_id !== attempted.entity_id
    ) {
      throw new SyncConflictError(
        `Notification '${attempted.id}' exists with conflicting entity_id '${existing.entity_id}' (incoming '${attempted.entity_id}').`,
        existing
      );
    }

    const compatibleForward = isCompatibleNotificationCategoryProgression(
      existing.category,
      attempted.category
    );
    const compatibleBackward = isCompatibleNotificationCategoryProgression(
      attempted.category,
      existing.category
    );
    if (!compatibleForward && !compatibleBackward) {
      throw new SyncConflictError(
        `Notification '${attempted.id}' category '${attempted.category}' conflicts with cloud category '${existing.category}'.`,
        existing
      );
    }

    if (this.areRowsEquivalent(existing, attempted)) {
      return existing;
    }

    // Attempt monotonic cross-device merge: never downgrade remote status (read/dismissed)
    // or remote urgency, and promote remote only if incoming strictly escalates urgency.
    const existingDomain = NotificationRowMapper.toDomain(existing);
    const incomingUrgencyHigher =
      NOTIFICATION_SEVERITY_RANK[attempted.severity] >
        NOTIFICATION_SEVERITY_RANK[existing.severity] ||
      NOTIFICATION_CATEGORY_RANK[attempted.category] >
        NOTIFICATION_CATEGORY_RANK[existing.category];

    if (compatibleForward && incomingUrgencyHigher) {
      const { notification: promoted, changed } = existingDomain.promoteAlert({
        category: attempted.category,
        severity: attempted.severity,
        title: attempted.title,
        message: attempted.message,
        entityType: attempted.entity_type,
        entityId: attempted.entity_id,
        triggerDate: attempted.trigger_date,
        actionRoute: attempted.action_route,
        metadata: normalizeAndValidateCloudMetadata(attempted.metadata_json),
        now: attempted.updated_at
      });

      if (changed) {
        const promotedCloud = NotificationRowMapper.toCloud(promoted);
        return await this.updatePartial(
          existing.id,
          existing.user_id,
          {
            category: promotedCloud.category,
            severity: promotedCloud.severity,
            status: promotedCloud.status,
            title: promotedCloud.title,
            message: promotedCloud.message,
            entity_type: promotedCloud.entity_type,
            entity_id: promotedCloud.entity_id,
            trigger_date: promotedCloud.trigger_date,
            action_route: promotedCloud.action_route,
            metadata_json: promotedCloud.metadata_json,
            read_at: promotedCloud.read_at,
            dismissed_at: promotedCloud.dismissed_at,
            version: promotedCloud.version,
            updated_at: promotedCloud.updated_at
          },
          existing.version
        );
      }
    }

    // Remote row already reflects equal/higher urgency or read/dismissed user action;
    // return remote state without overwriting so subsequent pull reconciliation converges locally.
    const remoteHasSuperiorState =
      NOTIFICATION_SEVERITY_RANK[existing.severity] >
        NOTIFICATION_SEVERITY_RANK[attempted.severity] ||
      NOTIFICATION_CATEGORY_RANK[existing.category] >
        NOTIFICATION_CATEGORY_RANK[attempted.category] ||
      existing.status === 'read' ||
      existing.status === 'dismissed' ||
      existing.version === attempted.version;

    if (remoteHasSuperiorState) {
      return existing;
    }

    throw new SyncConflictError(
      `Conflicting notification version or state for '${attempted.id}' (local v${attempted.version}, cloud v${existing.version}).`,
      existing
    );
  }

  private areRowsEquivalent(a: CloudNotificationRow, b: CloudNotificationRow): boolean {
    return (
      a.id === b.id &&
      a.user_id === b.user_id &&
      a.category === b.category &&
      a.severity === b.severity &&
      a.status === b.status &&
      a.dedupe_key === b.dedupe_key &&
      a.title === b.title &&
      a.message === b.message &&
      a.entity_type === b.entity_type &&
      a.entity_id === b.entity_id &&
      a.trigger_date === b.trigger_date &&
      a.action_route === b.action_route &&
      areMetadataObjectsEqual(a.metadata_json, b.metadata_json) &&
      areTimestampsEqual(a.read_at, b.read_at) &&
      areTimestampsEqual(a.dismissed_at, b.dismissed_at) &&
      a.version === b.version &&
      areTimestampsEqual(a.deleted_at, b.deleted_at)
    );
  }

  private arePatchFieldsMatching(
    existing: CloudNotificationRow,
    patch: Partial<CloudNotificationRow>
  ): boolean {
    if (patch.category !== undefined && existing.category !== patch.category) return false;
    if (patch.severity !== undefined && existing.severity !== patch.severity) return false;
    if (patch.status !== undefined && existing.status !== patch.status) return false;
    if (patch.title !== undefined && existing.title !== patch.title) return false;
    if (patch.message !== undefined && existing.message !== patch.message) return false;
    if (patch.entity_type !== undefined && existing.entity_type !== patch.entity_type) return false;
    if (patch.entity_id !== undefined && existing.entity_id !== patch.entity_id) return false;
    if (patch.trigger_date !== undefined && existing.trigger_date !== patch.trigger_date) return false;
    if (patch.action_route !== undefined && existing.action_route !== patch.action_route) return false;
    if (
      patch.metadata_json !== undefined &&
      !areMetadataObjectsEqual(existing.metadata_json, patch.metadata_json)
    ) {
      return false;
    }
    if (patch.read_at !== undefined && !areTimestampsEqual(existing.read_at, patch.read_at)) {
      return false;
    }
    if (
      patch.dismissed_at !== undefined &&
      !areTimestampsEqual(existing.dismissed_at, patch.dismissed_at)
    ) {
      return false;
    }
    return true;
  }

  private verifyPersistedIdentity(
    row: CloudNotificationRow,
    expectedId: string,
    expectedUserId: string,
    expectedVersion?: number
  ): void {
    if (row.id !== expectedId) {
      throw new Error(
        `Persisted notification ID '${row.id}' does not match expected ID '${expectedId}'.`
      );
    }
    if (row.user_id !== expectedUserId) {
      throw new Error(
        `Persisted notification user_id '${row.user_id}' does not match expected owner '${expectedUserId}'.`
      );
    }
    if (expectedVersion !== undefined && row.version !== expectedVersion) {
      throw new Error(
        `Persisted notification version '${row.version}' does not match expected version '${expectedVersion}'.`
      );
    }
  }
}

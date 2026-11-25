import { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';
import {
  CloudNotificationPreferenceRow,
  NotificationPreferenceRowMapper
} from '../mappers/NotificationPreferenceRowMapper';
import { validateUserId } from '@/domain/value-objects/Identifiers';
import {
  SyncAuthError,
  SyncConflictError,
  SyncDatabaseError
} from '@/infrastructure/sync/errors/SyncErrors';

export interface ISupabaseNotificationPreferenceRepository {
  insert(pref: CloudNotificationPreferenceRow): Promise<CloudNotificationPreferenceRow>;
  updatePartial(
    userId: string,
    patch: Partial<CloudNotificationPreferenceRow>,
    expectedVersion: number
  ): Promise<CloudNotificationPreferenceRow>;
  findByUserId(userId: string): Promise<CloudNotificationPreferenceRow | null>;
}

export class SupabaseNotificationPreferenceRepository
  implements ISupabaseNotificationPreferenceRepository
{
  constructor(private readonly client: SupabaseClient = supabase) {}

  public async insert(
    pref: CloudNotificationPreferenceRow
  ): Promise<CloudNotificationPreferenceRow> {
    if (!pref.user_id || pref.user_id.trim().length === 0) {
      throw new SyncAuthError(
        'Cannot insert notification preferences: user_id is missing or unauthenticated.'
      );
    }

    NotificationPreferenceRowMapper.validateCloudRow(pref);
    if (pref.version !== 1) {
      throw new SyncConflictError(
        `Cannot insert notification preferences for '${pref.user_id}': initial version must be 1, got ${pref.version}.`
      );
    }

    const { data, error } = await this.client
      .from('notification_preferences')
      .insert(pref)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        const existing = await this.findByUserId(pref.user_id);
        if (existing && this.areRowsEquivalent(existing, pref)) {
          return existing;
        }
        throw new SyncConflictError(
          `Notification preferences already exist in cloud for user '${pref.user_id}' with conflicting state.`,
          existing ?? undefined
        );
      }
      if (error.code === '23514' || error.code === '40001') {
        throw new SyncConflictError(error.message);
      }
      if (error.code === '42501') {
        throw new SyncDatabaseError(
          'RLS permission denied: Cannot insert notification preferences for this user context.',
          '42501',
          error
        );
      }
      throw new SyncDatabaseError(
        `Failed to insert notification preferences for '${pref.user_id}': ${error.message}`,
        error.code,
        error
      );
    }

    if (!data) {
      throw new SyncDatabaseError(
        'Insert succeeded but no notification preference row was returned.'
      );
    }

    const verified = data as CloudNotificationPreferenceRow;
    NotificationPreferenceRowMapper.validateCloudRow(verified);
    return verified;
  }

  public async updatePartial(
    userId: string,
    patch: Partial<CloudNotificationPreferenceRow>,
    expectedVersion: number
  ): Promise<CloudNotificationPreferenceRow> {
    const validatedUserId = validateUserId(userId);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error(
        `Invalid expectedVersion '${expectedVersion}' for notification preferences update.`
      );
    }

    const targetVersion = patch.version ?? expectedVersion + 1;
    if (targetVersion !== expectedVersion + 1) {
      throw new Error(
        `Invalid target version '${targetVersion}' for expectedVersion '${expectedVersion}'.`
      );
    }

    const sanitizedPatch: Partial<CloudNotificationPreferenceRow> = {
      ...patch,
      version: targetVersion,
      updated_at: patch.updated_at ?? new Date().toISOString()
    };
    delete (sanitizedPatch as Record<string, unknown>).user_id;
    delete (sanitizedPatch as Record<string, unknown>).created_at;

    const { data, error } = await this.client
      .from('notification_preferences')
      .update(sanitizedPatch)
      .eq('user_id', validatedUserId)
      .eq('version', expectedVersion)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === '40001' || error.code === '23514') {
        throw new SyncConflictError(error.message);
      }
      if (error.code === '42501') {
        throw new SyncDatabaseError(
          'RLS permission denied: Cannot update notification preferences for this user context.',
          '42501',
          error
        );
      }
      throw new SyncDatabaseError(
        `Failed to update notification preferences for '${validatedUserId}': ${error.message}`,
        error.code,
        error
      );
    }

    if (data) {
      const verified = data as CloudNotificationPreferenceRow;
      NotificationPreferenceRowMapper.validateCloudRow(verified);
      return verified;
    }

    const existing = await this.findByUserId(validatedUserId);
    if (!existing) {
      throw new SyncConflictError(
        `Notification preferences for '${validatedUserId}' not found in cloud for update.`
      );
    }

    if (
      existing.version === targetVersion &&
      this.arePatchFieldsMatching(existing, sanitizedPatch)
    ) {
      return existing;
    }

    throw new SyncConflictError(
      `Optimistic concurrency conflict updating notification preferences for '${validatedUserId}': cloud version is ${existing.version}, expected ${expectedVersion}.`,
      existing
    );
  }

  public async findByUserId(userId: string): Promise<CloudNotificationPreferenceRow | null> {
    const validatedUserId = validateUserId(userId);

    const { data, error } = await this.client
      .from('notification_preferences')
      .select('*')
      .eq('user_id', validatedUserId)
      .maybeSingle();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (!data) {
      return null;
    }

    const row = data as CloudNotificationPreferenceRow;
    NotificationPreferenceRowMapper.validateCloudRow(row);
    if (row.user_id !== validatedUserId) {
      throw new SyncAuthError(
        `Retrieved notification preference belongs to another user ('${row.user_id}').`
      );
    }
    return row;
  }

  private areRowsEquivalent(
    a: CloudNotificationPreferenceRow,
    b: CloudNotificationPreferenceRow
  ): boolean {
    return (
      a.user_id === b.user_id &&
      a.recurring_payment_enabled === b.recurring_payment_enabled &&
      a.budget_warning_enabled === b.budget_warning_enabled &&
      a.budget_exceeded_enabled === b.budget_exceeded_enabled &&
      a.upcoming_lead_days === b.upcoming_lead_days &&
      a.version === b.version
    );
  }

  private arePatchFieldsMatching(
    existing: CloudNotificationPreferenceRow,
    patch: Partial<CloudNotificationPreferenceRow>
  ): boolean {
    if (
      patch.recurring_payment_enabled !== undefined &&
      existing.recurring_payment_enabled !== patch.recurring_payment_enabled
    ) {
      return false;
    }
    if (
      patch.budget_warning_enabled !== undefined &&
      existing.budget_warning_enabled !== patch.budget_warning_enabled
    ) {
      return false;
    }
    if (
      patch.budget_exceeded_enabled !== undefined &&
      existing.budget_exceeded_enabled !== patch.budget_exceeded_enabled
    ) {
      return false;
    }
    if (
      patch.upcoming_lead_days !== undefined &&
      existing.upcoming_lead_days !== patch.upcoming_lead_days
    ) {
      return false;
    }
    return true;
  }
}

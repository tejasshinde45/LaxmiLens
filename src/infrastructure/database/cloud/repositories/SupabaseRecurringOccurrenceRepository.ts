import { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';
import {
  CloudRecurringOccurrenceRow,
  RecurringOccurrenceMapper
} from '../mappers/RecurringOccurrenceMapper';
import { ISupabaseRecurringRuleRepository } from './SupabaseRecurringRuleRepository';
import { ISupabaseTransactionRepository } from './SupabaseTransactionRepository';
import { isValidUuid } from '@/domain/value-objects/Identifiers';
import {
  SyncAuthError,
  SyncConflictError,
  SyncDatabaseError,
  SyncTransactionDependencyError
} from '@/infrastructure/sync/errors/SyncErrors';

export interface RecurringOccurrenceQueryOptions {
  includeDeleted?: boolean;
}

export interface ISupabaseRecurringOccurrenceRepository {
  insert(occurrence: CloudRecurringOccurrenceRow): Promise<CloudRecurringOccurrenceRow>;
  updatePartial(
    id: string,
    userId: string,
    patch: Partial<CloudRecurringOccurrenceRow>,
    expectedVersion: number
  ): Promise<CloudRecurringOccurrenceRow>;
  findById(
    id: string,
    userId: string,
    options?: RecurringOccurrenceQueryOptions
  ): Promise<CloudRecurringOccurrenceRow | null>;
  findByRuleAndDate(
    userId: string,
    recurringRuleId: string,
    occurrenceDate: string
  ): Promise<CloudRecurringOccurrenceRow | null>;
  findAll(
    userId: string,
    options?: RecurringOccurrenceQueryOptions
  ): Promise<CloudRecurringOccurrenceRow[]>;
}

export class SupabaseRecurringOccurrenceRepository implements ISupabaseRecurringOccurrenceRepository {
  constructor(
    private readonly client: SupabaseClient = supabase,
    private readonly ruleRepo?: ISupabaseRecurringRuleRepository,
    private readonly transactionRepo?: ISupabaseTransactionRepository
  ) {}

  public async insert(
    occurrence: CloudRecurringOccurrenceRow
  ): Promise<CloudRecurringOccurrenceRow> {
    if (!occurrence.user_id || occurrence.user_id.trim().length === 0) {
      throw new SyncAuthError('Cannot insert recurring occurrence: user_id is missing.');
    }

    RecurringOccurrenceMapper.validateCloudRow(occurrence);
    if (occurrence.deleted_at) {
      throw new Error('Cannot insert recurring occurrence with deleted_at already set.');
    }

    if (this.ruleRepo) {
      const rule = await this.ruleRepo.findById(
        occurrence.recurring_rule_id,
        occurrence.user_id
      );
      if (!rule || rule.user_id !== occurrence.user_id) {
        throw new SyncConflictError(
          `Cannot sync occurrence '${occurrence.id}': Recurring schedule '${occurrence.recurring_rule_id}' not found in cloud.`
        );
      }
    }

    if (occurrence.transaction_id && this.transactionRepo) {
      const tx = await this.transactionRepo.findById(
        occurrence.transaction_id,
        occurrence.user_id
      );
      if (!tx || tx.user_id !== occurrence.user_id) {
        throw new SyncTransactionDependencyError(
          `Cannot persist recurring occurrence '${occurrence.id}': Transaction '${occurrence.transaction_id}' not found in cloud.`,
          occurrence.transaction_id
        );
      }
    }

    const { data, error } = await this.client
      .from('recurring_occurrences')
      .insert(occurrence)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        const existingById = await this.findById(occurrence.id, occurrence.user_id, {
          includeDeleted: true
        });
        if (existingById) {
          if (existingById.deleted_at) {
            throw new SyncConflictError(
              `Recurring occurrence '${occurrence.id}' was previously tombstoned in cloud and cannot be re-inserted.`,
              existingById
            );
          }
          if (this.areOccurrenceRowsEquivalent(existingById, occurrence)) {
            return existingById;
          }
          throw new SyncConflictError(
            `Semantic conflict detected for recurring occurrence '${occurrence.id}' in cloud.`,
            existingById
          );
        }

        const existingBySlot = await this.findByRuleAndDate(
          occurrence.user_id,
          occurrence.recurring_rule_id,
          occurrence.occurrence_date
        );
        if (existingBySlot) {
          if (
            existingBySlot.id === occurrence.id &&
            this.areOccurrenceRowsEquivalent(existingBySlot, occurrence)
          ) {
            return existingBySlot;
          }
          throw new SyncConflictError(
            `Duplicate cloud occurrence slot (${occurrence.recurring_rule_id}, ${occurrence.occurrence_date}) occupied by '${existingBySlot.id}' (status '${existingBySlot.status}').`,
            existingBySlot
          );
        }
      }

      if (error.code === '23503') {
        if (occurrence.transaction_id) {
          throw new SyncTransactionDependencyError(
            `Cannot persist recurring occurrence '${occurrence.id}': Missing transaction '${occurrence.transaction_id}'.`,
            occurrence.transaction_id
          );
        }
        throw new SyncConflictError(
          `Foreign key constraint failed for recurring occurrence '${occurrence.id}'.`
        );
      }

      throw new SyncDatabaseError(
        `Failed to insert recurring occurrence '${occurrence.id}': ${error.message}`,
        error.code,
        error
      );
    }

    return data as CloudRecurringOccurrenceRow;
  }

  public async updatePartial(
    id: string,
    userId: string,
    patch: Partial<CloudRecurringOccurrenceRow>,
    expectedVersion: number
  ): Promise<CloudRecurringOccurrenceRow> {
    if (!userId || !isValidUuid(id)) {
      throw new SyncAuthError('Invalid recurring occurrence update identity.');
    }

    if (patch.transaction_id && this.transactionRepo) {
      const tx = await this.transactionRepo.findById(patch.transaction_id, userId);
      if (!tx || tx.user_id !== userId) {
        throw new SyncTransactionDependencyError(
          `Cannot update recurring occurrence '${id}': Missing transaction '${patch.transaction_id}'.`,
          patch.transaction_id
        );
      }
    }

    const cleanPatch: Partial<CloudRecurringOccurrenceRow> = {
      ...patch,
      version: expectedVersion + 1
    };
    delete (cleanPatch as Record<string, unknown>).id;
    delete (cleanPatch as Record<string, unknown>).user_id;
    delete (cleanPatch as Record<string, unknown>).recurring_rule_id;
    delete (cleanPatch as Record<string, unknown>).occurrence_date;
    delete (cleanPatch as Record<string, unknown>).idempotency_key;
    delete (cleanPatch as Record<string, unknown>).created_at;

    const { data, error } = await this.client
      .from('recurring_occurrences')
      .update(cleanPatch)
      .eq('id', id)
      .eq('user_id', userId)
      .eq('version', expectedVersion)
      .is('deleted_at', null)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === '23503' && patch.transaction_id) {
        throw new SyncTransactionDependencyError(
          `Cannot update recurring occurrence '${id}': Foreign key transaction '${patch.transaction_id}' missing.`,
          patch.transaction_id
        );
      }
      if (error.code === '40001') {
        throw new SyncConflictError(`Version conflict updating recurring occurrence '${id}'.`);
      }
      throw new SyncDatabaseError(
        `Failed to update recurring occurrence '${id}': ${error.message}`,
        error.code,
        error
      );
    }

    if (!data) {
      const existing = await this.findById(id, userId, { includeDeleted: true });
      if (!existing) {
        throw new SyncConflictError(
          `Recurring occurrence '${id}' not found in cloud for update.`
        );
      }
      if (existing.user_id !== userId) {
        throw new SyncConflictError(
          `Recurring occurrence '${id}' belongs to another user.`,
          existing
        );
      }
      if (existing.deleted_at !== null && existing.deleted_at !== undefined) {
        throw new SyncConflictError(
          `Recurring occurrence '${id}' has been deleted (tombstoned) in cloud and cannot be updated.`,
          existing
        );
      }
      const targetVersion = expectedVersion + 1;
      if (
        existing.version === targetVersion &&
        this.areOccurrencePatchFieldsMatching(existing, cleanPatch)
      ) {
        return existing;
      }
      throw new SyncConflictError(
        `Optimistic concurrency conflict updating recurring occurrence '${id}' (expected version ${expectedVersion}, cloud version ${existing.version}).`,
        existing
      );
    }

    return data as CloudRecurringOccurrenceRow;
  }

  private areTimestampsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return new Date(a).getTime() === new Date(b).getTime();
  }

  private areOccurrenceRowsEquivalent(
    existing: CloudRecurringOccurrenceRow,
    incoming: CloudRecurringOccurrenceRow
  ): boolean {
    return (
      existing.user_id === incoming.user_id &&
      existing.recurring_rule_id === incoming.recurring_rule_id &&
      existing.occurrence_date === incoming.occurrence_date &&
      existing.idempotency_key === incoming.idempotency_key &&
      existing.status === incoming.status &&
      (existing.snoozed_until_date ?? null) === (incoming.snoozed_until_date ?? null) &&
      (existing.transaction_id ?? null) === (incoming.transaction_id ?? null) &&
      this.areTimestampsEqual(existing.confirmed_at, incoming.confirmed_at) &&
      this.areTimestampsEqual(existing.skipped_at, incoming.skipped_at) &&
      this.areTimestampsEqual(existing.dismissed_at, incoming.dismissed_at) &&
      (existing.deleted_at ?? null) === (incoming.deleted_at ?? null) &&
      existing.version === incoming.version
    );
  }

  private areOccurrencePatchFieldsMatching(
    existing: CloudRecurringOccurrenceRow,
    patch: Partial<CloudRecurringOccurrenceRow>
  ): boolean {
    if (patch.status !== undefined && existing.status !== patch.status) return false;
    if (
      patch.snoozed_until_date !== undefined &&
      (existing.snoozed_until_date ?? null) !== (patch.snoozed_until_date ?? null)
    ) {
      return false;
    }
    if (
      patch.transaction_id !== undefined &&
      (existing.transaction_id ?? null) !== (patch.transaction_id ?? null)
    ) {
      return false;
    }
    if (
      patch.confirmed_at !== undefined &&
      !this.areTimestampsEqual(existing.confirmed_at, patch.confirmed_at)
    ) {
      return false;
    }
    if (
      patch.skipped_at !== undefined &&
      !this.areTimestampsEqual(existing.skipped_at, patch.skipped_at)
    ) {
      return false;
    }
    if (
      patch.dismissed_at !== undefined &&
      !this.areTimestampsEqual(existing.dismissed_at, patch.dismissed_at)
    ) {
      return false;
    }
    return true;
  }

  public async findById(
    id: string,
    userId: string,
    options?: RecurringOccurrenceQueryOptions
  ): Promise<CloudRecurringOccurrenceRow | null> {
    if (!isValidUuid(id) || !userId) return null;
    let query = this.client
      .from('recurring_occurrences')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId);

    if (!options?.includeDeleted) {
      query = query.is('deleted_at', null);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new SyncDatabaseError(
        `Failed to query recurring occurrence '${id}': ${error.message}`,
        error.code,
        error
      );
    }
    return (data as CloudRecurringOccurrenceRow) ?? null;
  }

  public async findByRuleAndDate(
    userId: string,
    recurringRuleId: string,
    occurrenceDate: string
  ): Promise<CloudRecurringOccurrenceRow | null> {
    if (!userId || !isValidUuid(recurringRuleId)) return null;
    const { data, error } = await this.client
      .from('recurring_occurrences')
      .select('*')
      .eq('user_id', userId)
      .eq('recurring_rule_id', recurringRuleId)
      .eq('occurrence_date', occurrenceDate)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) {
      throw new SyncDatabaseError(
        `Failed to lookup occurrence slot (${recurringRuleId}, ${occurrenceDate}): ${error.message}`,
        error.code,
        error
      );
    }
    return (data as CloudRecurringOccurrenceRow) ?? null;
  }

  public async findAll(
    userId: string,
    options?: RecurringOccurrenceQueryOptions
  ): Promise<CloudRecurringOccurrenceRow[]> {
    if (!userId) return [];
    let query = this.client
      .from('recurring_occurrences')
      .select('*')
      .eq('user_id', userId);

    if (!options?.includeDeleted) {
      query = query.is('deleted_at', null);
    }

    const { data, error } = await query.order('occurrence_date', { ascending: true });
    if (error) {
      throw new SyncDatabaseError(
        `Failed to list recurring occurrences: ${error.message}`,
        error.code,
        error
      );
    }
    return (data as CloudRecurringOccurrenceRow[]) ?? [];
  }
}

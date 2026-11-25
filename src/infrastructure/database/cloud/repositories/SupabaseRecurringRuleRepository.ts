import { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';
import {
  CloudRecurringRuleRow,
  RecurringRuleMapper
} from '../mappers/RecurringRuleMapper';
import { ISupabaseAccountRepository } from './SupabaseAccountRepository';
import { ISupabaseCategoryRepository } from './SupabaseCategoryRepository';
import { isValidUuid } from '@/domain/value-objects/Identifiers';
import {
  SyncAccountDependencyError,
  SyncAuthError,
  SyncConflictError,
  SyncDatabaseError,
  SyncUnresolvedCategoryError
} from '@/infrastructure/sync/errors/SyncErrors';

export interface RecurringRuleQueryOptions {
  includeDeleted?: boolean;
}

export interface ISupabaseRecurringRuleRepository {
  insert(rule: CloudRecurringRuleRow): Promise<CloudRecurringRuleRow>;
  updatePartial(
    id: string,
    userId: string,
    patch: Partial<CloudRecurringRuleRow>,
    expectedVersion: number
  ): Promise<CloudRecurringRuleRow>;
  softDelete(
    id: string,
    userId: string,
    deletedAt: string,
    expectedVersion: number,
    targetVersion?: number
  ): Promise<CloudRecurringRuleRow>;
  findById(
    id: string,
    userId: string,
    options?: RecurringRuleQueryOptions
  ): Promise<CloudRecurringRuleRow | null>;
  findAll(
    userId: string,
    options?: RecurringRuleQueryOptions
  ): Promise<CloudRecurringRuleRow[]>;
}

export class SupabaseRecurringRuleRepository implements ISupabaseRecurringRuleRepository {
  constructor(
    private readonly client: SupabaseClient = supabase,
    private readonly accountRepo?: ISupabaseAccountRepository,
    private readonly categoryRepo?: ISupabaseCategoryRepository
  ) {}

  public async insert(rule: CloudRecurringRuleRow): Promise<CloudRecurringRuleRow> {
    if (!rule.user_id || rule.user_id.trim().length === 0) {
      throw new SyncAuthError('Cannot insert recurring rule: user_id is missing.');
    }

    RecurringRuleMapper.validateCloudRow(rule);
    if (rule.deleted_at) {
      throw new Error('Cannot insert a recurring rule with deleted_at already set.');
    }

    if (this.accountRepo) {
      const cloudAccount = await this.accountRepo.findById(rule.account_id);
      if (!cloudAccount || cloudAccount.user_id !== rule.user_id) {
        throw new SyncAccountDependencyError(
          `Cannot persist recurring rule '${rule.id}': Account '${rule.account_id}' not found in cloud.`,
          rule.account_id
        );
      }
    }

    if (rule.category_id && this.categoryRepo) {
      const cloudCategory = await this.categoryRepo.findById(rule.category_id, rule.user_id);
      if (!cloudCategory || cloudCategory.user_id !== rule.user_id) {
        throw new SyncUnresolvedCategoryError(
          `Cannot persist recurring rule '${rule.id}': Category reference '${rule.category_id}' does not exist in cloud.`,
          rule.category_id
        );
      }
      if (cloudCategory.type !== rule.type) {
        throw new Error(
          `Category type mismatch: expected '${rule.type}' category but got '${cloudCategory.type}'.`
        );
      }
    }

    const { data, error } = await this.client
      .from('recurring_rules')
      .insert(rule)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        const existing = await this.findById(rule.id, rule.user_id, { includeDeleted: true });
        if (existing) {
          if (existing.deleted_at) {
            throw new SyncConflictError(
              `Recurring rule '${rule.id}' was previously tombstoned in cloud and cannot be re-inserted.`
            );
          }
          if (existing.user_id === rule.user_id && existing.start_date === rule.start_date) {
            return existing;
          }
          throw new SyncConflictError(
            `ID conflict detected for recurring rule '${rule.id}' in cloud.`
          );
        }
      }
      if (error.code === '23503') {
        throw new SyncAccountDependencyError(
          `Cannot persist recurring rule '${rule.id}': Foreign key dependency '${rule.account_id}' missing in cloud.`,
          rule.account_id
        );
      }
      if (error.code === '42501') {
        throw new SyncDatabaseError('RLS permission denied for recurring_rules insert.', '42501', error);
      }
      throw new SyncDatabaseError(
        `Failed to insert recurring rule '${rule.id}': ${error.message}`,
        error.code,
        error
      );
    }

    return data as CloudRecurringRuleRow;
  }

  public async updatePartial(
    id: string,
    userId: string,
    patch: Partial<CloudRecurringRuleRow>,
    expectedVersion: number
  ): Promise<CloudRecurringRuleRow> {
    if (!userId || !isValidUuid(id)) {
      throw new SyncAuthError('Invalid recurring rule update identity.');
    }

    const cleanPatch: Partial<CloudRecurringRuleRow> = {
      ...patch,
      version: expectedVersion + 1
    };
    delete (cleanPatch as Record<string, unknown>).id;
    delete (cleanPatch as Record<string, unknown>).user_id;
    delete (cleanPatch as Record<string, unknown>).created_at;
    delete (cleanPatch as Record<string, unknown>).type;
    delete (cleanPatch as Record<string, unknown>).start_date;

    const { data, error } = await this.client
      .from('recurring_rules')
      .update(cleanPatch)
      .eq('id', id)
      .eq('user_id', userId)
      .eq('version', expectedVersion)
      .is('deleted_at', null)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === '40001') {
        throw new SyncConflictError(`Version conflict updating recurring rule '${id}'.`);
      }
      throw new SyncDatabaseError(
        `Failed to update recurring rule '${id}': ${error.message}`,
        error.code,
        error
      );
    }

    if (!data) {
      const existing = await this.findById(id, userId, { includeDeleted: true });
      if (!existing) {
        throw new SyncConflictError(`Recurring rule '${id}' not found in cloud for update.`);
      }
      if (existing.version >= expectedVersion + 1 && !existing.deleted_at) {
        return existing;
      }
      throw new SyncConflictError(
        `Optimistic concurrency conflict updating recurring rule '${id}' (expected version ${expectedVersion}, cloud version ${existing.version}).`
      );
    }

    return data as CloudRecurringRuleRow;
  }

  public async softDelete(
    id: string,
    userId: string,
    deletedAt: string,
    expectedVersion: number,
    targetVersion?: number
  ): Promise<CloudRecurringRuleRow> {
    if (!userId || !isValidUuid(id)) {
      throw new SyncAuthError('Invalid recurring rule delete identity.');
    }
    const nextVersion = targetVersion ?? expectedVersion + 1;

    const { data, error } = await this.client
      .from('recurring_rules')
      .update({
        deleted_at: deletedAt,
        version: nextVersion,
        updated_at: deletedAt
      })
      .eq('id', id)
      .eq('user_id', userId)
      .eq('version', expectedVersion)
      .is('deleted_at', null)
      .select()
      .maybeSingle();

    if (error) {
      throw new SyncDatabaseError(
        `Failed to tombstone recurring rule '${id}': ${error.message}`,
        error.code,
        error
      );
    }

    if (!data) {
      const existing = await this.findById(id, userId, { includeDeleted: true });
      if (existing && existing.deleted_at) {
        return existing;
      }
      throw new SyncConflictError(
        `Optimistic concurrency conflict tombstoning recurring rule '${id}'.`
      );
    }

    return data as CloudRecurringRuleRow;
  }

  public async findById(
    id: string,
    userId: string,
    options?: RecurringRuleQueryOptions
  ): Promise<CloudRecurringRuleRow | null> {
    if (!isValidUuid(id) || !userId) return null;
    let query = this.client
      .from('recurring_rules')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId);

    if (!options?.includeDeleted) {
      query = query.is('deleted_at', null);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new SyncDatabaseError(
        `Failed to query recurring rule '${id}': ${error.message}`,
        error.code,
        error
      );
    }
    return (data as CloudRecurringRuleRow) ?? null;
  }

  public async findAll(
    userId: string,
    options?: RecurringRuleQueryOptions
  ): Promise<CloudRecurringRuleRow[]> {
    if (!userId) return [];
    let query = this.client
      .from('recurring_rules')
      .select('*')
      .eq('user_id', userId);

    if (!options?.includeDeleted) {
      query = query.is('deleted_at', null);
    }

    const { data, error } = await query.order('created_at', { ascending: true });
    if (error) {
      throw new SyncDatabaseError(
        `Failed to list recurring rules: ${error.message}`,
        error.code,
        error
      );
    }
    return (data as CloudRecurringRuleRow[]) ?? [];
  }
}

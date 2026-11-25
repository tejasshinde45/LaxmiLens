import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecurringRuleMapper } from '@/infrastructure/database/cloud/mappers/RecurringRuleMapper';
import { RecurringOccurrenceMapper } from '@/infrastructure/database/cloud/mappers/RecurringOccurrenceMapper';
import { RecurringRuleSyncDispatcher } from '@/infrastructure/sync/dispatchers/RecurringRuleSyncDispatcher';
import { RecurringOccurrenceSyncDispatcher } from '@/infrastructure/sync/dispatchers/RecurringOccurrenceSyncDispatcher';
import { RecurringReconciliationService } from '@/infrastructure/sync/RecurringReconciliationService';
import { ManualSyncCoordinator } from '@/infrastructure/sync/ManualSyncCoordinator';
import { SupabaseRecurringRuleRepository } from '@/infrastructure/database/cloud/repositories/SupabaseRecurringRuleRepository';
import { SupabaseRecurringOccurrenceRepository } from '@/infrastructure/database/cloud/repositories/SupabaseRecurringOccurrenceRepository';
import { SyncConflictError } from '@/infrastructure/sync/errors/SyncErrors';
import { AuthPort } from '@/application/ports/AuthPort';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { AccountSyncDispatcher } from '@/infrastructure/sync/dispatchers/AccountSyncDispatcher';
import { TransactionSyncDispatcher } from '@/infrastructure/sync/dispatchers/TransactionSyncDispatcher';
import { CategorySyncDispatcher } from '@/infrastructure/sync/dispatchers/CategorySyncDispatcher';
import { ICategoryResolver } from '@/infrastructure/sync/CategoryMappingService';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import {
  LocalOutboxRecord,
  LocalRecurringOccurrenceRecord,
  LocalRecurringRuleRecord
} from '@/infrastructure/database/local/schema';

describe('Phase 8 Sync: Mappers, Dispatchers, Reconciliation & Dependency Order', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const accId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const cloudCatId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
  const ruleId = '44444444-4444-4444-8444-444444444441';
  const occId = '55555555-5555-4555-8555-555555555551';
  const txId = '66666666-6666-4666-8666-666666666661';

  let authPort: AuthPort;
  let outboxEntries: LocalOutboxRecord[];
  let outboxManager: OutboxManager;

  beforeEach(() => {
    outboxEntries = [];
    authPort = {
      getCurrentUser: vi.fn(async () => ({
        id: userId,
        email: 'user@example.com',
        isAuthenticated: true
      })),
      getCurrentSession: vi.fn(async () => null),
      signOut: vi.fn(async () => {}),
      onAuthStateChange: vi.fn(() => () => {})
    } as unknown as AuthPort;

    outboxManager = {
      getPendingEntries: vi.fn(async () => [...outboxEntries]),
      getPendingCount: vi.fn(async () => outboxEntries.length),
      markSuccess: vi.fn(async (id: number) => {
        outboxEntries = outboxEntries.filter((e) => e.id !== id);
      }),
      markFailure: vi.fn(async () => {}),
      enqueue: vi.fn(async () => {}),
      processOutbox: vi.fn(async () => ({
        pushedCount: 0,
        pulledCount: 0,
        conflictsCount: 0,
        errors: []
      })),
      clearOutbox: vi.fn(async () => {})
    } as unknown as OutboxManager;
  });

  it('validates and maps recurring rules & occurrences cleanly between outbox and cloud formats', () => {
    const ruleRow = RecurringRuleMapper.mapCreatePayload({
      id: ruleId,
      user_id: userId,
      title: 'SIP Investment',
      type: 'expense',
      amount_paise: 1000000,
      account_id: accId,
      category_id: cloudCatId,
      frequency: 'quarterly',
      interval: 1,
      anchor_day_of_month: 31,
      start_date: '2026-01-31',
      next_due_date: '2026-04-30',
      status: 'active',
      version: 1
    });

    expect(ruleRow.frequency).toBe('quarterly');
    expect(ruleRow.anchor_day_of_month).toBe(31);
    const localRule = RecurringRuleMapper.toLocalRecord(ruleRow);
    expect(localRule.amountPaise).toBe(1000000);

    const occRow = RecurringOccurrenceMapper.mapCreatePayload({
      id: occId,
      user_id: userId,
      recurring_rule_id: ruleId,
      occurrence_date: '2026-04-30',
      status: 'confirmed',
      transaction_id: txId,
      idempotency_key: `recurring:${ruleId}:2026-04-30`,
      version: 1
    });
    expect(occRow.transaction_id).toBe(txId);
    const domainOcc = RecurringOccurrenceMapper.toDomain(occRow);
    expect(domainOcc.occurrenceDate).toBe('2026-04-30');
  });

  it('resolves category mapping on INSERT and blocks downstream occurrences when recurring rule sync fails', async () => {
    const order: string[] = [];

    const categoryResolver: ICategoryResolver = {
      resolveCategory: vi.fn(async () => cloudCatId),
      getMapping: vi.fn(async () => cloudCatId),
      setMapping: vi.fn(async () => {})
    };

    const mockCloudRuleRepo = {
      insert: vi.fn(async () => {
        throw new Error('Transient rule sync outage');
      }),
      updatePartial: vi.fn(),
      softDelete: vi.fn(),
      findById: vi.fn(),
      findAll: vi.fn(async () => [])
    };

    const mockCloudOccRepo = {
      insert: vi.fn(async (row) => {
        order.push('occ-insert');
        return row;
      }),
      updatePartial: vi.fn(),
      findById: vi.fn(),
      findByRuleAndDate: vi.fn(),
      findAll: vi.fn(async () => [])
    };

    const accDispatcher = {
      dispatch: vi.fn(async (entry: LocalOutboxRecord) => {
        order.push('account');
        if (typeof entry.id === 'number') {
          await outboxManager.markSuccess(entry.id);
        }
      })
    } as unknown as AccountSyncDispatcher;
    const catDispatcher = {
      dispatch: vi.fn(async (entry: LocalOutboxRecord) => {
        order.push('category');
        if (typeof entry.id === 'number') {
          await outboxManager.markSuccess(entry.id);
        }
      })
    } as unknown as CategorySyncDispatcher;
    const txDispatcher = {
      dispatch: vi.fn(async (entry: LocalOutboxRecord) => {
        order.push('tx');
        if (typeof entry.id === 'number') {
          await outboxManager.markSuccess(entry.id);
        }
      })
    } as unknown as TransactionSyncDispatcher;

    const ruleDispatcher = new RecurringRuleSyncDispatcher(
      mockCloudRuleRepo as any,
      authPort,
      outboxManager,
      categoryResolver
    );
    const occDispatcher = new RecurringOccurrenceSyncDispatcher(
      mockCloudOccRepo as any,
      authPort,
      outboxManager
    );

    outboxEntries = [
      {
        id: 1,
        userId,
        entity: 'accounts',
        entityId: accId,
        operation: 'INSERT',
        payload: { id: accId, user_id: userId },
        idempotencyKey: 'k1',
        attempts: 0,
        createdAt: new Date().toISOString()
      },
      {
        id: 2,
        userId,
        entity: 'recurring_rules',
        entityId: ruleId,
        operation: 'INSERT',
        payload: {
          id: ruleId,
          user_id: userId,
          title: 'Rent',
          type: 'expense',
          amount_paise: 1500000,
          account_id: accId,
          category_id: 'cat_local_housing',
          frequency: 'monthly',
          interval: 1,
          anchor_day_of_month: 1,
          start_date: '2026-11-01',
          next_due_date: '2026-11-01',
          status: 'active',
          version: 1
        },
        idempotencyKey: 'k2',
        attempts: 0,
        createdAt: new Date().toISOString()
      },
      {
        id: 3,
        userId,
        entity: 'recurring_occurrences',
        entityId: occId,
        operation: 'INSERT',
        payload: {
          id: occId,
          user_id: userId,
          recurring_rule_id: ruleId,
          occurrence_date: '2026-11-01',
          status: 'pending',
          idempotency_key: `recurring:${ruleId}:2026-11-01`,
          version: 1
        },
        idempotencyKey: 'k3',
        attempts: 0,
        createdAt: new Date().toISOString()
      }
    ];

    const coordinator = new ManualSyncCoordinator(
      accDispatcher,
      txDispatcher,
      outboxManager,
      authPort,
      catDispatcher,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ruleDispatcher,
      occDispatcher
    );

    const res = await coordinator.run();

    expect(order).toEqual(['account']);
    expect(categoryResolver.resolveCategory).toHaveBeenCalledWith('cat_local_housing', userId);
    expect(res.accounts.syncedCount).toBe(1);
    expect(res.recurring_rules?.failedCount).toBe(1);
    expect(res.recurring_occurrences?.dependencyBlockedCount).toBe(1);
    expect(mockCloudOccRepo.insert).not.toHaveBeenCalled();
    // Account acked; failed rule + blocked occurrence safely preserved in outbox
    expect(outboxEntries.map((e) => e.id)).toEqual([2, 3]);
  });

  it('reconciles cloud recurring rules & occurrences without overwriting pending local outbox changes', async () => {
    const localRules = new Map<string, LocalRecurringRuleRecord>();
    const localOccs = new Map<string, LocalRecurringOccurrenceRecord>();

    localRules.set(ruleId, {
      id: ruleId,
      userId,
      title: 'Local Unsynced Title',
      type: 'expense',
      amountPaise: 500000,
      accountId: accId,
      frequency: 'monthly',
      interval: 1,
      anchorDayOfMonth: 5,
      startDate: '2026-11-05',
      nextDueDate: '2026-11-05',
      status: 'active',
      requiresUserConfirmation: true,
      version: 1,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      deletedAt: null
    });

    const mockOutbox = [
      {
        id: 10,
        userId,
        entity: 'recurring_rules',
        entityId: ruleId, // Protect ruleId from overwrite!
        operation: 'UPDATE',
        payload: { id: ruleId },
        idempotencyKey: 'pending-1',
        attempts: 0,
        createdAt: new Date().toISOString()
      }
    ];

    const mockDb = {
      transaction: vi.fn(async (_mode: string, _tables: unknown, fn: () => Promise<any>) => fn()),
      syncOutbox: {
        where: () => ({ equals: () => ({ toArray: async () => mockOutbox }) })
      },
      recurringRules: {
        where: () => ({ equals: () => ({ toArray: async () => Array.from(localRules.values()) }) }),
        put: vi.fn(async (rec: LocalRecurringRuleRecord) => {
          localRules.set(rec.id, rec);
        })
      },
      recurringOccurrences: {
        where: () => ({ equals: () => ({ toArray: async () => Array.from(localOccs.values()) }) }),
        put: vi.fn(async (rec: LocalRecurringOccurrenceRecord) => {
          localOccs.set(rec.id, rec);
        })
      }
    } as unknown as LaxmiLensDB;

    const newRemoteRuleId = '44444444-4444-4444-8444-444444444499';
    const reconciler = new RecurringReconciliationService(
      mockDb,
      {
        findAll: vi.fn(async () => [
          {
            id: ruleId,
            user_id: userId,
            title: 'Remote Older/Different',
            description: null,
            type: 'expense',
            amount_paise: 100,
            account_id: accId,
            category_id: null,
            frequency: 'monthly',
            interval: 1,
            anchor_day_of_month: 5,
            start_date: '2026-11-05',
            end_date: null,
            next_due_date: '2026-12-05',
            last_generated_date: null,
            status: 'active',
            requires_user_confirmation: true,
            version: 2,
            deleted_at: null
          },
          {
            id: newRemoteRuleId,
            user_id: userId,
            title: 'Cloud Utility',
            description: null,
            type: 'expense',
            amount_paise: 250000,
            account_id: accId,
            category_id: null,
            frequency: 'monthly',
            interval: 1,
            anchor_day_of_month: 10,
            start_date: '2026-11-10',
            end_date: null,
            next_due_date: '2026-11-10',
            last_generated_date: null,
            status: 'active',
            requires_user_confirmation: true,
            version: 1,
            deleted_at: null
          }
        ])
      } as any,
      {
        findAll: vi.fn(async () => [])
      } as any,
      authPort
    );

    const pullRes = await reconciler.pullAndReconcile(userId);
    expect(pullRes.pulledCount).toBe(1);
    expect(localRules.get(ruleId)?.title).toBe('Local Unsynced Title'); // Pending outbox protected
    expect(localRules.get(newRemoteRuleId)?.title).toBe('Cloud Utility');
  });

  it('orders offline create -> confirm -> delete sequences so rule DELETE runs AFTER occurrence sync and defers delete on failed occurrence', async () => {
    const timeline: string[] = [];

    const mockRuleRepo = {
      insert: vi.fn(async (row) => {
        timeline.push(`rule:INSERT:${row.id}:v${row.version}`);
        return row;
      }),
      updatePartial: vi.fn(async (id, _userId, patch, expectedVersion) => {
        timeline.push(`rule:UPDATE:${id}:v${expectedVersion}->v${expectedVersion + 1}`);
        return { id, user_id: userId, ...patch, version: expectedVersion + 1 };
      }),
      softDelete: vi.fn(async (id, _userId, deletedAt, expectedVersion, targetVersion) => {
        timeline.push(`rule:DELETE:${id}:v${expectedVersion}->v${targetVersion ?? expectedVersion + 1}`);
        return {
          id,
          user_id: userId,
          deleted_at: deletedAt,
          version: targetVersion ?? expectedVersion + 1
        };
      }),
      findById: vi.fn(),
      findAll: vi.fn(async () => [])
    };

    const mockOccRepo = {
      insert: vi.fn(async (row) => {
        timeline.push(`occ:INSERT:${row.id}:${row.status}`);
        return row;
      }),
      updatePartial: vi.fn(async (id, _userId, patch, expectedVersion) => {
        timeline.push(`occ:UPDATE:${id}:${patch.status}:v${expectedVersion + 1}`);
        return { id, user_id: userId, ...patch, version: expectedVersion + 1 };
      }),
      findById: vi.fn(),
      findByRuleAndDate: vi.fn(),
      findAll: vi.fn(async () => [])
    };

    const accDispatcher = {
      dispatch: vi.fn(async (entry: LocalOutboxRecord) => {
        if (typeof entry.id === 'number') await outboxManager.markSuccess(entry.id);
      })
    } as unknown as AccountSyncDispatcher;
    const txDispatcher = {
      dispatch: vi.fn(async (entry: LocalOutboxRecord) => {
        timeline.push(`tx:${entry.operation}:${entry.entityId}`);
        if (typeof entry.id === 'number') await outboxManager.markSuccess(entry.id);
      })
    } as unknown as TransactionSyncDispatcher;

    const ruleDispatcher = new RecurringRuleSyncDispatcher(mockRuleRepo as any, authPort, outboxManager);
    const occDispatcher = new RecurringOccurrenceSyncDispatcher(mockOccRepo as any, authPort, outboxManager);

    const occ2Id = '55555555-5555-4555-8555-555555555552';
    outboxEntries = [
      {
        id: 1,
        userId,
        entity: 'recurring_rules',
        entityId: ruleId,
        operation: 'INSERT',
        payload: {
          id: ruleId,
          user_id: userId,
          title: 'Temporary Subscription',
          type: 'expense',
          amount_paise: 49900,
          account_id: accId,
          frequency: 'monthly',
          interval: 1,
          anchor_day_of_month: 25,
          start_date: '2026-11-25',
          next_due_date: '2026-11-25',
          status: 'active',
          version: 1
        },
        idempotencyKey: 'k-r-ins',
        attempts: 0,
        createdAt: new Date().toISOString()
      },
      {
        id: 2,
        userId,
        entity: 'recurring_occurrences',
        entityId: occId,
        operation: 'INSERT',
        payload: {
          id: occId,
          user_id: userId,
          recurring_rule_id: ruleId,
          occurrence_date: '2026-11-25',
          status: 'pending',
          idempotency_key: `recurring:${ruleId}:2026-11-25`,
          version: 1
        },
        idempotencyKey: 'k-o1-ins',
        attempts: 0,
        createdAt: new Date().toISOString()
      },
      {
        id: 3,
        userId,
        entity: 'transactions',
        entityId: txId,
        operation: 'INSERT',
        payload: { id: txId, user_id: userId, account_id: accId },
        idempotencyKey: 'k-tx',
        attempts: 0,
        createdAt: new Date().toISOString()
      },
      {
        id: 4,
        userId,
        entity: 'recurring_occurrences',
        entityId: occId,
        operation: 'UPDATE',
        payload: {
          id: occId,
          user_id: userId,
          recurring_rule_id: ruleId,
          occurrence_date: '2026-11-25',
          status: 'confirmed',
          transaction_id: txId,
          confirmed_at: '2026-11-25T12:00:00.000Z',
          expected_version: 1,
          version: 2
        },
        idempotencyKey: 'k-o1-upd',
        attempts: 0,
        createdAt: new Date().toISOString()
      },
      {
        id: 5,
        userId,
        entity: 'recurring_rules',
        entityId: ruleId,
        operation: 'UPDATE',
        payload: {
          id: ruleId,
          user_id: userId,
          next_due_date: '2026-12-25',
          last_generated_date: '2026-11-25',
          status: 'active',
          expected_version: 1,
          version: 2
        },
        idempotencyKey: 'k-r-upd',
        attempts: 0,
        createdAt: new Date().toISOString()
      },
      {
        id: 6,
        userId,
        entity: 'recurring_occurrences',
        entityId: occ2Id,
        operation: 'INSERT',
        payload: {
          id: occ2Id,
          user_id: userId,
          recurring_rule_id: ruleId,
          occurrence_date: '2026-12-25',
          status: 'pending',
          idempotency_key: `recurring:${ruleId}:2026-12-25`,
          version: 1
        },
        idempotencyKey: 'k-o2-ins',
        attempts: 0,
        createdAt: new Date().toISOString()
      },
      {
        id: 7,
        userId,
        entity: 'recurring_rules',
        entityId: ruleId,
        operation: 'DELETE',
        payload: {
          id: ruleId,
          user_id: userId,
          deleted_at: '2026-11-25T13:00:00.000Z',
          expected_version: 2,
          version: 3
        },
        idempotencyKey: 'k-r-del',
        attempts: 0,
        createdAt: new Date().toISOString()
      }
    ];

    const coordinator = new ManualSyncCoordinator(
      accDispatcher,
      txDispatcher,
      outboxManager,
      authPort,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ruleDispatcher,
      occDispatcher
    );

    const res = await coordinator.run();
    expect(res.failedCount).toBe(0);
    expect(outboxEntries).toHaveLength(0);
    expect(timeline).toEqual([
      `tx:INSERT:${txId}`,
      `rule:INSERT:${ruleId}:v1`,
      `rule:UPDATE:${ruleId}:v1->v2`,
      `occ:INSERT:${occId}:pending`,
      `occ:UPDATE:${occId}:confirmed:v2`,
      `occ:INSERT:${occ2Id}:pending`,
      `rule:DELETE:${ruleId}:v2->v3`
    ]);

    // Verify DELETE is safely deferred if an occurrence fails in Stage 3C
    mockOccRepo.insert.mockRejectedValueOnce(new Error('Network timeout on occurrence'));
    outboxEntries = [
      {
        id: 10,
        userId,
        entity: 'recurring_occurrences',
        entityId: occ2Id,
        operation: 'INSERT',
        payload: {
          id: occ2Id,
          user_id: userId,
          recurring_rule_id: ruleId,
          occurrence_date: '2026-12-25',
          status: 'pending',
          idempotency_key: `recurring:${ruleId}:2026-12-25`,
          version: 1
        },
        idempotencyKey: 'k-retry-occ',
        attempts: 0,
        createdAt: new Date().toISOString()
      },
      {
        id: 11,
        userId,
        entity: 'recurring_rules',
        entityId: ruleId,
        operation: 'DELETE',
        payload: {
          id: ruleId,
          user_id: userId,
          deleted_at: '2026-11-25T13:00:00.000Z',
          expected_version: 2,
          version: 3
        },
        idempotencyKey: 'k-retry-del',
        attempts: 0,
        createdAt: new Date().toISOString()
      }
    ];

    mockRuleRepo.softDelete.mockClear();
    const deferredRes = await coordinator.run();
    expect(deferredRes.failedCount).toBe(1);
    expect(deferredRes.skippedCount).toBe(1);
    expect(mockRuleRepo.softDelete).not.toHaveBeenCalled();
    expect(outboxEntries.map((e) => e.id)).toEqual([10, 11]);
  });

  describe('Semantic Idempotency & Conflict Detection in Supabase Repositories', () => {
    const buildQueryChain = (responses: {
      insert?: { data: any; error: any };
      update?: { data: any; error: any };
      selectSingle?: { data: any; error: any };
      slotSingle?: { data: any; error: any };
    }) => {
      let currentMode: 'insert' | 'update' | 'select' = 'select';
      let isSlotLookup = false;
      const chain: any = {
        from: vi.fn(() => {
          currentMode = 'select';
          isSlotLookup = false;
          return chain;
        }),
        insert: vi.fn(() => {
          currentMode = 'insert';
          return chain;
        }),
        update: vi.fn(() => {
          currentMode = 'update';
          return chain;
        }),
        select: vi.fn(() => chain),
        eq: vi.fn((col: string) => {
          if (col === 'occurrence_date') isSlotLookup = true;
          return chain;
        }),
        is: vi.fn(() => chain),
        single: vi.fn(async () =>
          currentMode === 'insert'
            ? (responses.insert ?? { data: null, error: null })
            : (responses.selectSingle ?? { data: null, error: null })
        ),
        maybeSingle: vi.fn(async () => {
          if (currentMode === 'update') return responses.update ?? { data: null, error: null };
          if (isSlotLookup && responses.slotSingle) return responses.slotSingle;
          return responses.selectSingle ?? { data: null, error: null };
        })
      };
      return chain;
    };

    it('accepts identical retry on SupabaseRecurringRuleRepository.updatePartial & rejects divergent cloud state', async () => {
      const identicalCloudRow = {
        id: ruleId,
        user_id: userId,
        title: 'Rent',
        description: null,
        type: 'expense' as const,
        amount_paise: 1500000,
        account_id: accId,
        category_id: null,
        frequency: 'monthly' as const,
        interval: 1,
        anchor_day_of_month: 5,
        start_date: '2026-11-05',
        end_date: null,
        next_due_date: '2026-12-05',
        last_generated_date: '2026-11-05',
        status: 'active' as const,
        requires_user_confirmation: true,
        version: 2,
        deleted_at: null
      };

      const retryClient = buildQueryChain({
        update: { data: null, error: null },
        selectSingle: { data: identicalCloudRow, error: null }
      });
      const ruleRepoRetry = new SupabaseRecurringRuleRepository(retryClient);

      const retried = await ruleRepoRetry.updatePartial(
        ruleId,
        userId,
        { next_due_date: '2026-12-05', last_generated_date: '2026-11-05', status: 'active' },
        1
      );
      expect(retried).toEqual(identicalCloudRow);

      // Divergent state at same version (cloud moved to paused / different next_due_date)
      const divergentClient = buildQueryChain({
        update: { data: null, error: null },
        selectSingle: {
          data: { ...identicalCloudRow, status: 'paused', next_due_date: '2027-01-05' },
          error: null
        }
      });
      const ruleRepoConflict = new SupabaseRecurringRuleRepository(divergentClient);

      await expect(
        ruleRepoConflict.updatePartial(
          ruleId,
          userId,
          { next_due_date: '2026-12-05', status: 'active' },
          1
        )
      ).rejects.toThrow(SyncConflictError);

      // Divergent softDelete tombstone timestamp/version triggers SyncConflictError
      const tombClient = buildQueryChain({
        update: { data: null, error: null },
        selectSingle: {
          data: { ...identicalCloudRow, version: 3, deleted_at: '2026-11-26T00:00:00.000Z' },
          error: null
        }
      });
      await expect(
        new SupabaseRecurringRuleRepository(tombClient).softDelete(
          ruleId,
          userId,
          '2026-11-25T10:00:00.000Z',
          1,
          2
        )
      ).rejects.toThrow(SyncConflictError);
    });

    it('rejects duplicate slot collisions, divergent confirm retries, and already-tombstoned occurrences with SyncConflictError', async () => {
      const slotOccupant = {
        id: '55555555-5555-4555-8555-555555555599', // different ID
        user_id: userId,
        recurring_rule_id: ruleId,
        occurrence_date: '2026-11-25',
        status: 'skipped' as const,
        snoozed_until_date: null,
        transaction_id: null,
        idempotency_key: `recurring:${ruleId}:2026-11-25`,
        confirmed_at: null,
        skipped_at: '2026-11-25T10:00:00.000Z',
        dismissed_at: null,
        version: 2,
        deleted_at: null
      };

      const dupSlotClient = buildQueryChain({
        insert: { data: null, error: { code: '23505', message: 'duplicate key' } },
        selectSingle: { data: null, error: null },
        slotSingle: { data: slotOccupant, error: null }
      });

      const occRepoSlot = new SupabaseRecurringOccurrenceRepository(dupSlotClient);
      await expect(
        occRepoSlot.insert({
          ...slotOccupant,
          id: occId,
          status: 'confirmed',
          transaction_id: txId,
          skipped_at: null,
          confirmed_at: '2026-11-25T12:00:00.000Z',
          version: 1
        })
      ).rejects.toThrow(SyncConflictError);

      // Divergent updatePartial (local tries to confirm txId, cloud was confirmed with another tx or skipped)
      const cloudConfirmed = {
        ...slotOccupant,
        id: occId,
        status: 'confirmed' as const,
        skipped_at: null,
        transaction_id: '66666666-6666-4666-8666-666666666699',
        confirmed_at: '2026-11-25T11:00:00.000Z',
        version: 2
      };

      const divergentOccUpdate = buildQueryChain({
        update: { data: null, error: null },
        selectSingle: { data: cloudConfirmed, error: null }
      });
      await expect(
        new SupabaseRecurringOccurrenceRepository(divergentOccUpdate).updatePartial(
          occId,
          userId,
          {
            status: 'confirmed',
            transaction_id: txId,
            confirmed_at: '2026-11-25T12:00:00.000Z'
          },
          1
        )
      ).rejects.toThrow(SyncConflictError);

      // Exact identical confirm retry succeeds cleanly despite +00:00 vs .000Z ISO string difference
      const exactRetryClient = buildQueryChain({
        update: { data: null, error: null },
        selectSingle: {
          data: {
            ...cloudConfirmed,
            transaction_id: txId,
            confirmed_at: '2026-11-25T12:00:00+00:00'
          },
          error: null
        }
      });
      const ok = await new SupabaseRecurringOccurrenceRepository(exactRetryClient).updatePartial(
        occId,
        userId,
        {
          status: 'confirmed',
          transaction_id: txId,
          confirmed_at: '2026-11-25T12:00:00.000Z'
        },
        1
      );
      expect(ok.status).toBe('confirmed');
      expect(ok.transaction_id).toBe(txId);
    });
  });
});

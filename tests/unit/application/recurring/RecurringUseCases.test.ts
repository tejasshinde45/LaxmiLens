import { describe, it, expect, beforeEach } from 'vitest';
import { CreateRecurringRuleUseCase } from '@/application/use-cases/recurring/CreateRecurringRuleUseCase';
import { UpdateRecurringRuleUseCase } from '@/application/use-cases/recurring/UpdateRecurringRuleUseCase';
import {
  PauseRecurringRuleUseCase,
  ResumeRecurringRuleUseCase
} from '@/application/use-cases/recurring/PauseResumeRecurringRuleUseCase';
import { ConfirmRecurringOccurrenceUseCase } from '@/application/use-cases/recurring/ConfirmRecurringOccurrenceUseCase';
import {
  SkipRecurringOccurrenceUseCase,
  SnoozeRecurringOccurrenceUseCase,
  DismissRecurringOccurrenceUseCase
} from '@/application/use-cases/recurring/ManageRecurringOccurrenceUseCase';
import { GetRecurringOverviewUseCase } from '@/application/use-cases/recurring/GetRecurringOverviewUseCase';
import { CreateTransactionUseCase } from '@/application/use-cases/transactions/CreateTransactionUseCase';
import { RecurringRuleRepository } from '@/domain/repositories/RecurringRuleRepository';
import { RecurringOccurrenceRepository } from '@/domain/repositories/RecurringOccurrenceRepository';
import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { CategoryRepository } from '@/domain/repositories/CategoryRepository';
import {
  TransactionFilter,
  TransactionRepository
} from '@/domain/repositories/TransactionRepository';
import { OutboxEntry, SyncPort, SyncResult } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { RecurringRule, RecurringRuleStatus } from '@/domain/entities/RecurringRule';
import {
  RecurringOccurrence,
  RecurringOccurrenceStatus
} from '@/domain/entities/RecurringOccurrence';
import { Account } from '@/domain/entities/Account';
import { Category } from '@/domain/entities/Category';
import { Transaction } from '@/domain/entities/Transaction';
import { Money } from '@/domain/value-objects/Money';
import {
  AccountId,
  CategoryId,
  RecurringOccurrenceId,
  RecurringRuleId,
  TransactionId,
  UserId,
  createAccountId,
  createCategoryId,
  createUserId
} from '@/domain/value-objects/Identifiers';
import { CategoryTypeMismatchError } from '@/domain/errors/DomainErrors';
import { DuplicateRecurringOccurrenceError } from '@/domain/errors/RecurringErrors';

class InMemoryRecurringRuleRepo implements RecurringRuleRepository {
  public rules = new Map<string, RecurringRule>();
  async findById(id: RecurringRuleId, userId: UserId) {
    const r = this.rules.get(id);
    if (!r || r.userId !== userId || r.isDeleted) return null;
    return r;
  }
  async findAll(userId: UserId) {
    return Array.from(this.rules.values()).filter((r) => r.userId === userId && !r.isDeleted);
  }
  async findByStatus(status: RecurringRuleStatus, userId: UserId) {
    return (await this.findAll(userId)).filter((r) => r.status === status);
  }
  async save(rule: RecurringRule) {
    this.rules.set(rule.id, rule);
  }
  async delete(id: RecurringRuleId, userId: UserId) {
    const r = await this.findById(id, userId);
    if (r) r.markDeleted();
  }
}

class InMemoryRecurringOccurrenceRepo implements RecurringOccurrenceRepository {
  public items = new Map<string, RecurringOccurrence>();
  public failNextSaveOnStatus?: RecurringOccurrenceStatus;

  async findById(id: RecurringOccurrenceId, userId: UserId) {
    const o = this.items.get(id);
    return o && o.userId === userId && !o.deletedAt ? o : null;
  }
  async findByRuleAndDate(ruleId: RecurringRuleId, dateStr: string, userId: UserId) {
    return (
      Array.from(this.items.values()).find(
        (o) =>
          o.userId === userId &&
          o.recurringRuleId === ruleId &&
          o.occurrenceDate === dateStr &&
          !o.deletedAt
      ) ?? null
    );
  }
  async findByRuleId(ruleId: RecurringRuleId, userId: UserId) {
    return Array.from(this.items.values()).filter(
      (o) => o.userId === userId && o.recurringRuleId === ruleId && !o.deletedAt
    );
  }
  async findByStatus(status: RecurringOccurrenceStatus, userId: UserId) {
    return Array.from(this.items.values()).filter(
      (o) => o.userId === userId && o.status === status && !o.deletedAt
    );
  }
  async findAll(userId: UserId) {
    return Array.from(this.items.values()).filter((o) => o.userId === userId && !o.deletedAt);
  }
  async save(occ: RecurringOccurrence) {
    if (this.failNextSaveOnStatus && occ.status === this.failNextSaveOnStatus) {
      this.failNextSaveOnStatus = undefined;
      throw new Error('Simulated occurrence save failure for atomic rollback test.');
    }
    const dup = Array.from(this.items.values()).find(
      (o) =>
        o.userId === occ.userId &&
        o.recurringRuleId === occ.recurringRuleId &&
        o.occurrenceDate === occ.occurrenceDate &&
        !o.deletedAt &&
        o.id !== occ.id
    );
    if (dup) throw new DuplicateRecurringOccurrenceError(occ.recurringRuleId, occ.occurrenceDate);
    this.items.set(occ.id, occ);
  }
}

class InMemoryAccountRepo implements AccountRepository {
  public accounts = new Map<string, Account>();
  async findById(id: AccountId, userId: UserId) {
    const a = this.accounts.get(id);
    return a && a.userId === userId ? a : null;
  }
  async findAll(userId: UserId) {
    return Array.from(this.accounts.values()).filter((a) => a.userId === userId);
  }
  async findActive(userId: UserId) {
    return (await this.findAll(userId)).filter((a) => !a.isArchived);
  }
  async findBySystemTag() {
    return null;
  }
  async save(account: Account) {
    this.accounts.set(account.id, account);
  }
  async delete() {}
}

class InMemoryCategoryRepo implements CategoryRepository {
  public categories = new Map<string, Category>();
  async findById(id: CategoryId, userId: UserId) {
    const c = this.categories.get(id);
    return c && (c.userId === userId || c.isDefault) ? c : null;
  }
  async findAll(userId: UserId) {
    return Array.from(this.categories.values()).filter((c) => c.userId === userId);
  }
  async findByType(type: 'income' | 'expense', userId: UserId) {
    return (await this.findAll(userId)).filter((c) => c.type === type);
  }
  async findByName() {
    return null;
  }
  async save(category: Category) {
    this.categories.set(category.id, category);
  }
  async delete() {}
}

class InMemoryTransactionRepo implements TransactionRepository {
  public txs = new Map<string, Transaction>();
  async findById(id: TransactionId, userId: UserId) {
    const t = this.txs.get(id);
    return t && t.userId === userId ? t : null;
  }
  async findByIdempotencyKey(key: string, userId: UserId) {
    return Array.from(this.txs.values()).find((t) => t.idempotencyKey === key && t.userId === userId) ?? null;
  }
  async findAll(filter: TransactionFilter) {
    return Array.from(this.txs.values()).filter((t) => t.userId === filter.userId);
  }
  async findByAccountId() {
    return [];
  }
  async count() {
    return this.txs.size;
  }
  async save(tx: Transaction) {
    this.txs.set(tx.id, tx);
  }
  async softDelete() {}
  async hardDelete() {}
}

class InMemorySyncPort implements SyncPort {
  public outbox: Array<Omit<OutboxEntry, 'id' | 'attempts' | 'createdAt'>> = [];
  async enqueue(entry: Omit<OutboxEntry, 'id' | 'attempts' | 'createdAt'>) {
    this.outbox.push(entry);
  }
  async processOutbox(): Promise<SyncResult> {
    return { pushedCount: 0, pulledCount: 0, conflictsCount: 0, errors: [] };
  }
  async getPendingCount() {
    return this.outbox.length;
  }
  async clearOutbox() {
    this.outbox = [];
  }
}

describe('Phase 8 Application Layer: Recurring Use Cases', () => {
  const userId = createUserId('11111111-1111-4111-8111-111111111111');
  const bankAccId = createAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
  const expCatId = createCategoryId('cccccccc-cccc-4ccc-8ccc-ccccccccccc1');
  const incCatId = createCategoryId('cccccccc-cccc-4ccc-8ccc-ccccccccccc2');

  let ruleRepo: InMemoryRecurringRuleRepo;
  let occRepo: InMemoryRecurringOccurrenceRepo;
  let accRepo: InMemoryAccountRepo;
  let catRepo: InMemoryCategoryRepo;
  let txRepo: InMemoryTransactionRepo;
  let syncPort: InMemorySyncPort;
  let uow: UnitOfWork;

  let createRuleUseCase: CreateRecurringRuleUseCase;
  let updateRuleUseCase: UpdateRecurringRuleUseCase;
  let pauseUseCase: PauseRecurringRuleUseCase;
  let resumeUseCase: ResumeRecurringRuleUseCase;
  let confirmUseCase: ConfirmRecurringOccurrenceUseCase;
  let skipUseCase: SkipRecurringOccurrenceUseCase;
  let snoozeUseCase: SnoozeRecurringOccurrenceUseCase;
  let dismissUseCase: DismissRecurringOccurrenceUseCase;
  let overviewUseCase: GetRecurringOverviewUseCase;

  beforeEach(() => {
    ruleRepo = new InMemoryRecurringRuleRepo();
    occRepo = new InMemoryRecurringOccurrenceRepo();
    accRepo = new InMemoryAccountRepo();
    catRepo = new InMemoryCategoryRepo();
    txRepo = new InMemoryTransactionRepo();
    syncPort = new InMemorySyncPort();

    // Transactional rollback simulation with snapshotting across nested UnitOfWork
    let txDepth = 0;
    let snapshot: {
      rules: Map<string, RecurringRule>;
      occs: Map<string, RecurringOccurrence>;
      txs: Map<string, Transaction>;
      outbox: typeof syncPort.outbox;
    } | null = null;

    uow = {
      run: async <T>(work: () => Promise<T>): Promise<T> => {
        const isRoot = txDepth === 0;
        if (isRoot) {
          snapshot = {
            rules: new Map(
              Array.from(ruleRepo.rules.entries()).map(([k, v]) => [
                k,
                new RecurringRule({ ...v, amount: v.amount })
              ])
            ),
            occs: new Map(
              Array.from(occRepo.items.entries()).map(([k, v]) => [
                k,
                new RecurringOccurrence({ ...v })
              ])
            ),
            txs: new Map(txRepo.txs),
            outbox: [...syncPort.outbox]
          };
        }
        txDepth++;
        try {
          return await work();
        } catch (err) {
          if (isRoot && snapshot) {
            ruleRepo.rules = snapshot.rules;
            occRepo.items = snapshot.occs;
            txRepo.txs = snapshot.txs;
            syncPort.outbox = snapshot.outbox;
          }
          throw err;
        } finally {
          txDepth--;
          if (isRoot) snapshot = null;
        }
      }
    };

    accRepo.accounts.set(
      bankAccId,
      new Account({
        id: bankAccId,
        userId,
        name: 'HDFC Savings',
        accountType: 'bank',
        openingBalance: Money.fromPaise(10000000, 'INR'),
        isArchived: false
      })
    );

    catRepo.categories.set(
      expCatId,
      new Category({
        id: expCatId,
        userId,
        name: 'Rent & Housing',
        type: 'expense',
        icon: 'Home',
        color: '#D6AD60',
        isArchived: false
      })
    );

    catRepo.categories.set(
      incCatId,
      new Category({
        id: incCatId,
        userId,
        name: 'Salary',
        type: 'income',
        icon: 'Briefcase',
        color: '#72B895',
        isArchived: false
      })
    );

    const createTxUseCase = new CreateTransactionUseCase(
      txRepo,
      accRepo,
      catRepo,
      syncPort,
      uow
    );

    createRuleUseCase = new CreateRecurringRuleUseCase(
      ruleRepo,
      occRepo,
      accRepo,
      catRepo,
      syncPort,
      uow
    );
    updateRuleUseCase = new UpdateRecurringRuleUseCase(
      ruleRepo,
      occRepo,
      accRepo,
      catRepo,
      syncPort,
      uow
    );
    pauseUseCase = new PauseRecurringRuleUseCase(ruleRepo, syncPort, uow);
    resumeUseCase = new ResumeRecurringRuleUseCase(ruleRepo, occRepo, syncPort, uow);
    confirmUseCase = new ConfirmRecurringOccurrenceUseCase(
      ruleRepo,
      occRepo,
      txRepo,
      createTxUseCase,
      syncPort,
      uow
    );
    skipUseCase = new SkipRecurringOccurrenceUseCase(ruleRepo, occRepo, syncPort, uow);
    snoozeUseCase = new SnoozeRecurringOccurrenceUseCase(ruleRepo, occRepo, syncPort, uow);
    dismissUseCase = new DismissRecurringOccurrenceUseCase(ruleRepo, occRepo, syncPort, uow);
    overviewUseCase = new GetRecurringOverviewUseCase(ruleRepo, occRepo, accRepo, catRepo);
  });

  it('rejects category type mismatch and never silently creates transactions on read or overdue dates', async () => {
    await expect(
      createRuleUseCase.execute({
        userId,
        title: 'Invalid Expense With Salary Cat',
        type: 'expense',
        amountPaise: 500000,
        accountId: bankAccId,
        categoryId: incCatId,
        frequency: 'monthly',
        startDate: '2026-11-01'
      })
    ).rejects.toThrow(CategoryTypeMismatchError);

    const created = await createRuleUseCase.execute({
      userId,
      title: 'House Rent',
      type: 'expense',
      amountPaise: 2500000,
      accountId: bankAccId,
      categoryId: expCatId,
      frequency: 'monthly',
      startDate: '2026-11-05'
    });

    const overview = await overviewUseCase.execute(userId, { asOfDate: '2026-11-25' });
    expect(overview.overdue).toHaveLength(1);
    expect(overview.overdue[0].title).toBe('House Rent');
    expect(overview.overdue[0].daysUntilDue).toBe(-20);
    // CRITICAL: Still ZERO transactions in ledger!
    expect(txRepo.txs.size).toBe(0);
    expect(created.requiresUserConfirmation).toBe(true);
  });

  it('generates real ledger transaction only upon confirmation and handles idempotent retries safely', async () => {
    const rule = await createRuleUseCase.execute({
      userId,
      title: 'Monthly Salary',
      type: 'income',
      amountPaise: 8500000,
      accountId: bankAccId,
      categoryId: incCatId,
      frequency: 'monthly',
      startDate: '2026-11-25'
    });

    const beforeConfirm = await overviewUseCase.execute(userId, { asOfDate: '2026-11-25' });
    expect(beforeConfirm.dueToday).toHaveLength(1);
    const dueReminder = beforeConfirm.dueToday[0];

    const firstConfirm = await confirmUseCase.execute({
      userId,
      recurringRuleId: rule.id,
      occurrenceDate: dueReminder.occurrenceDate,
      occurrenceId: dueReminder.occurrenceId
    });

    expect(firstConfirm.alreadyConfirmed).toBe(false);
    expect(firstConfirm.nextDueDate).toBe('2026-12-25');
    expect(txRepo.txs.size).toBe(1);

    const savedTx = Array.from(txRepo.txs.values())[0];
    expect(savedTx.amountPaise).toBe(8500000);
    expect(savedTx.type).toBe('income');
    expect(savedTx.idempotencyKey).toBe(dueReminder.idempotencyKey);

    // Retry same confirmation: must return same transaction idempotently without creating second tx
    const secondConfirm = await confirmUseCase.execute({
      userId,
      recurringRuleId: rule.id,
      occurrenceDate: dueReminder.occurrenceDate,
      occurrenceId: dueReminder.occurrenceId
    });
    expect(secondConfirm.alreadyConfirmed).toBe(true);
    expect(secondConfirm.transactionId).toBe(firstConfirm.transactionId);
    expect(txRepo.txs.size).toBe(1);

    const afterOverview = await overviewUseCase.execute(userId, { asOfDate: '2026-11-25' });
    expect(afterOverview.dueToday).toHaveLength(0);
    expect(afterOverview.upcoming).toHaveLength(1);
    expect(afterOverview.upcoming[0].occurrenceDate).toBe('2026-12-25');
    expect(afterOverview.recentlyGenerated).toHaveLength(1);
  });

  it('rolls back created transaction & outbox cleanly if confirmation persistence fails mid-UnitOfWork', async () => {
    const rule = await createRuleUseCase.execute({
      userId,
      title: 'Fiber Internet',
      type: 'expense',
      amountPaise: 99900,
      accountId: bankAccId,
      categoryId: expCatId,
      frequency: 'monthly',
      startDate: '2026-11-25'
    });

    const outboxBefore = syncPort.outbox.length;
    occRepo.failNextSaveOnStatus = 'confirmed';

    await expect(
      confirmUseCase.execute({
        userId,
        recurringRuleId: rule.id,
        occurrenceDate: '2026-11-25'
      })
    ).rejects.toThrow('Simulated occurrence save failure');

    // Transaction, rule advancement, and outbox mutations MUST be completely rolled back
    expect(txRepo.txs.size).toBe(0);
    expect(syncPort.outbox.length).toBe(outboxBefore);

    const occ = await occRepo.findByRuleAndDate(
      rule.id as RecurringRuleId,
      '2026-11-25',
      userId
    );
    expect(occ?.status).toBe('pending');
  });

  it('supports snooze wakeups, skip without transaction, dismiss, update, and pause/resume lifecycle', async () => {
    const rule = await createRuleUseCase.execute({
      userId,
      title: 'Electric Bill',
      type: 'expense',
      amountPaise: 320000,
      accountId: bankAccId,
      categoryId: expCatId,
      frequency: 'monthly',
      startDate: '2026-11-25'
    });

    // Snooze to Dec 2 (today 2026-11-25 -> moves out of dueToday into snoozed)
    await snoozeUseCase.execute({
      userId,
      recurringRuleId: rule.id,
      occurrenceDate: '2026-11-25',
      snoozeUntilDate: '2099-12-02'
    });

    const whileSnoozed = await overviewUseCase.execute(userId, { asOfDate: '2099-11-26' });
    expect(whileSnoozed.dueToday).toHaveLength(0);
    expect(whileSnoozed.snoozed).toHaveLength(1);

    // Wakes up on Dec 2
    const onSnoozeDay = await overviewUseCase.execute(userId, { asOfDate: '2099-12-02' });
    expect(onSnoozeDay.dueToday).toHaveLength(1);
    expect(onSnoozeDay.snoozed).toHaveLength(0);

    // Skip occurrence -> advances to 2026-12-25 with ZERO ledger transactions created
    await skipUseCase.execute({
      userId,
      recurringRuleId: rule.id,
      occurrenceDate: '2026-11-25'
    });
    expect(txRepo.txs.size).toBe(0);

    // Update amount
    const updated = await updateRuleUseCase.execute({
      id: rule.id,
      userId,
      amountPaise: 350000
    });
    expect(updated.amountPaise).toBe(350000);

    // Pause hides reminders
    await pauseUseCase.execute({ id: rule.id, userId });
    const pausedOverview = await overviewUseCase.execute(userId, { asOfDate: '2026-12-25' });
    expect(pausedOverview.dueToday).toHaveLength(0);
    expect(pausedOverview.summary.pausedSchedulesCount).toBe(1);

    // Resume brings reminder back
    await resumeUseCase.execute({ id: rule.id, userId });
    const resumedOverview = await overviewUseCase.execute(userId, { asOfDate: '2026-12-25' });
    expect(resumedOverview.dueToday).toHaveLength(1);

    // Dismiss advances without creating transaction
    await dismissUseCase.execute({
      userId,
      recurringRuleId: rule.id,
      occurrenceDate: '2026-12-25'
    });
    expect(txRepo.txs.size).toBe(0);
    const afterDismiss = await overviewUseCase.execute(userId, { asOfDate: '2026-12-25' });
    expect(afterDismiss.upcoming[0].occurrenceDate).toBe('2027-01-25');
  });
});

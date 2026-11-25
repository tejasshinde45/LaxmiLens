import { describe, it, expect, beforeEach } from 'vitest';
import {
  Budget,
  Category,
  Account,
  Transaction,
  RecurringRule,
  RecurringOccurrence,
  Notification,
  NotificationPreference,
  Money,
  createAccountId,
  createBudgetId,
  createCategoryId,
  createRecurringRuleId,
  createTransactionId,
  createUserId
} from '@/domain';
import {
  NotificationFilterOptions,
  NotificationRepository
} from '@/domain/repositories/NotificationRepository';
import { NotificationPreferenceRepository } from '@/domain/repositories/NotificationPreferenceRepository';
import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { CategoryRepository } from '@/domain/repositories/CategoryRepository';
import { BudgetRepository } from '@/domain/repositories/BudgetRepository';
import {
  TransactionFilter,
  TransactionRepository
} from '@/domain/repositories/TransactionRepository';
import { RecurringRuleRepository } from '@/domain/repositories/RecurringRuleRepository';
import { RecurringOccurrenceRepository } from '@/domain/repositories/RecurringOccurrenceRepository';
import { OutboxEntry, SyncPort, SyncResult } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import {
  EvaluateFinancialAlertsUseCase,
  GetBudgetsOverviewUseCase,
  GetRecurringOverviewUseCase,
  GetNotificationsUseCase,
  MarkNotificationReadUseCase,
  MarkAllNotificationsReadUseCase,
  DismissNotificationUseCase,
  GetNotificationPreferencesUseCase,
  UpdateNotificationPreferencesUseCase
} from '@/application';
import { DuplicateNotificationError } from '@/domain/errors/NotificationErrors';

const USER_ID = createUserId('11111111-1111-4111-8111-111111111111');
const ACCOUNT_ID = createAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const CATEGORY_FOOD_ID = createCategoryId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const CATEGORY_UTILITY_ID = createCategoryId('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
const BUDGET_ID = createBudgetId('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
const RULE_ID = createRecurringRuleId('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

type OutboxInput = Omit<OutboxEntry, 'id' | 'attempts' | 'createdAt'>;

class InMemoryNotificationRepo implements NotificationRepository {
  public records = new Map<string, Notification>();
  private snapshot: Map<string, Notification> | null = null;

  public beginTx() {
    this.snapshot = new Map(this.records);
  }
  public commitTx() {
    this.snapshot = null;
  }
  public rollbackTx() {
    if (this.snapshot) {
      this.records = this.snapshot;
      this.snapshot = null;
    }
  }

  async findById(id: string, userId: string) {
    const found = this.records.get(id);
    if (!found || found.userId !== userId || found.deletedAt) return null;
    return found;
  }

  async findByDedupeKey(userId: string, dedupeKey: string) {
    const matches = Array.from(this.records.values()).filter(
      (n) => n.userId === userId && n.dedupeKey === dedupeKey
    );
    return matches.find((n) => !n.deletedAt) ?? matches[0] ?? null;
  }

  async findAll(userId: string, filter?: NotificationFilterOptions) {
    return Array.from(this.records.values())
      .filter((n) => {
        if (n.userId !== userId) return false;
        if (!filter?.includeDeleted && n.deletedAt) return false;
        if (filter?.status && n.status !== filter.status) return false;
        if (filter?.category && n.category !== filter.category) return false;
        if (filter?.severity && n.severity !== filter.severity) return false;
        return true;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async countUnread(userId: string) {
    return (await this.findAll(userId, { status: 'unread' })).length;
  }

  async save(notification: Notification) {
    const conflict = Array.from(this.records.values()).find(
      (n) =>
        n.userId === notification.userId &&
        n.dedupeKey === notification.dedupeKey &&
        n.id !== notification.id
    );
    if (conflict) throw new DuplicateNotificationError(notification.dedupeKey);
    this.records.set(notification.id, notification);
  }

  async saveMany(notifications: Notification[]) {
    for (const notification of notifications) {
      await this.save(notification);
    }
  }
}

class InMemoryNotificationPreferenceRepo implements NotificationPreferenceRepository {
  public records = new Map<string, NotificationPreference>();
  private snapshot: Map<string, NotificationPreference> | null = null;

  public beginTx() {
    this.snapshot = new Map(this.records);
  }
  public commitTx() {
    this.snapshot = null;
  }
  public rollbackTx() {
    if (this.snapshot) {
      this.records = this.snapshot;
      this.snapshot = null;
    }
  }

  async findByUserId(userId: string) {
    return this.records.get(userId) ?? null;
  }

  async save(preference: NotificationPreference) {
    this.records.set(preference.userId, preference);
  }
}

class InMemorySyncOutbox implements SyncPort {
  public entries: OutboxInput[] = [];
  public failNextEnqueue = false;
  private snapshot: OutboxInput[] | null = null;

  public beginTx() {
    this.snapshot = [...this.entries];
  }
  public commitTx() {
    this.snapshot = null;
  }
  public rollbackTx() {
    if (this.snapshot) {
      this.entries = this.snapshot;
      this.snapshot = null;
    }
  }

  async enqueue(entry: OutboxInput): Promise<void> {
    if (this.failNextEnqueue) {
      this.failNextEnqueue = false;
      throw new Error('Simulated outbox failure');
    }
    this.entries.push(entry);
  }

  async processOutbox(): Promise<SyncResult> {
    return { pushedCount: 0, pulledCount: 0, conflictsCount: 0, errors: [] };
  }
  async getPendingCount(): Promise<number> {
    return this.entries.length;
  }
  async clearOutbox(): Promise<void> {
    this.entries = [];
  }
}

class InMemoryUnitOfWork implements UnitOfWork {
  constructor(
    private readonly notifRepo: InMemoryNotificationRepo,
    private readonly prefRepo: InMemoryNotificationPreferenceRepo,
    private readonly outbox: InMemorySyncOutbox
  ) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    this.notifRepo.beginTx();
    this.prefRepo.beginTx();
    this.outbox.beginTx();
    try {
      const res = await work();
      this.notifRepo.commitTx();
      this.prefRepo.commitTx();
      this.outbox.commitTx();
      return res;
    } catch (error) {
      this.notifRepo.rollbackTx();
      this.prefRepo.rollbackTx();
      this.outbox.rollbackTx();
      throw error;
    }
  }
}

describe('Phase 9 Stages 1-3: Notification Use Cases', () => {
  let notificationRepo: InMemoryNotificationRepo;
  let preferenceRepo: InMemoryNotificationPreferenceRepo;
  let syncOutbox: InMemorySyncOutbox;
  let unitOfWork: InMemoryUnitOfWork;

  let transactions: Transaction[];
  let budgets: Budget[];
  let recurringRules: RecurringRule[];
  let recurringOccurrences: RecurringOccurrence[];
  let accounts: Account[];
  let categories: Category[];

  let evaluateUseCase: EvaluateFinancialAlertsUseCase;
  let getNotificationsUseCase: GetNotificationsUseCase;
  let markReadUseCase: MarkNotificationReadUseCase;
  let markAllReadUseCase: MarkAllNotificationsReadUseCase;
  let dismissUseCase: DismissNotificationUseCase;
  let getPrefsUseCase: GetNotificationPreferencesUseCase;
  let updatePrefsUseCase: UpdateNotificationPreferencesUseCase;

  beforeEach(() => {
    notificationRepo = new InMemoryNotificationRepo();
    preferenceRepo = new InMemoryNotificationPreferenceRepo();
    syncOutbox = new InMemorySyncOutbox();
    unitOfWork = new InMemoryUnitOfWork(notificationRepo, preferenceRepo, syncOutbox);

    accounts = [
      new Account({
        id: ACCOUNT_ID,
        userId: USER_ID,
        name: 'Primary Checking',
        accountType: 'bank',
        openingBalancePaise: 5_000_000,
        currency: 'INR',
        isArchived: false
      })
    ];

    categories = [
      new Category({
        id: CATEGORY_FOOD_ID,
        userId: USER_ID,
        name: 'Food',
        type: 'expense',
        icon: 'utensils',
        color: '#f59e0b',
        isDefault: false,
        isArchived: false
      }),
      new Category({
        id: CATEGORY_UTILITY_ID,
        userId: USER_ID,
        name: 'Utilities',
        type: 'expense',
        icon: 'bolt',
        color: '#3b82f6',
        isDefault: false,
        isArchived: false
      })
    ];

    budgets = [
      new Budget({
        id: BUDGET_ID,
        userId: USER_ID,
        categoryId: CATEGORY_FOOD_ID,
        period: '2026-05',
        limitPaise: 1_000_000 // ₹10,000
      })
    ];

    transactions = [];
    recurringRules = [];
    recurringOccurrences = [];

    const accountRepo: AccountRepository = {
      findById: async (id) => accounts.find((a) => a.id === id) ?? null,
      findByUserId: async (userId) => accounts.filter((a) => a.userId === userId),
      findAll: async (userId) => accounts.filter((a) => a.userId === userId),
      save: async () => {},
      saveBatch: async () => {},
      archive: async () => {},
      restore: async () => {}
    };

    const categoryRepo: CategoryRepository = {
      findById: async (id) => categories.find((c) => c.id === id) ?? null,
      findByUserId: async (userId) => categories.filter((c) => c.userId === userId),
      findAll: async (userId) => categories.filter((c) => c.userId === userId),
      save: async () => {},
      saveBatch: async () => {},
      archive: async () => {},
      seedDefaults: async () => []
    };

    const budgetRepo: BudgetRepository = {
      findById: async (id) => budgets.find((b) => b.id === id) ?? null,
      findByPeriod: async (period, userId) =>
        budgets.filter((b) => b.userId === userId && b.period === period && !b.isDeleted),
      findByCategoryAndPeriod: async (categoryId, period, userId) =>
        budgets.find(
          (b) =>
            b.userId === userId &&
            b.categoryId === categoryId &&
            b.period === period &&
            !b.isDeleted
        ) ?? null,
      save: async () => {},
      delete: async () => {}
    };

    const transactionRepo: TransactionRepository = {
      findById: async (id) => transactions.find((t) => t.id === id) ?? null,
      findByIdempotencyKey: async () => null,
      findByAccount: async (accountId, userId) =>
        transactions.filter(
          (t) => t.userId === userId && t.accountId === accountId && !t.deletedAt
        ),
      findMany: async (filter: TransactionFilter) =>
        transactions.filter((t) => {
          if (t.userId !== filter.userId) return false;
          if (!filter.includeDeleted && t.deletedAt) return false;
          if (filter.types && !filter.types.includes(t.type)) return false;
          if (filter.dateRange) {
            if (t.transactionDate < filter.dateRange.startDate) return false;
            if (t.transactionDate > filter.dateRange.endDate) return false;
          }
          return true;
        }),
      save: async () => {},
      saveBatch: async () => {},
      softDelete: async () => {}
    };

    const recurringRuleRepo: RecurringRuleRepository = {
      findById: async (id) => recurringRules.find((r) => r.id === id) ?? null,
      findAll: async (userId) => recurringRules.filter((r) => r.userId === userId && !r.isDeleted),
      findByStatus: async () => [],
      save: async () => {},
      delete: async () => {}
    };

    const recurringOccurrenceRepo: RecurringOccurrenceRepository = {
      findById: async (id) => recurringOccurrences.find((o) => o.id === id) ?? null,
      findByRuleAndDate: async (ruleId, dateStr, userId) =>
        recurringOccurrences.find(
          (o) =>
            o.userId === userId &&
            o.recurringRuleId === ruleId &&
            o.occurrenceDate === dateStr &&
            !o.deletedAt
        ) ?? null,
      findByTransactionId: async () => null,
      findAll: async (userId) =>
        recurringOccurrences.filter((o) => o.userId === userId && !o.deletedAt),
      save: async () => {}
    };

    const getBudgetsOverview = new GetBudgetsOverviewUseCase(
      budgetRepo,
      transactionRepo,
      categoryRepo
    );
    const getRecurringOverview = new GetRecurringOverviewUseCase(
      recurringRuleRepo,
      recurringOccurrenceRepo,
      accountRepo,
      categoryRepo
    );

    evaluateUseCase = new EvaluateFinancialAlertsUseCase(
      notificationRepo,
      preferenceRepo,
      getBudgetsOverview,
      getRecurringOverview,
      syncOutbox,
      unitOfWork
    );
    getNotificationsUseCase = new GetNotificationsUseCase(notificationRepo);
    markReadUseCase = new MarkNotificationReadUseCase(notificationRepo, syncOutbox, unitOfWork);
    markAllReadUseCase = new MarkAllNotificationsReadUseCase(
      notificationRepo,
      syncOutbox,
      unitOfWork
    );
    dismissUseCase = new DismissNotificationUseCase(notificationRepo, syncOutbox, unitOfWork);
    getPrefsUseCase = new GetNotificationPreferencesUseCase(preferenceRepo);
    updatePrefsUseCase = new UpdateNotificationPreferencesUseCase(
      preferenceRepo,
      syncOutbox,
      unitOfWork
    );
  });

  const addExpenseTx = (id: string, amountPaise: number, dateStr = '2026-05-05') => {
    transactions.push(
      new Transaction({
        id: createTransactionId(id),
        userId: USER_ID,
        accountId: ACCOUNT_ID,
        categoryId: CATEGORY_FOOD_ID,
        type: 'expense',
        amountPaise,
        title: 'Food spend',
        transactionDate: new Date(`${dateStr}T12:00:00.000Z`),
        idempotencyKey: `idem-${id}`,
        status: 'cleared'
      })
    );
  };

  it('uses one stable recurring notification identity across upcoming -> due_today -> overdue progression', async () => {
    recurringRules.push(
      new RecurringRule({
        id: RULE_ID,
        userId: USER_ID,
        title: 'Fiber Internet',
        type: 'expense',
        amount: Money.fromPaise(99900),
        accountId: ACCOUNT_ID,
        categoryId: CATEGORY_UTILITY_ID,
        frequency: 'monthly',
        interval: 1,
        startDate: '2026-05-10',
        nextDueDate: '2026-05-10',
        status: 'active',
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        updatedAt: new Date('2026-05-01T00:00:00.000Z')
      })
    );

    // 2 days before due date -> info (upcoming)
    const r1 = await evaluateUseCase.execute(USER_ID, { asOfDate: '2026-05-08', period: '2026-05' });
    expect(r1.createdCount).toBe(1);
    expect(r1.unreadCount).toBe(1);
    let list = await getNotificationsUseCase.execute(USER_ID);
    expect(list.totalCount).toBe(1);
    const stableId = list.notifications[0]!.id;
    expect(list.notifications[0]!.severity).toBe('info');
    expect(list.notifications[0]!.dedupeKey).toBe(`recurring_payment:${RULE_ID}:2026-05-10`);

    // Repeated evaluation same day -> no churn
    const r1Repeat = await evaluateUseCase.execute(USER_ID, {
      asOfDate: '2026-05-08',
      period: '2026-05'
    });
    expect(r1Repeat.createdCount).toBe(0);
    expect(r1Repeat.updatedCount).toBe(0);
    expect(r1Repeat.unchangedCount).toBe(1);

    // Due today -> same notification promoted to warning
    const r2 = await evaluateUseCase.execute(USER_ID, { asOfDate: '2026-05-10', period: '2026-05' });
    expect(r2.createdCount).toBe(0);
    expect(r2.updatedCount).toBe(1);
    list = await getNotificationsUseCase.execute(USER_ID);
    expect(list.totalCount).toBe(1);
    expect(list.notifications[0]!.id).toBe(stableId);
    expect(list.notifications[0]!.severity).toBe('warning');
    expect(list.notifications[0]!.title).toContain('Payment due today');

    // Overdue -> same notification promoted to critical
    const r3 = await evaluateUseCase.execute(USER_ID, { asOfDate: '2026-05-12', period: '2026-05' });
    expect(r3.createdCount).toBe(0);
    expect(r3.updatedCount).toBe(1);
    list = await getNotificationsUseCase.execute(USER_ID);
    expect(list.totalCount).toBe(1);
    expect(list.notifications[0]!.id).toBe(stableId);
    expect(list.notifications[0]!.severity).toBe('critical');
    expect(list.notifications[0]!.title).toContain('Overdue payment');

    // Outbox has 1 INSERT + 2 UPDATE entries for that single ID
    const notifOutbox = syncOutbox.entries.filter((e) => e.entity === 'notifications');
    expect(notifOutbox.map((e) => e.operation)).toEqual(['INSERT', 'UPDATE', 'UPDATE']);
    expect(new Set(notifOutbox.map((e) => e.entityId)).size).toBe(1);
  });

  it('promotes budget_warning -> budget_exceeded monotonically without creating a second notification and preserves readAt', async () => {
    addExpenseTx('10000000-0000-4000-8000-000000000001', 850_000); // 85%

    const r1 = await evaluateUseCase.execute(USER_ID, { asOfDate: '2026-05-10', period: '2026-05' });
    expect(r1.createdCount).toBe(1);
    let list = await getNotificationsUseCase.execute(USER_ID);
    expect(list.totalCount).toBe(1);
    const notifId = list.notifications[0]!.id;
    expect(list.notifications[0]!.category).toBe('budget_warning');
    expect(list.notifications[0]!.severity).toBe('warning');

    // User marks alert read before it crosses 100%
    const readNotif = await markReadUseCase.execute(USER_ID, notifId);
    expect(readNotif.status).toBe('read');
    const originalReadAt = readNotif.readAt!;
    expect(originalReadAt).toBeTruthy();

    // Spend rises above limit -> 105%
    addExpenseTx('10000000-0000-4000-8000-000000000002', 200_000);
    const r2 = await evaluateUseCase.execute(USER_ID, { asOfDate: '2026-05-12', period: '2026-05' });
    expect(r2.createdCount).toBe(0);
    expect(r2.updatedCount).toBe(1);
    expect(r2.unreadCount).toBe(0); // stays read!

    list = await getNotificationsUseCase.execute(USER_ID);
    expect(list.totalCount).toBe(1);
    expect(list.notifications[0]!.id).toBe(notifId);
    expect(list.notifications[0]!.category).toBe('budget_exceeded');
    expect(list.notifications[0]!.severity).toBe('critical');
    expect(list.notifications[0]!.status).toBe('read');
    expect(list.notifications[0]!.readAt).toBe(originalReadAt);

    // Deleting second expense back down to 85% must NEVER downgrade budget_exceeded -> budget_warning
    transactions.pop();
    const r3 = await evaluateUseCase.execute(USER_ID, { asOfDate: '2026-05-13', period: '2026-05' });
    expect(r3.updatedCount).toBe(0);
    list = await getNotificationsUseCase.execute(USER_ID);
    expect(list.notifications[0]!.category).toBe('budget_exceeded');
    expect(list.notifications[0]!.severity).toBe('critical');
  });

  it('preserves dismissed status and dismissedAt across urgency promotions', async () => {
    recurringRules.push(
      new RecurringRule({
        id: RULE_ID,
        userId: USER_ID,
        title: 'Electricity Bill',
        type: 'expense',
        amount: Money.fromPaise(250_000),
        accountId: ACCOUNT_ID,
        categoryId: CATEGORY_UTILITY_ID,
        frequency: 'monthly',
        interval: 1,
        startDate: '2026-05-10',
        nextDueDate: '2026-05-10',
        status: 'active',
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        updatedAt: new Date('2026-05-01T00:00:00.000Z')
      })
    );

    await evaluateUseCase.execute(USER_ID, { asOfDate: '2026-05-09', period: '2026-05' });
    const list1 = await getNotificationsUseCase.execute(USER_ID);
    const dismissed = await dismissUseCase.execute(USER_ID, list1.notifications[0]!.id);
    expect(dismissed.status).toBe('dismissed');
    const dismissedAt = dismissed.dismissedAt!;

    // Escalate to overdue on 2026-05-12 -> status remains dismissed and dismissedAt unchanged
    await evaluateUseCase.execute(USER_ID, { asOfDate: '2026-05-12', period: '2026-05' });
    const list2 = await getNotificationsUseCase.execute(USER_ID);
    expect(list2.unreadCount).toBe(0);
    expect(list2.notifications[0]!.status).toBe('dismissed');
    expect(list2.notifications[0]!.dismissedAt).toBe(dismissedAt);
    expect(list2.notifications[0]!.severity).toBe('critical');
  });

  it('supports markAllAsRead and handles concurrent evaluations without duplicate alerts', async () => {
    addExpenseTx('10000000-0000-4000-8000-000000000003', 850_000);
    recurringRules.push(
      new RecurringRule({
        id: RULE_ID,
        userId: USER_ID,
        title: 'Rent',
        type: 'expense',
        amount: Money.fromPaise(1_500_000),
        accountId: ACCOUNT_ID,
        categoryId: CATEGORY_UTILITY_ID,
        frequency: 'monthly',
        interval: 1,
        startDate: '2026-05-10',
        nextDueDate: '2026-05-10',
        status: 'active',
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        updatedAt: new Date('2026-05-01T00:00:00.000Z')
      })
    );

    const txSnapshot = [...transactions];
    const budgetSnapshot = [...budgets];
    const ruleSnapshot = [...recurringRules];

    const [a, b, c] = await Promise.all([
      evaluateUseCase.execute(USER_ID, { asOfDate: '2026-05-10', period: '2026-05' }),
      evaluateUseCase.execute(USER_ID, { asOfDate: '2026-05-10', period: '2026-05' }),
      evaluateUseCase.execute(USER_ID, { asOfDate: '2026-05-10', period: '2026-05' })
    ]);

    expect(a.createdCount + b.createdCount + c.createdCount).toBe(2);
    const list = await getNotificationsUseCase.execute(USER_ID);
    expect(list.totalCount).toBe(2);
    expect(list.unreadCount).toBe(2);

    // Zero mutations to financial records
    expect(transactions).toEqual(txSnapshot);
    expect(budgets).toEqual(budgetSnapshot);
    expect(recurringRules).toEqual(ruleSnapshot);

    const markAllRes = await markAllReadUseCase.execute(USER_ID);
    expect(markAllRes.updatedCount).toBe(2);
    const afterReadAll = await getNotificationsUseCase.execute(USER_ID);
    expect(afterReadAll.unreadCount).toBe(0);
  });

  it('returns default preferences without DB writes and applies user preference filters cleanly', async () => {
    const initialPrefs = await getPrefsUseCase.execute(USER_ID);
    expect(initialPrefs.isDefault).toBe(true);
    expect(initialPrefs.upcomingLeadDays).toBe(3);
    expect(preferenceRepo.records.size).toBe(0);
    expect(syncOutbox.entries.length).toBe(0);

    const saved = await updatePrefsUseCase.execute({
      userId: USER_ID,
      budgetWarningEnabled: false,
      upcomingLeadDays: 1
    });
    expect(saved.isDefault).toBe(false);
    expect(saved.budgetWarningEnabled).toBe(false);
    expect(saved.upcomingLeadDays).toBe(1);
    expect(preferenceRepo.records.size).toBe(1);
    expect(syncOutbox.entries.some((e) => e.entity === 'notification_preferences')).toBe(true);

    // 85% budget spend should be suppressed when budgetWarningEnabled = false
    addExpenseTx('10000000-0000-4000-8000-000000000004', 850_000);
    const r1 = await evaluateUseCase.execute(USER_ID, { asOfDate: '2026-05-10', period: '2026-05' });
    expect(r1.createdCount).toBe(0);

    // 105% budget spend still fires because budgetExceededEnabled remains true
    addExpenseTx('10000000-0000-4000-8000-000000000005', 200_000);
    const r2 = await evaluateUseCase.execute(USER_ID, { asOfDate: '2026-05-10', period: '2026-05' });
    expect(r2.createdCount).toBe(1);
  });

  it('rolls back notification writes atomically if outbox enqueue fails', async () => {
    addExpenseTx('10000000-0000-4000-8000-000000000006', 850_000);
    syncOutbox.failNextEnqueue = true;

    await expect(
      evaluateUseCase.execute(USER_ID, { asOfDate: '2026-05-10', period: '2026-05' })
    ).rejects.toThrow('Simulated outbox failure');

    expect(notificationRepo.records.size).toBe(0);
    expect(syncOutbox.entries.length).toBe(0);
  });
});

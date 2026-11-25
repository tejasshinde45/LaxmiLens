import { LaxmiLensDB } from './DexieDatabase';
import { AuthPort } from '@/application/ports/AuthPort';
import { defaultAuthAdapter } from '@/infrastructure/auth/SupabaseAuthAdapter';
import { validateUserId, isValidUuid, UserId } from '@/domain/value-objects/Identifiers';
import {
  NoActiveDatabaseSessionError,
  StaleSessionError,
  UnauthorizedDatabaseAccessError
} from './errors/DatabaseErrors';
import { DexieAccountRepository } from './repositories/DexieAccountRepository';
import { DexieTransactionRepository } from './repositories/DexieTransactionRepository';
import { DexieCategoryRepository } from './repositories/DexieCategoryRepository';
import { DexieProfileRepository } from './repositories/DexieProfileRepository';
import { DexieLenderRepository } from './repositories/DexieLenderRepository';
import { DexieBorrowingRepository } from './repositories/DexieBorrowingRepository';
import { DexieBudgetRepository } from './repositories/DexieBudgetRepository';
import { DexieRecurringRuleRepository } from './repositories/DexieRecurringRuleRepository';
import { DexieRecurringOccurrenceRepository } from './repositories/DexieRecurringOccurrenceRepository';
import { DexieNotificationRepository } from './repositories/DexieNotificationRepository';
import { DexieNotificationPreferenceRepository } from './repositories/DexieNotificationPreferenceRepository';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { DexieUnitOfWork } from './DexieUnitOfWork';
import { ManualSyncCoordinator } from '@/infrastructure/sync/ManualSyncCoordinator';
import { AccountSyncDispatcher } from '@/infrastructure/sync/dispatchers/AccountSyncDispatcher';
import { TransactionSyncDispatcher } from '@/infrastructure/sync/dispatchers/TransactionSyncDispatcher';
import { CategorySyncDispatcher } from '@/infrastructure/sync/dispatchers/CategorySyncDispatcher';
import { BudgetSyncDispatcher } from '@/infrastructure/sync/dispatchers/BudgetSyncDispatcher';
import { LenderSyncDispatcher } from '@/infrastructure/sync/dispatchers/LenderSyncDispatcher';
import { BorrowingSyncDispatcher } from '@/infrastructure/sync/dispatchers/BorrowingSyncDispatcher';
import { BorrowingRepaymentSyncDispatcher } from '@/infrastructure/sync/dispatchers/BorrowingRepaymentSyncDispatcher';
import { BudgetReconciliationService } from '@/infrastructure/sync/BudgetReconciliationService';
import { RecurringRuleSyncDispatcher } from '@/infrastructure/sync/dispatchers/RecurringRuleSyncDispatcher';
import { RecurringOccurrenceSyncDispatcher } from '@/infrastructure/sync/dispatchers/RecurringOccurrenceSyncDispatcher';
import { RecurringReconciliationService } from '@/infrastructure/sync/RecurringReconciliationService';
import { NotificationSyncDispatcher } from '@/infrastructure/sync/dispatchers/NotificationSyncDispatcher';
import { NotificationPreferenceSyncDispatcher } from '@/infrastructure/sync/dispatchers/NotificationPreferenceSyncDispatcher';
import { NotificationReconciliationService } from '@/infrastructure/sync/NotificationReconciliationService';
import { CategoryMappingService } from '@/infrastructure/sync/CategoryMappingService';
import {
  ISupabaseAccountRepository,
  SupabaseAccountRepository
} from '../cloud/repositories/SupabaseAccountRepository';
import {
  ISupabaseTransactionRepository,
  SupabaseTransactionRepository
} from '../cloud/repositories/SupabaseTransactionRepository';
import {
  ISupabaseCategoryRepository,
  SupabaseCategoryRepository
} from '../cloud/repositories/SupabaseCategoryRepository';
import {
  ISupabaseLenderRepository,
  SupabaseLenderRepository
} from '../cloud/repositories/SupabaseLenderRepository';
import {
  ISupabaseBorrowingRepository,
  SupabaseBorrowingRepository
} from '../cloud/repositories/SupabaseBorrowingRepository';
import {
  ISupabaseBorrowingRepaymentRepository,
  SupabaseBorrowingRepaymentRepository
} from '../cloud/repositories/SupabaseBorrowingRepaymentRepository';
import {
  ISupabaseBudgetRepository,
  SupabaseBudgetRepository
} from '../cloud/repositories/SupabaseBudgetRepository';
import {
  ISupabaseRecurringRuleRepository,
  SupabaseRecurringRuleRepository
} from '../cloud/repositories/SupabaseRecurringRuleRepository';
import {
  ISupabaseRecurringOccurrenceRepository,
  SupabaseRecurringOccurrenceRepository
} from '../cloud/repositories/SupabaseRecurringOccurrenceRepository';
import {
  ISupabaseNotificationRepository,
  SupabaseNotificationRepository
} from '../cloud/repositories/SupabaseNotificationRepository';
import {
  ISupabaseNotificationPreferenceRepository,
  SupabaseNotificationPreferenceRepository
} from '../cloud/repositories/SupabaseNotificationPreferenceRepository';
import {
  GetAccountsWithBalanceUseCase,
  CreateAccountUseCase,
  UpdateAccountUseCase,
  ArchiveAccountUseCase,
  RestoreAccountUseCase,
  GetTransactionsUseCase,
  CreateTransactionUseCase,
  UpdateTransactionUseCase,
  DeleteTransactionUseCase,
  ExecuteTransferUseCase,
  EnsurePersonalBorrowingsAccountUseCase,
  AddBorrowingUseCase,
  RecordRepaymentUseCase,
  GetBorrowingsUseCase,
  CreateBudgetUseCase,
  UpdateBudgetUseCase,
  DeleteBudgetUseCase,
  GetBudgetsOverviewUseCase,
  CheckBudgetUseCase,
  CreateRecurringRuleUseCase,
  UpdateRecurringRuleUseCase,
  PauseRecurringRuleUseCase,
  ResumeRecurringRuleUseCase,
  DeleteRecurringRuleUseCase,
  ConfirmRecurringOccurrenceUseCase,
  SkipRecurringOccurrenceUseCase,
  SnoozeRecurringOccurrenceUseCase,
  DismissRecurringOccurrenceUseCase,
  GetRecurringOverviewUseCase,
  EvaluateFinancialAlertsUseCase,
  GetNotificationsUseCase,
  MarkNotificationReadUseCase,
  MarkAllNotificationsReadUseCase,
  DismissNotificationUseCase,
  GetNotificationPreferencesUseCase,
  UpdateNotificationPreferencesUseCase
} from '@/application';

export const DATABASE_PREFIX = 'LaxmiLens_LocalDB';

export function getDatabaseNameForUser(userId: string): string {
  const validated = validateUserId(userId);
  return `${DATABASE_PREFIX}_${validated}`;
}

export interface UserRepositories {
  userId: string;
  generation: number;
  database: LaxmiLensDB;
  accountRepo: DexieAccountRepository;
  transactionRepo: DexieTransactionRepository;
  categoryRepo: DexieCategoryRepository;
  profileRepo: DexieProfileRepository;
  lenderRepo: DexieLenderRepository;
  borrowingRepo: DexieBorrowingRepository;
  budgetRepo: DexieBudgetRepository;
  recurringRuleRepo: DexieRecurringRuleRepository;
  recurringOccurrenceRepo: DexieRecurringOccurrenceRepository;
  notificationRepo: DexieNotificationRepository;
  notificationPreferenceRepo: DexieNotificationPreferenceRepository;
  outboxManager: OutboxManager;
  unitOfWork: DexieUnitOfWork;
  syncCoordinator: ManualSyncCoordinator;

  // Pre-wired account use cases
  getAccountsUseCase: GetAccountsWithBalanceUseCase;
  createAccountUseCase: CreateAccountUseCase;
  updateAccountUseCase: UpdateAccountUseCase;
  archiveAccountUseCase: ArchiveAccountUseCase;
  restoreAccountUseCase: RestoreAccountUseCase;

  // Pre-wired transaction use cases
  getTransactionsUseCase: GetTransactionsUseCase;
  createTransactionUseCase: CreateTransactionUseCase;
  updateTransactionUseCase: UpdateTransactionUseCase;
  deleteTransactionUseCase: DeleteTransactionUseCase;
  executeTransferUseCase: ExecuteTransferUseCase;

  // Pre-wired borrowing use cases
  ensureBorrowingsAccountUseCase: EnsurePersonalBorrowingsAccountUseCase;
  addBorrowingUseCase: AddBorrowingUseCase;
  recordRepaymentUseCase: RecordRepaymentUseCase;
  getBorrowingsUseCase: GetBorrowingsUseCase;

  // Pre-wired budget use cases
  createBudgetUseCase: CreateBudgetUseCase;
  updateBudgetUseCase: UpdateBudgetUseCase;
  deleteBudgetUseCase: DeleteBudgetUseCase;
  getBudgetsOverviewUseCase: GetBudgetsOverviewUseCase;
  checkBudgetUseCase: CheckBudgetUseCase;

  // Pre-wired recurring transaction & reminder use cases
  createRecurringRuleUseCase: CreateRecurringRuleUseCase;
  updateRecurringRuleUseCase: UpdateRecurringRuleUseCase;
  pauseRecurringRuleUseCase: PauseRecurringRuleUseCase;
  resumeRecurringRuleUseCase: ResumeRecurringRuleUseCase;
  deleteRecurringRuleUseCase: DeleteRecurringRuleUseCase;
  confirmRecurringOccurrenceUseCase: ConfirmRecurringOccurrenceUseCase;
  skipRecurringOccurrenceUseCase: SkipRecurringOccurrenceUseCase;
  snoozeRecurringOccurrenceUseCase: SnoozeRecurringOccurrenceUseCase;
  dismissRecurringOccurrenceUseCase: DismissRecurringOccurrenceUseCase;
  getRecurringOverviewUseCase: GetRecurringOverviewUseCase;
  evaluateFinancialAlertsUseCase: EvaluateFinancialAlertsUseCase;
  getNotificationsUseCase: GetNotificationsUseCase;
  markNotificationReadUseCase: MarkNotificationReadUseCase;
  markAllNotificationsReadUseCase: MarkAllNotificationsReadUseCase;
  dismissNotificationUseCase: DismissNotificationUseCase;
  getNotificationPreferencesUseCase: GetNotificationPreferencesUseCase;
  updateNotificationPreferencesUseCase: UpdateNotificationPreferencesUseCase;
}

export class DatabaseManager {
  private activeDatabase: LaxmiLensDB | null = null;
  private activeUserId: string | null = null;
  private sessionGeneration = 0;
  private openPromise: Promise<LaxmiLensDB> | null = null;
  private openingUserId: string | null = null;
  private activeRepositories: UserRepositories | null = null;

  constructor(
    private readonly authPort: AuthPort = defaultAuthAdapter,
    private readonly dbFactory: (name: string) => LaxmiLensDB = (name) => new LaxmiLensDB(name),
    private readonly supabaseAccountRepo: ISupabaseAccountRepository = new SupabaseAccountRepository(),
    private readonly supabaseTransactionRepo: ISupabaseTransactionRepository = new SupabaseTransactionRepository(
      undefined,
      supabaseAccountRepo,
      new SupabaseCategoryRepository()
    ),
    private readonly supabaseCategoryRepo: ISupabaseCategoryRepository = new SupabaseCategoryRepository(),
    private readonly supabaseLenderRepo: ISupabaseLenderRepository = new SupabaseLenderRepository(),
    private readonly supabaseBorrowingRepo: ISupabaseBorrowingRepository = new SupabaseBorrowingRepository(
      undefined,
      supabaseLenderRepo,
      supabaseAccountRepo,
      supabaseTransactionRepo
    ),
    private readonly supabaseBorrowingRepaymentRepo: ISupabaseBorrowingRepaymentRepository = new SupabaseBorrowingRepaymentRepository(
      undefined,
      supabaseBorrowingRepo,
      supabaseLenderRepo,
      supabaseAccountRepo,
      supabaseTransactionRepo
    ),
    private readonly supabaseBudgetRepo: ISupabaseBudgetRepository = new SupabaseBudgetRepository(
      undefined,
      supabaseCategoryRepo
    ),
    private readonly supabaseRecurringRuleRepo: ISupabaseRecurringRuleRepository = new SupabaseRecurringRuleRepository(
      undefined,
      supabaseAccountRepo,
      supabaseCategoryRepo
    ),
    private readonly supabaseRecurringOccurrenceRepo: ISupabaseRecurringOccurrenceRepository = new SupabaseRecurringOccurrenceRepository(
      undefined,
      supabaseRecurringRuleRepo,
      supabaseTransactionRepo
    ),
    private readonly supabaseNotificationRepo: ISupabaseNotificationRepository = new SupabaseNotificationRepository(),
    private readonly supabaseNotificationPreferenceRepo: ISupabaseNotificationPreferenceRepository = new SupabaseNotificationPreferenceRepository()
  ) {}

  public getSessionGeneration(): number {
    return this.sessionGeneration;
  }

  public getActiveUserId(): string | null {
    return this.activeUserId;
  }

  public isUserActive(userId: string): boolean {
    if (!this.activeUserId) return false;
    try {
      return this.activeUserId === validateUserId(userId);
    } catch {
      return false;
    }
  }

  /**
   * Resolves the active database strictly for the verified authenticated session.
   * Calling components CANNOT pass an arbitrary userId to access another user's database.
   */
  public async getActiveDatabase(): Promise<LaxmiLensDB> {
    const currentUser = await this.authPort.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      throw new NoActiveDatabaseSessionError();
    }

    const verifiedUserId = validateUserId(currentUser.id);

    // If an active database matches the verified user and is open, reuse it
    if (this.activeDatabase && this.activeUserId === verifiedUserId && this.activeDatabase.isOpen()) {
      return this.activeDatabase;
    }

    // Switch/open database for verified authenticated session
    return this.openForUser(verifiedUserId);
  }

  /**
   * Safely opens or switches to the database for an authenticated user.
   * Guaranteed concurrency safety via mutex, ownership-aware promise cleanup,
   * independent AuthPort identity verification, and stale-session rejection.
   */
  public openForUser(userId: string): Promise<LaxmiLensDB> {
    let validatedUserId: UserId;
    try {
      validatedUserId = validateUserId(userId);
    } catch (err) {
      return Promise.reject(err);
    }

    // 1. If already active and open for this verified user, return immediately
    if (this.activeDatabase && this.activeUserId === validatedUserId && this.activeDatabase.isOpen()) {
      return Promise.resolve(this.activeDatabase);
    }

    // 2. Mutual exclusion: return existing in-flight open promise synchronously if opening the same verified user
    if (this.openPromise && this.openingUserId === validatedUserId) {
      return this.openPromise;
    }

    this.openingUserId = validatedUserId;
    this.sessionGeneration++;
    const currentGeneration = this.sessionGeneration;

    const promiseHolder: { current: Promise<LaxmiLensDB> | null } = { current: null };
    const thisPromise = (async () => {
      try {
        // 3. Independent authentication check: caller must match active AuthPort session
        const currentUser = await this.authPort.getCurrentUser();
        if (!currentUser || !currentUser.id) {
          throw new UnauthorizedDatabaseAccessError('anonymous', validatedUserId);
        }
        if (!isValidUuid(currentUser.id)) {
          throw new UnauthorizedDatabaseAccessError('malformed', validatedUserId);
        }
        const validatedAuthId = validateUserId(currentUser.id);
        if (validatedAuthId !== validatedUserId) {
          throw new UnauthorizedDatabaseAccessError(validatedAuthId, validatedUserId);
        }

        // If an active database exists for a different user, close it cleanly first without advancing generation
        if (this.activeDatabase && this.activeUserId !== validatedUserId) {
          await this.internalCloseDatabase();
        }

        const dbName = getDatabaseNameForUser(validatedUserId);
        const database = this.dbFactory(dbName);

        if (!database.isOpen()) {
          await database.open();
        }

        // Stale check: If the session generation changed while database was opening, abort
        if (this.sessionGeneration !== currentGeneration) {
          try {
            await database.close();
          } catch {
            // Ignore close error during aborted stale open
          }
          throw new StaleSessionError();
        }

        // Recheck authorization at async completion boundary
        const recheckUser = await this.authPort.getCurrentUser();
        if (
          !recheckUser ||
          !recheckUser.id ||
          !isValidUuid(recheckUser.id) ||
          validateUserId(recheckUser.id) !== validatedUserId
        ) {
          try {
            await database.close();
          } catch {
            // Ignore close error
          }
          throw new UnauthorizedDatabaseAccessError(recheckUser?.id ?? 'anonymous', validatedUserId);
        }

        this.activeDatabase = database;
        this.activeUserId = validatedUserId;
        this.buildRepositories(validatedUserId, database, currentGeneration);

        return database;
      } finally {
        // Ownership-aware promise cleanup: only clear if this promise still owns the reference
        if (this.openPromise === promiseHolder.current) {
          this.openPromise = null;
          this.openingUserId = null;
        }
      }
    })();

    promiseHolder.current = thisPromise;
    this.openPromise = thisPromise;
    return thisPromise;
  }

  /**
   * Closes active Dexie database connections safely and invalidates cached user repositories.
   */
  public async closeCurrentDatabase(): Promise<void> {
    this.sessionGeneration++;
    await this.internalCloseDatabase();
  }

  private async internalCloseDatabase(): Promise<void> {
    const dbToClose = this.activeDatabase;
    this.activeDatabase = null;
    this.activeUserId = null;
    this.activeRepositories = null;

    if (dbToClose && dbToClose.isOpen()) {
      try {
        await dbToClose.close();
      } catch (err) {
        console.error('Failed to close Dexie database cleanly:', err);
      }
    }
  }

  /**
   * Resolves the pre-wired user-scoped repositories and use cases for the current authenticated user.
   */
  public async getActiveRepositories(): Promise<UserRepositories> {
    const currentUser = await this.authPort.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      throw new NoActiveDatabaseSessionError();
    }

    const verifiedUserId = validateUserId(currentUser.id);

    if (
      this.activeRepositories &&
      this.activeUserId === verifiedUserId &&
      this.activeRepositories.generation === this.sessionGeneration &&
      this.activeDatabase &&
      this.activeDatabase.isOpen()
    ) {
      return this.activeRepositories;
    }

    const database = await this.openForUser(verifiedUserId);
    if (!this.activeRepositories) {
      this.buildRepositories(verifiedUserId, database, this.sessionGeneration);
    }

    return this.activeRepositories!;
  }

  /**
   * Resolves the user-scoped ManualSyncCoordinator for the current authenticated user.
   */
  public async getActiveSyncCoordinator(): Promise<ManualSyncCoordinator> {
    const repos = await this.getActiveRepositories();
    return repos.syncCoordinator;
  }

  /**
   * Factory constructing user-scoped repositories, UnitOfWork, and use cases.
   */
  private buildRepositories(
    userId: string,
    database: LaxmiLensDB,
    generation: number
  ): UserRepositories {
    const accountRepo = new DexieAccountRepository(database);
    const transactionRepo = new DexieTransactionRepository(database);
    const categoryRepo = new DexieCategoryRepository(database);
    const profileRepo = new DexieProfileRepository(database);
    const outboxManager = new OutboxManager(database);
    const unitOfWork = new DexieUnitOfWork(database);

    const categoryMappingService = new CategoryMappingService(
      database,
      this.supabaseCategoryRepo,
      categoryRepo
    );

    const accountDispatcher = new AccountSyncDispatcher(
      this.supabaseAccountRepo,
      this.authPort,
      outboxManager
    );

    const categoryDispatcher = new CategorySyncDispatcher(
      this.supabaseCategoryRepo,
      this.authPort,
      outboxManager,
      categoryMappingService
    );

    const transactionDispatcher = new TransactionSyncDispatcher(
      this.supabaseTransactionRepo,
      this.authPort,
      outboxManager,
      categoryMappingService
    );

    const lenderDispatcher = new LenderSyncDispatcher(
      this.supabaseLenderRepo,
      this.authPort,
      outboxManager
    );

    const borrowingDispatcher = new BorrowingSyncDispatcher(
      this.supabaseBorrowingRepo,
      this.authPort,
      outboxManager
    );

    const borrowingRepaymentDispatcher = new BorrowingRepaymentSyncDispatcher(
      this.supabaseBorrowingRepaymentRepo,
      this.authPort,
      outboxManager
    );

    const budgetDispatcher = new BudgetSyncDispatcher(
      this.supabaseBudgetRepo,
      this.authPort,
      outboxManager,
      categoryMappingService
    );

    const budgetReconciler = new BudgetReconciliationService(
      database,
      this.supabaseBudgetRepo,
      this.authPort,
      categoryMappingService
    );

    const recurringRuleDispatcher = new RecurringRuleSyncDispatcher(
      this.supabaseRecurringRuleRepo,
      this.authPort,
      outboxManager,
      categoryMappingService
    );

    const recurringOccurrenceDispatcher = new RecurringOccurrenceSyncDispatcher(
      this.supabaseRecurringOccurrenceRepo,
      this.authPort,
      outboxManager
    );

    const recurringReconciler = new RecurringReconciliationService(
      database,
      this.supabaseRecurringRuleRepo,
      this.supabaseRecurringOccurrenceRepo,
      this.authPort,
      categoryMappingService
    );

    const notificationDispatcher = new NotificationSyncDispatcher(
      this.supabaseNotificationRepo,
      this.authPort,
      outboxManager
    );

    const notificationPreferenceDispatcher = new NotificationPreferenceSyncDispatcher(
      this.supabaseNotificationPreferenceRepo,
      this.authPort,
      outboxManager
    );

    const notificationReconciler = new NotificationReconciliationService(
      database,
      this.supabaseNotificationRepo,
      this.supabaseNotificationPreferenceRepo,
      this.authPort
    );

    const syncCoordinator = new ManualSyncCoordinator(
      accountDispatcher,
      transactionDispatcher,
      outboxManager,
      this.authPort,
      categoryDispatcher,
      lenderDispatcher,
      borrowingDispatcher,
      borrowingRepaymentDispatcher,
      budgetDispatcher,
      budgetReconciler,
      recurringRuleDispatcher,
      recurringOccurrenceDispatcher,
      recurringReconciler,
      notificationDispatcher,
      notificationPreferenceDispatcher,
      notificationReconciler
    );

    const getAccountsUseCase = new GetAccountsWithBalanceUseCase(accountRepo, transactionRepo);
    const createAccountUseCase = new CreateAccountUseCase(accountRepo, outboxManager, unitOfWork);
    const updateAccountUseCase = new UpdateAccountUseCase(accountRepo, outboxManager, unitOfWork);
    const archiveAccountUseCase = new ArchiveAccountUseCase(accountRepo, outboxManager, unitOfWork);
    const restoreAccountUseCase = new RestoreAccountUseCase(accountRepo, outboxManager, unitOfWork);

    const getTransactionsUseCase = new GetTransactionsUseCase(transactionRepo);
    const createTransactionUseCase = new CreateTransactionUseCase(
      transactionRepo,
      accountRepo,
      categoryRepo,
      outboxManager,
      unitOfWork
    );
    const updateTransactionUseCase = new UpdateTransactionUseCase(
      transactionRepo,
      accountRepo,
      categoryRepo,
      outboxManager,
      unitOfWork
    );
    const deleteTransactionUseCase = new DeleteTransactionUseCase(
      transactionRepo,
      outboxManager,
      unitOfWork
    );
    const executeTransferUseCase = new ExecuteTransferUseCase(
      transactionRepo,
      accountRepo,
      outboxManager,
      unitOfWork
    );

    const lenderRepo = new DexieLenderRepository(database);
    const borrowingRepo = new DexieBorrowingRepository(database);
    const budgetRepo = new DexieBudgetRepository(database);
    const recurringRuleRepo = new DexieRecurringRuleRepository(database);
    const recurringOccurrenceRepo = new DexieRecurringOccurrenceRepository(database);
    const notificationRepo = new DexieNotificationRepository(database);
    const notificationPreferenceRepo = new DexieNotificationPreferenceRepository(database);

    const ensureBorrowingsAccountUseCase = new EnsurePersonalBorrowingsAccountUseCase(
      accountRepo,
      outboxManager,
      unitOfWork
    );

    const addBorrowingUseCase = new AddBorrowingUseCase(
      borrowingRepo,
      lenderRepo,
      accountRepo,
      transactionRepo,
      ensureBorrowingsAccountUseCase,
      outboxManager,
      unitOfWork
    );

    const recordRepaymentUseCase = new RecordRepaymentUseCase(
      borrowingRepo,
      lenderRepo,
      accountRepo,
      transactionRepo,
      ensureBorrowingsAccountUseCase,
      outboxManager,
      unitOfWork
    );

    const getBorrowingsUseCase = new GetBorrowingsUseCase(
      borrowingRepo,
      lenderRepo,
      accountRepo
    );

    const createBudgetUseCase = new CreateBudgetUseCase(
      budgetRepo,
      categoryRepo,
      outboxManager,
      unitOfWork
    );

    const updateBudgetUseCase = new UpdateBudgetUseCase(
      budgetRepo,
      outboxManager,
      unitOfWork
    );

    const deleteBudgetUseCase = new DeleteBudgetUseCase(
      budgetRepo,
      outboxManager,
      unitOfWork
    );

    const getBudgetsOverviewUseCase = new GetBudgetsOverviewUseCase(
      budgetRepo,
      transactionRepo,
      categoryRepo
    );

    const checkBudgetUseCase = new CheckBudgetUseCase(
      budgetRepo,
      transactionRepo
    );

    const createRecurringRuleUseCase = new CreateRecurringRuleUseCase(
      recurringRuleRepo,
      recurringOccurrenceRepo,
      accountRepo,
      categoryRepo,
      outboxManager,
      unitOfWork
    );
    const updateRecurringRuleUseCase = new UpdateRecurringRuleUseCase(
      recurringRuleRepo,
      recurringOccurrenceRepo,
      accountRepo,
      categoryRepo,
      outboxManager,
      unitOfWork
    );
    const pauseRecurringRuleUseCase = new PauseRecurringRuleUseCase(
      recurringRuleRepo,
      outboxManager,
      unitOfWork
    );
    const resumeRecurringRuleUseCase = new ResumeRecurringRuleUseCase(
      recurringRuleRepo,
      recurringOccurrenceRepo,
      outboxManager,
      unitOfWork
    );
    const deleteRecurringRuleUseCase = new DeleteRecurringRuleUseCase(
      recurringRuleRepo,
      outboxManager,
      unitOfWork
    );
    const confirmRecurringOccurrenceUseCase = new ConfirmRecurringOccurrenceUseCase(
      recurringRuleRepo,
      recurringOccurrenceRepo,
      transactionRepo,
      createTransactionUseCase,
      outboxManager,
      unitOfWork
    );
    const skipRecurringOccurrenceUseCase = new SkipRecurringOccurrenceUseCase(
      recurringRuleRepo,
      recurringOccurrenceRepo,
      outboxManager,
      unitOfWork
    );
    const snoozeRecurringOccurrenceUseCase = new SnoozeRecurringOccurrenceUseCase(
      recurringRuleRepo,
      recurringOccurrenceRepo,
      outboxManager,
      unitOfWork
    );
    const dismissRecurringOccurrenceUseCase = new DismissRecurringOccurrenceUseCase(
      recurringRuleRepo,
      recurringOccurrenceRepo,
      outboxManager,
      unitOfWork
    );
    const getRecurringOverviewUseCase = new GetRecurringOverviewUseCase(
      recurringRuleRepo,
      recurringOccurrenceRepo,
      accountRepo,
      categoryRepo
    );
    const evaluateFinancialAlertsUseCase = new EvaluateFinancialAlertsUseCase(
      notificationRepo,
      notificationPreferenceRepo,
      getBudgetsOverviewUseCase,
      getRecurringOverviewUseCase,
      outboxManager,
      unitOfWork
    );
    const getNotificationsUseCase = new GetNotificationsUseCase(notificationRepo);
    const markNotificationReadUseCase = new MarkNotificationReadUseCase(
      notificationRepo,
      outboxManager,
      unitOfWork
    );
    const markAllNotificationsReadUseCase = new MarkAllNotificationsReadUseCase(
      notificationRepo,
      outboxManager,
      unitOfWork
    );
    const dismissNotificationUseCase = new DismissNotificationUseCase(
      notificationRepo,
      outboxManager,
      unitOfWork
    );
    const getNotificationPreferencesUseCase = new GetNotificationPreferencesUseCase(
      notificationPreferenceRepo
    );
    const updateNotificationPreferencesUseCase = new UpdateNotificationPreferencesUseCase(
      notificationPreferenceRepo,
      outboxManager,
      unitOfWork
    );

    this.activeRepositories = {
      userId,
      generation,
      database,
      accountRepo,
      transactionRepo,
      categoryRepo,
      profileRepo,
      lenderRepo,
      borrowingRepo,
      budgetRepo,
      recurringRuleRepo,
      recurringOccurrenceRepo,
      notificationRepo,
      notificationPreferenceRepo,
      outboxManager,
      unitOfWork,
      syncCoordinator,
      getAccountsUseCase,
      createAccountUseCase,
      updateAccountUseCase,
      archiveAccountUseCase,
      restoreAccountUseCase,
      getTransactionsUseCase,
      createTransactionUseCase,
      updateTransactionUseCase,
      deleteTransactionUseCase,
      executeTransferUseCase,
      ensureBorrowingsAccountUseCase,
      addBorrowingUseCase,
      recordRepaymentUseCase,
      getBorrowingsUseCase,
      createBudgetUseCase,
      updateBudgetUseCase,
      deleteBudgetUseCase,
      getBudgetsOverviewUseCase,
      checkBudgetUseCase,
      createRecurringRuleUseCase,
      updateRecurringRuleUseCase,
      pauseRecurringRuleUseCase,
      resumeRecurringRuleUseCase,
      deleteRecurringRuleUseCase,
      confirmRecurringOccurrenceUseCase,
      skipRecurringOccurrenceUseCase,
      snoozeRecurringOccurrenceUseCase,
      dismissRecurringOccurrenceUseCase,
      getRecurringOverviewUseCase,
      evaluateFinancialAlertsUseCase,
      getNotificationsUseCase,
      markNotificationReadUseCase,
      markAllNotificationsReadUseCase,
      dismissNotificationUseCase,
      getNotificationPreferencesUseCase,
      updateNotificationPreferencesUseCase
    };

    return this.activeRepositories;
  }
}

export const defaultDatabaseManager = new DatabaseManager();

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
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { DexieUnitOfWork } from './DexieUnitOfWork';
import { ManualSyncCoordinator } from '@/infrastructure/sync/ManualSyncCoordinator';
import { AccountSyncDispatcher } from '@/infrastructure/sync/dispatchers/AccountSyncDispatcher';
import { TransactionSyncDispatcher } from '@/infrastructure/sync/dispatchers/TransactionSyncDispatcher';
import {
  ISupabaseAccountRepository,
  SupabaseAccountRepository
} from '../cloud/repositories/SupabaseAccountRepository';
import {
  ISupabaseTransactionRepository,
  SupabaseTransactionRepository
} from '../cloud/repositories/SupabaseTransactionRepository';
import {
  GetAccountsWithBalanceUseCase,
  CreateAccountUseCase,
  UpdateAccountUseCase,
  ArchiveAccountUseCase,
  RestoreAccountUseCase
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
  outboxManager: OutboxManager;
  unitOfWork: DexieUnitOfWork;
  syncCoordinator: ManualSyncCoordinator;

  // Pre-wired account use cases
  getAccountsUseCase: GetAccountsWithBalanceUseCase;
  createAccountUseCase: CreateAccountUseCase;
  updateAccountUseCase: UpdateAccountUseCase;
  archiveAccountUseCase: ArchiveAccountUseCase;
  restoreAccountUseCase: RestoreAccountUseCase;
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
    private readonly supabaseTransactionRepo: ISupabaseTransactionRepository = new SupabaseTransactionRepository()
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

    const accountDispatcher = new AccountSyncDispatcher(
      this.supabaseAccountRepo,
      this.authPort,
      outboxManager
    );

    const transactionDispatcher = new TransactionSyncDispatcher(
      this.supabaseTransactionRepo,
      this.authPort,
      outboxManager
    );

    const syncCoordinator = new ManualSyncCoordinator(
      accountDispatcher,
      transactionDispatcher,
      outboxManager,
      this.authPort
    );

    const getAccountsUseCase = new GetAccountsWithBalanceUseCase(accountRepo, transactionRepo);
    const createAccountUseCase = new CreateAccountUseCase(accountRepo, outboxManager, unitOfWork);
    const updateAccountUseCase = new UpdateAccountUseCase(accountRepo, outboxManager, unitOfWork);
    const archiveAccountUseCase = new ArchiveAccountUseCase(accountRepo, outboxManager, unitOfWork);
    const restoreAccountUseCase = new RestoreAccountUseCase(accountRepo, outboxManager, unitOfWork);

    this.activeRepositories = {
      userId,
      generation,
      database,
      accountRepo,
      transactionRepo,
      categoryRepo,
      profileRepo,
      outboxManager,
      unitOfWork,
      syncCoordinator,
      getAccountsUseCase,
      createAccountUseCase,
      updateAccountUseCase,
      archiveAccountUseCase,
      restoreAccountUseCase
    };

    return this.activeRepositories;
  }
}

export const defaultDatabaseManager = new DatabaseManager();

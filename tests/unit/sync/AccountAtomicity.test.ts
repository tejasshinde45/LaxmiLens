import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateAccountUseCase } from '@/application/use-cases/accounts/CreateAccountUseCase';
import { UpdateAccountUseCase } from '@/application/use-cases/accounts/UpdateAccountUseCase';
import { ArchiveAccountUseCase } from '@/application/use-cases/accounts/ArchiveAccountUseCase';
import { RestoreAccountUseCase } from '@/application/use-cases/accounts/RestoreAccountUseCase';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { DexieUnitOfWork } from '@/infrastructure/database/local/DexieUnitOfWork';
import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { SyncPort, OutboxEntry } from '@/application/ports/SyncPort';
import { Account, AccountType } from '@/domain/entities/Account';
import {
  AccountId,
  UserId,
  createAccountId,
  createUserId,
  isValidUuid,
  validateUserId
} from '@/domain/value-objects/Identifiers';
import {
  InvalidUserIdError,
  UnauthorizedEntityAccessError,
  AccountNotFoundError
} from '@/domain/errors/DomainErrors';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import { DexieAccountRepository } from '@/infrastructure/database/local/repositories/DexieAccountRepository';
import { LocalAccountRecord } from '@/infrastructure/database/local/schema';

// In-Memory Test Account Repository with snapshot/rollback support
class TransactionalInMemoryAccountRepository implements AccountRepository {
  public accounts = new Map<string, Account>();
  private snapshot = new Map<string, Account>();

  takeSnapshot() {
    this.snapshot = new Map(this.accounts);
  }

  rollback() {
    this.accounts = new Map(this.snapshot);
  }

  async findById(id: AccountId, userId?: UserId): Promise<Account | null> {
    const acc = this.accounts.get(id);
    if (!acc) return null;
    if (userId && acc.userId !== userId) {
      throw new UnauthorizedEntityAccessError('Account', id);
    }
    return acc;
  }

  async findByUserId(userId: UserId): Promise<Account[]> {
    return Array.from(this.accounts.values()).filter((a) => a.userId === userId);
  }

  async findAll(userId: UserId): Promise<Account[]> {
    return this.findByUserId(userId);
  }

  async save(account: Account): Promise<void> {
    this.accounts.set(account.id, account);
  }

  async saveBatch(accounts: Account[]): Promise<void> {
    accounts.forEach((a) => this.accounts.set(a.id, a));
  }

  async archive(id: AccountId, userId: UserId, version?: number): Promise<void> {
    const acc = this.accounts.get(id);
    if (acc) {
      this.accounts.set(
        id,
        new Account({
          ...acc,
          isArchived: true,
          version: version !== undefined ? version : acc.version + 1,
          updatedAt: new Date()
        })
      );
    }
  }

  async restore(id: AccountId, userId: UserId, version?: number): Promise<void> {
    const acc = this.accounts.get(id);
    if (acc) {
      this.accounts.set(
        id,
        new Account({
          ...acc,
          isArchived: false,
          version: version !== undefined ? version : acc.version + 1,
          updatedAt: new Date()
        })
      );
    }
  }
}

// In-Memory Test SyncPort with snapshot/rollback and simulated failure support
class TransactionalInMemorySyncPort implements SyncPort {
  public enqueued: Omit<OutboxEntry, 'id' | 'attempts' | 'createdAt'>[] = [];
  private snapshot: Omit<OutboxEntry, 'id' | 'attempts' | 'createdAt'>[] = [];
  public shouldFail = false;
  public failureMessage = 'Simulated outbox write failure';

  takeSnapshot() {
    this.snapshot = [...this.enqueued];
  }

  rollback() {
    this.enqueued = [...this.snapshot];
  }

  async enqueue(entry: Omit<OutboxEntry, 'id' | 'attempts' | 'createdAt'>): Promise<void> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }
    this.enqueued.push(entry);
  }

  async processOutbox() {
    return { pushedCount: 0, pulledCount: 0, conflictsCount: 0, errors: [] };
  }

  async getPendingCount() {
    return this.enqueued.length;
  }

  async clearOutbox() {
    this.enqueued = [];
  }
}

// Transactional UnitOfWork for unit tests
class TestUnitOfWork implements UnitOfWork {
  constructor(
    private readonly repo: TransactionalInMemoryAccountRepository,
    private readonly sync: TransactionalInMemorySyncPort
  ) {}

  public async run<T>(work: () => Promise<T>): Promise<T> {
    this.repo.takeSnapshot();
    this.sync.takeSnapshot();
    try {
      return await work();
    } catch (error) {
      this.repo.rollback();
      this.sync.rollback();
      throw error;
    }
  }
}

describe('Phase 1: Transactional Outbox & User Identity Integrity', () => {
  const validUserUUID = '123e4567-e89b-12d3-a456-426614174000';
  const otherUserUUID = '987fcdeb-51a2-43f7-9876-543210987654';

  let accountRepo: TransactionalInMemoryAccountRepository;
  let syncPort: TransactionalInMemorySyncPort;
  let uow: TestUnitOfWork;

  beforeEach(() => {
    accountRepo = new TransactionalInMemoryAccountRepository();
    syncPort = new TransactionalInMemorySyncPort();
    uow = new TestUnitOfWork(accountRepo, syncPort);
  });

  describe('Objective B: User Identity Validation & Domain Integrity', () => {
    it('validates standard UUIDs correctly and rejects non-UUIDs', () => {
      expect(isValidUuid(validUserUUID)).toBe(true);
      expect(isValidUuid('local-user')).toBe(false);
      expect(isValidUuid('')).toBe(false);
      expect(isValidUuid('user-123')).toBe(false);
      expect(isValidUuid('not-a-uuid-format-here')).toBe(false);
      expect(isValidUuid(null)).toBe(false);
      expect(isValidUuid(undefined)).toBe(false);
    });

    it('validateUserId returns branded UserId for valid UUID and throws for invalid', () => {
      const id = validateUserId(validUserUUID);
      expect(id).toBe(validUserUUID);
      expect(() => validateUserId('local-user')).toThrow(InvalidUserIdError);
      expect(() => validateUserId('')).toThrow(InvalidUserIdError);
      expect(() => validateUserId(undefined)).toThrow(InvalidUserIdError);
    });

    it('rejects account creation when userId is missing', async () => {
      const useCase = new CreateAccountUseCase(accountRepo, syncPort, uow);

      await expect(
        useCase.execute({
          name: 'Personal Savings',
          accountType: 'savings',
          openingBalancePaise: 50000
        })
      ).rejects.toThrow(InvalidUserIdError);

      expect(accountRepo.accounts.size).toBe(0);
      expect(syncPort.enqueued.length).toBe(0);
    });

    it('rejects account creation when userId is "local-user"', async () => {
      const useCase = new CreateAccountUseCase(accountRepo, syncPort, uow);

      await expect(
        useCase.execute({
          userId: 'local-user',
          name: 'Personal Savings',
          accountType: 'savings'
        })
      ).rejects.toThrow(InvalidUserIdError);

      expect(accountRepo.accounts.size).toBe(0);
      expect(syncPort.enqueued.length).toBe(0);
    });

    it('rejects account creation when userId is an invalid non-UUID string', async () => {
      const useCase = new CreateAccountUseCase(accountRepo, syncPort, uow);

      await expect(
        useCase.execute({
          userId: 'invalid-user-1234',
          name: 'Checking Account',
          accountType: 'bank'
        })
      ).rejects.toThrow(InvalidUserIdError);

      expect(accountRepo.accounts.size).toBe(0);
      expect(syncPort.enqueued.length).toBe(0);
    });

    it('Account entity constructor throws InvalidUserIdError if userId is not a valid UUID', () => {
      expect(
        () =>
          new Account({
            id: createAccountId('acc-1'),
            userId: createUserId('local-user'),
            name: 'Test Account',
            accountType: 'bank',
            openingBalancePaise: 0
          })
      ).toThrow(InvalidUserIdError);
    });

    it('DexieAccountRepository.toDomain throws InvalidUserIdError if record has no userId', () => {
      const repo = new DexieAccountRepository({} as unknown as LaxmiLensDB);
      const invalidRecord: LocalAccountRecord = {
        id: 'acc-1',
        userId: '',
        name: 'Test',
        accountType: 'cash',
        openingBalancePaise: 0,
        currency: 'INR',
        isArchived: false,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      expect(() => (repo as unknown as { toDomain: (r: LocalAccountRecord) => Account }).toDomain(invalidRecord)).toThrow(
        InvalidUserIdError
      );
    });

    it('enforces ownership check on account update', async () => {
      const createUseCase = new CreateAccountUseCase(accountRepo, syncPort, uow);
      const updateUseCase = new UpdateAccountUseCase(accountRepo, syncPort, uow);

      const created = await createUseCase.execute({
        userId: validUserUUID,
        name: 'Original Account',
        accountType: 'bank'
      });

      // Attempt update by a different user
      await expect(
        updateUseCase.execute({
          id: created.id,
          userId: otherUserUUID,
          name: 'Hijacked Account'
        })
      ).rejects.toThrow(UnauthorizedEntityAccessError);

      // Attempt update with invalid userId format
      await expect(
        updateUseCase.execute({
          id: created.id,
          userId: 'not-a-uuid',
          name: 'Invalid User Update'
        })
      ).rejects.toThrow(InvalidUserIdError);
    });

    it('enforces ownership check on account archive', async () => {
      const createUseCase = new CreateAccountUseCase(accountRepo, syncPort, uow);
      const archiveUseCase = new ArchiveAccountUseCase(accountRepo, syncPort, uow);

      const created = await createUseCase.execute({
        userId: validUserUUID,
        name: 'To Archive',
        accountType: 'bank'
      });

      // Different user attempt
      await expect(archiveUseCase.execute(created.id, otherUserUUID)).rejects.toThrow(
        UnauthorizedEntityAccessError
      );

      // Invalid user UUID attempt
      await expect(archiveUseCase.execute(created.id, 'bad-uuid')).rejects.toThrow(
        InvalidUserIdError
      );

      // Verify still not archived
      const acc = await accountRepo.findById(createAccountId(created.id));
      expect(acc?.isArchived).toBe(false);
    });

    it('enforces ownership check on account restore', async () => {
      const createUseCase = new CreateAccountUseCase(accountRepo, syncPort, uow);
      const archiveUseCase = new ArchiveAccountUseCase(accountRepo, syncPort, uow);
      const restoreUseCase = new RestoreAccountUseCase(accountRepo, syncPort, uow);

      const created = await createUseCase.execute({
        userId: validUserUUID,
        name: 'To Restore',
        accountType: 'bank'
      });

      await archiveUseCase.execute(created.id, validUserUUID);

      // Different user attempt
      await expect(restoreUseCase.execute(created.id, otherUserUUID)).rejects.toThrow(
        UnauthorizedEntityAccessError
      );

      // Invalid user UUID attempt
      await expect(restoreUseCase.execute(created.id, 'bad-uuid')).rejects.toThrow(
        InvalidUserIdError
      );

      // Verify still archived
      const acc = await accountRepo.findById(createAccountId(created.id));
      expect(acc?.isArchived).toBe(true);
    });
  });

  describe('Objective A: Atomic Persistence & Transactional Outbox', () => {
    it('commits account creation and outbox event atomically on success', async () => {
      const useCase = new CreateAccountUseCase(accountRepo, syncPort, uow);

      const created = await useCase.execute({
        userId: validUserUUID,
        name: 'HDFC Salary Bank',
        accountType: 'bank',
        openingBalancePaise: 2500000,
        currency: 'INR',
        institutionName: 'HDFC Bank',
        notes: 'Monthly corporate salary'
      });

      // 1. Account committed to repo
      const stored = await accountRepo.findById(createAccountId(created.id));
      expect(stored).not.toBeNull();
      expect(stored?.name).toBe('HDFC Salary Bank');
      expect(stored?.version).toBe(1);

      // 2. Outbox event committed atomically
      expect(syncPort.enqueued.length).toBe(1);
      const outboxEntry = syncPort.enqueued[0];
      expect(outboxEntry.entity).toBe('accounts');
      expect(outboxEntry.entityId).toBe(created.id);
      expect(outboxEntry.operation).toBe('INSERT');
      expect(outboxEntry.payload.version).toBe(1);
      expect(outboxEntry.payload.user_id).toBe(validUserUUID);
      expect(outboxEntry.payload.name).toBe('HDFC Salary Bank');
      expect(isValidUuid(outboxEntry.idempotencyKey)).toBe(true);
    });

    it('rolls back account persistence when outbox enqueueing fails', async () => {
      const useCase = new CreateAccountUseCase(accountRepo, syncPort, uow);

      // Simulate outbox storage error
      syncPort.shouldFail = true;
      syncPort.failureMessage = 'Disk quota exceeded on outbox table';

      await expect(
        useCase.execute({
          userId: validUserUUID,
          name: 'Doomed Account',
          accountType: 'wallet'
        })
      ).rejects.toThrow('Disk quota exceeded on outbox table');

      // Account MUST NOT be saved locally (atomicity rollback)
      expect(accountRepo.accounts.size).toBe(0);
      expect(syncPort.enqueued.length).toBe(0);
    });

    it('prevents outbox enqueueing when account persistence fails', async () => {
      // Simulate account repository failure
      vi.spyOn(accountRepo, 'save').mockRejectedValueOnce(new Error('Local DB write locked'));

      const useCase = new CreateAccountUseCase(accountRepo, syncPort, uow);

      await expect(
        useCase.execute({
          userId: validUserUUID,
          name: 'Failed Account',
          accountType: 'bank'
        })
      ).rejects.toThrow('Local DB write locked');

      // Outbox must be empty
      expect(syncPort.enqueued.length).toBe(0);
    });

    it('archives account and increments version consistently in repo and outbox payload', async () => {
      const createUseCase = new CreateAccountUseCase(accountRepo, syncPort, uow);
      const archiveUseCase = new ArchiveAccountUseCase(accountRepo, syncPort, uow);

      const created = await createUseCase.execute({
        userId: validUserUUID,
        name: 'Investment Fund',
        accountType: 'savings'
      });

      expect(created.version).toBe(1);

      await archiveUseCase.execute(created.id, validUserUUID);

      const archived = await accountRepo.findById(createAccountId(created.id));
      expect(archived?.isArchived).toBe(true);
      expect(archived?.version).toBe(2);

      expect(syncPort.enqueued.length).toBe(2);
      const archiveEvent = syncPort.enqueued[1];
      expect(archiveEvent.operation).toBe('UPDATE');
      expect(archiveEvent.payload.is_archived).toBe(true);
      // Account record version and outbox payload version MUST match
      expect(archiveEvent.payload.version).toBe(2);
      expect(archiveEvent.payload.version).toBe(archived?.version);
      expect(archiveEvent.payload.user_id).toBe(validUserUUID);
    });

    it('rolls back archive when outbox enqueue fails', async () => {
      const createUseCase = new CreateAccountUseCase(accountRepo, syncPort, uow);
      const archiveUseCase = new ArchiveAccountUseCase(accountRepo, syncPort, uow);

      const created = await createUseCase.execute({
        userId: validUserUUID,
        name: 'Resilient Account',
        accountType: 'bank'
      });

      // Enable outbox failure
      syncPort.shouldFail = true;

      await expect(archiveUseCase.execute(created.id, validUserUUID)).rejects.toThrow(
        'Simulated outbox write failure'
      );

      // State remains unarchived with original version
      const acc = await accountRepo.findById(createAccountId(created.id));
      expect(acc?.isArchived).toBe(false);
      expect(acc?.version).toBe(1);
    });

    it('restores account and increments version consistently in repo and outbox payload', async () => {
      const createUseCase = new CreateAccountUseCase(accountRepo, syncPort, uow);
      const archiveUseCase = new ArchiveAccountUseCase(accountRepo, syncPort, uow);
      const restoreUseCase = new RestoreAccountUseCase(accountRepo, syncPort, uow);

      const created = await createUseCase.execute({
        userId: validUserUUID,
        name: 'Emergency Fund',
        accountType: 'savings'
      });

      await archiveUseCase.execute(created.id, validUserUUID);
      await restoreUseCase.execute(created.id, validUserUUID);

      const restored = await accountRepo.findById(createAccountId(created.id));
      expect(restored?.isArchived).toBe(false);
      expect(restored?.version).toBe(3);

      expect(syncPort.enqueued.length).toBe(3);
      const restoreEvent = syncPort.enqueued[2];
      expect(restoreEvent.operation).toBe('UPDATE');
      expect(restoreEvent.payload.is_archived).toBe(false);
      // Account record version and outbox payload version MUST match
      expect(restoreEvent.payload.version).toBe(3);
      expect(restoreEvent.payload.version).toBe(restored?.version);
      expect(restoreEvent.payload.user_id).toBe(validUserUUID);
    });

    it('rolls back restore when outbox enqueue fails', async () => {
      const createUseCase = new CreateAccountUseCase(accountRepo, syncPort, uow);
      const archiveUseCase = new ArchiveAccountUseCase(accountRepo, syncPort, uow);
      const restoreUseCase = new RestoreAccountUseCase(accountRepo, syncPort, uow);

      const created = await createUseCase.execute({
        userId: validUserUUID,
        name: 'Persistent Account',
        accountType: 'bank'
      });

      await archiveUseCase.execute(created.id, validUserUUID);

      // Now fail outbox during restore
      syncPort.shouldFail = true;

      await expect(restoreUseCase.execute(created.id, validUserUUID)).rejects.toThrow(
        'Simulated outbox write failure'
      );

      // Account remains archived at version 2
      const acc = await accountRepo.findById(createAccountId(created.id));
      expect(acc?.isArchived).toBe(true);
      expect(acc?.version).toBe(2);
    });

    it('preserves full version progression Create(v1) -> Update(v2) -> Archive(v3) -> Restore(v4) (Fix B requirement)', async () => {
      const createUseCase = new CreateAccountUseCase(accountRepo, syncPort, uow);
      const updateUseCase = new UpdateAccountUseCase(accountRepo, syncPort, uow);
      const archiveUseCase = new ArchiveAccountUseCase(accountRepo, syncPort, uow);
      const restoreUseCase = new RestoreAccountUseCase(accountRepo, syncPort, uow);

      // 1. Create (v0 -> v1)
      const created = await createUseCase.execute({
        userId: validUserUUID,
        name: 'HDFC Salary Account',
        accountType: 'bank',
        openingBalancePaise: 5000000,
        currency: 'INR'
      });
      expect(created.version).toBe(1);
      const repoV1 = await accountRepo.findById(createAccountId(created.id));
      expect(repoV1?.version).toBe(1);
      expect(syncPort.enqueued[0].payload.version).toBe(1);

      // 2. Update (v1 -> v2)
      const updated = await updateUseCase.execute({
        id: created.id,
        userId: validUserUUID,
        name: 'HDFC Premium Salary'
      });
      expect(updated.version).toBe(2);
      const repoV2 = await accountRepo.findById(createAccountId(created.id));
      expect(repoV2?.version).toBe(2);
      expect(syncPort.enqueued[1].payload.version).toBe(2);

      // 3. Archive (v2 -> v3) - specifically testing regression from audit
      await archiveUseCase.execute(created.id, validUserUUID);
      const repoV3 = await accountRepo.findById(createAccountId(created.id));
      expect(repoV3?.isArchived).toBe(true);
      expect(repoV3?.version).toBe(3);
      expect(syncPort.enqueued[2].payload.is_archived).toBe(true);
      expect(syncPort.enqueued[2].payload.version).toBe(3);

      // 4. Restore (v3 -> v4) - specifically testing regression from audit
      await restoreUseCase.execute(created.id, validUserUUID);
      const repoV4 = await accountRepo.findById(createAccountId(created.id));
      expect(repoV4?.isArchived).toBe(false);
      expect(repoV4?.version).toBe(4);
      expect(syncPort.enqueued[3].payload.is_archived).toBe(false);
      expect(syncPort.enqueued[3].payload.version).toBe(4);
    });

    it('updates account atomically and matches entity and outbox versions', async () => {
      const createUseCase = new CreateAccountUseCase(accountRepo, syncPort, uow);
      const updateUseCase = new UpdateAccountUseCase(accountRepo, syncPort, uow);

      const created = await createUseCase.execute({
        userId: validUserUUID,
        name: 'Old Name',
        accountType: 'bank'
      });

      const updated = await updateUseCase.execute({
        id: created.id,
        userId: validUserUUID,
        name: 'New Name',
        notes: 'Updated notes'
      });

      expect(updated.version).toBe(2);
      expect(updated.name).toBe('New Name');

      const stored = await accountRepo.findById(createAccountId(created.id));
      expect(stored?.version).toBe(2);
      expect(stored?.name).toBe('New Name');

      const outboxEntry = syncPort.enqueued[1];
      expect(outboxEntry.operation).toBe('UPDATE');
      expect(outboxEntry.payload.version).toBe(2);
      expect(outboxEntry.payload.name).toBe('New Name');
      expect(outboxEntry.payload.version).toBe(stored?.version);
    });
  });

  describe('DexieUnitOfWork Architecture & Boundary Verification', () => {
    it('DexieUnitOfWork delegates to database.transaction with "rw" mode and [accounts, syncOutbox] tables', async () => {
      const mockAccountsTable = { name: 'accounts' };
      const mockOutboxTable = { name: 'syncOutbox' };

      const transactionSpy = vi.fn().mockImplementation(async (mode, tables, callback) => {
        return callback();
      });

      const mockDb = {
        accounts: mockAccountsTable,
        syncOutbox: mockOutboxTable,
        transaction: transactionSpy
      } as unknown as LaxmiLensDB;

      const dexieUow = new DexieUnitOfWork(mockDb);

      let executed = false;
      const result = await dexieUow.run(async () => {
        executed = true;
        return 'success';
      });

      expect(executed).toBe(true);
      expect(result).toBe('success');
      expect(transactionSpy).toHaveBeenCalledTimes(1);

      const [mode, tables] = transactionSpy.mock.calls[0];
      expect(mode).toBe('rw');
      expect(tables).toEqual([mockAccountsTable, mockOutboxTable]);
    });

    it('DexieUnitOfWork propagates transaction abort when callback throws', async () => {
      const mockDb = {
        accounts: {},
        syncOutbox: {},
        transaction: vi.fn().mockImplementation(async (_mode, _tables, callback) => {
          // Dexie executes callback and if error thrown, transaction aborts
          return callback();
        })
      } as unknown as LaxmiLensDB;

      const dexieUow = new DexieUnitOfWork(mockDb);

      await expect(
        dexieUow.run(async () => {
          throw new Error('Dexie transaction failure');
        })
      ).rejects.toThrow('Dexie transaction failure');
    });
  });
});

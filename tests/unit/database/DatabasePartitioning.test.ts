import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DatabaseManager,
  getDatabaseNameForUser,
  DATABASE_PREFIX,
  UserRepositories
} from '@/infrastructure/database/local/DatabaseManager';
import {
  LegacyDatabaseMigrator,
  LEGACY_DATABASE_NAME,
  FORMER_EXCLUDED_USER_ID,
  NIL_UUID,
  SENTINEL_LOCAL_USER,
  MigrationSummary
} from '@/infrastructure/database/local/LegacyDatabaseMigrator';
import {
  NoActiveDatabaseSessionError,
  StaleSessionError,
  MigrationConflictError,
  UnauthorizedDatabaseAccessError,
  DiagnosticIntegrityError
} from '@/infrastructure/database/local/errors/DatabaseErrors';
import { InvalidUserIdError } from '@/domain/errors/DomainErrors';
import { AuthPort, AuthUser } from '@/application/ports/AuthPort';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import {
  LocalAccountRecord,
  LocalTransactionRecord,
  LocalCategoryRecord,
  LocalProfileRecord,
  LocalOutboxRecord,
  LocalSyncMetadataRecord
} from '@/infrastructure/database/local/schema';
import { DexieCategoryRepository } from '@/infrastructure/database/local/repositories/DexieCategoryRepository';
import { DexieAccountRepository } from '@/infrastructure/database/local/repositories/DexieAccountRepository';
import { DexieTransactionRepository } from '@/infrastructure/database/local/repositories/DexieTransactionRepository';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { DexieUnitOfWork } from '@/infrastructure/database/local/DexieUnitOfWork';
import {
  createAccountId,
  createTransactionId,
  createCategoryId,
  createUserId
} from '@/domain/value-objects/Identifiers';
import { Account, AccountType } from '@/domain/entities/Account';
import { Transaction } from '@/domain/entities/Transaction';
import { Category } from '@/domain/entities/Category';
import { Money } from '@/domain/value-objects/Money';

/**
 * High-fidelity in-memory MockLaxmiLensDB simulating Dexie table operations,
 * indexing, connection lifecycle, and transaction semantics.
 */
class MockLaxmiLensDB {
  public name: string;
  private _isOpen = false;

  public accountsStorage = new Map<string, LocalAccountRecord>();
  public transactionsStorage = new Map<string, LocalTransactionRecord>();
  public categoriesStorage = new Map<string, LocalCategoryRecord>();
  public profilesStorage = new Map<string, LocalProfileRecord>();
  public outboxStorage: LocalOutboxRecord[] = [];
  public metadataStorage = new Map<string, LocalSyncMetadataRecord>();

  constructor(name: string) {
    this.name = name;
  }

  public isOpen(): boolean {
    return this._isOpen;
  }

  public async open(): Promise<this> {
    this._isOpen = true;
    return this;
  }

  public async close(): Promise<void> {
    this._isOpen = false;
  }

  public accounts = {
    get: vi.fn(async (id: string) => this.accountsStorage.get(id) || null),
    put: vi.fn(async (record: LocalAccountRecord) => {
      this.accountsStorage.set(record.id, { ...record });
      return record.id;
    }),
    toArray: vi.fn(async () => Array.from(this.accountsStorage.values())),
    where: vi.fn((index: string) => {
      if (index === 'userId') {
        return {
          equals: (val: string) => ({
            toArray: vi.fn(async () =>
              Array.from(this.accountsStorage.values()).filter((a) => a.userId === val)
            )
          })
        };
      }
      if (index === '[userId+id]') {
        return {
          equals: ([uId, id]: [string, string]) => ({
            first: vi.fn(async () => {
              const item = this.accountsStorage.get(id);
              return item && item.userId === uId ? item : null;
            })
          })
        };
      }
      return {
        equals: () => ({ toArray: vi.fn(async () => []) })
      };
    })
  };

  public transactions = {
    get: vi.fn(async (id: string) => this.transactionsStorage.get(id) || null),
    put: vi.fn(async (record: LocalTransactionRecord) => {
      this.transactionsStorage.set(record.id, { ...record });
      return record.id;
    }),
    toArray: vi.fn(async () => Array.from(this.transactionsStorage.values())),
    where: vi.fn((index: string) => {
      if (index === 'userId') {
        return {
          equals: (val: string) => ({
            toArray: vi.fn(async () =>
              Array.from(this.transactionsStorage.values()).filter((t) => t.userId === val)
            )
          })
        };
      }
      if (index === '[userId+id]') {
        return {
          equals: ([uId, id]: [string, string]) => ({
            first: vi.fn(async () => {
              const item = this.transactionsStorage.get(id);
              return item && item.userId === uId ? item : null;
            })
          })
        };
      }
      if (index === '[userId+accountId]') {
        return {
          equals: ([uId, accId]: [string, string]) => ({
            toArray: vi.fn(async () =>
              Array.from(this.transactionsStorage.values()).filter(
                (t) => t.userId === uId && t.accountId === accId
              )
            )
          })
        };
      }
      if (index === 'destinationAccountId') {
        return {
          equals: (accId: string) => ({
            toArray: vi.fn(async () =>
              Array.from(this.transactionsStorage.values()).filter(
                (t) => t.destinationAccountId === accId
              )
            )
          })
        };
      }
      return {
        equals: () => ({ toArray: vi.fn(async () => []) })
      };
    })
  };

  public categories = {
    get: vi.fn(async (id: string) => this.categoriesStorage.get(id) || null),
    put: vi.fn(async (record: LocalCategoryRecord) => {
      this.categoriesStorage.set(record.id, { ...record });
      return record.id;
    }),
    bulkPut: vi.fn(async (records: LocalCategoryRecord[]) => {
      records.forEach((r) => this.categoriesStorage.set(r.id, { ...r }));
    }),
    update: vi.fn(async (id: string, changes: Partial<LocalCategoryRecord>) => {
      const rec = this.categoriesStorage.get(id);
      if (rec) {
        Object.assign(rec, changes);
        return 1;
      }
      return 0;
    }),
    toArray: vi.fn(async () => Array.from(this.categoriesStorage.values())),
    where: vi.fn((index: string) => {
      if (index === 'userId') {
        return {
          equals: (val: string) => ({
            toArray: vi.fn(async () =>
              Array.from(this.categoriesStorage.values()).filter((c) => c.userId === val)
            )
          })
        };
      }
      return {
        equals: () => ({ toArray: vi.fn(async () => []) })
      };
    }),
    filter: vi.fn((predicate: (c: LocalCategoryRecord) => boolean) => ({
      toArray: vi.fn(async () => Array.from(this.categoriesStorage.values()).filter(predicate))
    }))
  };

  public profiles = {
    get: vi.fn(async (id: string) => this.profilesStorage.get(id) || null),
    put: vi.fn(async (record: LocalProfileRecord) => {
      this.profilesStorage.set(record.id, { ...record });
      return record.id;
    }),
    toArray: vi.fn(async () => Array.from(this.profilesStorage.values()))
  };

  public syncOutbox = {
    get: vi.fn(async (id: number) => this.outboxStorage.find((e) => e.id === id) || null),
    add: vi.fn(async (record: LocalOutboxRecord) => {
      const id = this.outboxStorage.length + 1;
      const rec = { ...record, id };
      this.outboxStorage.push(rec);
      return id;
    }),
    delete: vi.fn(async (id: number) => {
      const idx = this.outboxStorage.findIndex((e) => e.id === id);
      if (idx !== -1) {
        this.outboxStorage.splice(idx, 1);
      }
    }),
    toArray: vi.fn(async () => [...this.outboxStorage]),
    where: vi.fn((index: string) => {
      if (index === 'userId') {
        return {
          equals: (val: string) => ({
            count: vi.fn(async () => this.outboxStorage.filter((e) => e.userId === val).length),
            toArray: vi.fn(async () => this.outboxStorage.filter((e) => e.userId === val))
          })
        };
      }
      if (index === '[userId+id]') {
        return {
          between: ([uId, min]: [string, unknown], [_uId2, max]: [string, unknown]) => ({
            limit: (n: number) => ({
              toArray: vi.fn(async () =>
                this.outboxStorage.filter((e) => e.userId === uId).slice(0, n)
              )
            })
          })
        };
      }
      return {
        equals: () => ({ count: vi.fn(async () => 0), toArray: vi.fn(async () => []) })
      };
    })
  };

  public syncMetadata = {
    get: vi.fn(async (key: string) => this.metadataStorage.get(key) || null),
    put: vi.fn(async (record: LocalSyncMetadataRecord) => {
      this.metadataStorage.set(record.key, { ...record });
      return record.key;
    }),
    toArray: vi.fn(async () => Array.from(this.metadataStorage.values()))
  };

  public transaction = vi.fn(async (_mode: string, _tables: any[], fn: () => Promise<any>): Promise<any> => {
    const accountsSnap = new Map(this.accountsStorage);
    const transactionsSnap = new Map(this.transactionsStorage);
    const categoriesSnap = new Map(this.categoriesStorage);
    const profilesSnap = new Map(this.profilesStorage);
    const outboxSnap = [...this.outboxStorage];
    const metadataSnap = new Map(this.metadataStorage);

    try {
      return await fn();
    } catch (err) {
      this.accountsStorage.clear();
      for (const [k, v] of accountsSnap) this.accountsStorage.set(k, v);

      this.transactionsStorage.clear();
      for (const [k, v] of transactionsSnap) this.transactionsStorage.set(k, v);

      this.categoriesStorage.clear();
      for (const [k, v] of categoriesSnap) this.categoriesStorage.set(k, v);

      this.profilesStorage.clear();
      for (const [k, v] of profilesSnap) this.profilesStorage.set(k, v);

      this.outboxStorage.length = 0;
      this.outboxStorage.push(...outboxSnap);

      this.metadataStorage.clear();
      for (const [k, v] of metadataSnap) this.metadataStorage.set(k, v);

      throw err;
    }
  });
}

describe('Phase 2D.7.3: Per-User IndexedDB Partitioning & Legacy Data Preservation Suite', () => {
  const user1 = 'aa854190-e763-45d8-a840-ea90f668f561';
  const user2 = 'e76bcf5d-fb6c-4427-bf18-785552905785';

  let mockAuth: {
    currentUser: AuthUser | null;
    getCurrentUser: ReturnType<typeof vi.fn>;
    onAuthStateChange: ReturnType<typeof vi.fn>;
  };

  let dbRegistry: Map<string, MockLaxmiLensDB>;

  const mockDbFactory = (name: string): LaxmiLensDB => {
    if (!dbRegistry.has(name)) {
      dbRegistry.set(name, new MockLaxmiLensDB(name));
    }
    return dbRegistry.get(name) as unknown as LaxmiLensDB;
  };

  beforeEach(() => {
    dbRegistry = new Map();
    mockAuth = {
      currentUser: {
        id: user1,
        email: 'user1@example.com',
        appMetadata: {},
        userMetadata: {}
      },
      getCurrentUser: vi.fn(async () => mockAuth.currentUser),
      onAuthStateChange: vi.fn()
    };
  });

  describe('Part 1: DatabaseManager Core & Authenticated Session Enforcement', () => {
    it('1. Correct database name derivation from authenticated session', () => {
      const derived = getDatabaseNameForUser(user1);
      expect(derived).toBe(`${DATABASE_PREFIX}_${user1}`);
      expect(derived).toBe('LaxmiLens_LocalDB_aa854190-e763-45d8-a840-ea90f668f561');
    });

    it('2. Invalid or missing session rejected', async () => {
      mockAuth.currentUser = null;
      const manager = new DatabaseManager(mockAuth as unknown as AuthPort, mockDbFactory);

      await expect(manager.getActiveDatabase()).rejects.toThrow(NoActiveDatabaseSessionError);
      await expect(manager.openForUser('invalid-uuid')).rejects.toThrow(/Invalid user ID/);
    });

    it('3. User A and User B resolve to different Dexie instances', async () => {
      const manager = new DatabaseManager(mockAuth as unknown as AuthPort, mockDbFactory);

      // Open User 1
      const db1 = await manager.openForUser(user1);
      expect((db1 as unknown as MockLaxmiLensDB).name).toBe(`LaxmiLens_LocalDB_${user1}`);

      // Authenticate as User 2
      mockAuth.currentUser = {
        id: user2,
        email: 'user2@example.com',
        appMetadata: {},
        userMetadata: {}
      };

      // Open User 2
      const db2 = await manager.openForUser(user2);
      expect((db2 as unknown as MockLaxmiLensDB).name).toBe(`LaxmiLens_LocalDB_${user2}`);
      expect(db1).not.toBe(db2);
    });

    it('4. Repeated requests for the same session reuse the intended instance', async () => {
      const manager = new DatabaseManager(mockAuth as unknown as AuthPort, mockDbFactory);

      const dbA = await manager.getActiveDatabase();
      const dbB = await manager.getActiveDatabase();
      expect(dbA).toBe(dbB);
    });

    it('5. Concurrent open requests are safe and resolve to the same instance', async () => {
      const manager = new DatabaseManager(mockAuth as unknown as AuthPort, mockDbFactory);

      const [dbA, dbB, dbC] = await Promise.all([
        manager.openForUser(user1),
        manager.openForUser(user1),
        manager.openForUser(user1)
      ]);

      expect(dbA).toBe(dbB);
      expect(dbB).toBe(dbC);
      expect((dbA as unknown as MockLaxmiLensDB).isOpen()).toBe(true);
    });

    it('6. Signout closes connections without deleting records', async () => {
      const manager = new DatabaseManager(mockAuth as unknown as AuthPort, mockDbFactory);

      const dbUser1 = (await manager.openForUser(user1)) as unknown as MockLaxmiLensDB;
      expect(dbUser1.isOpen()).toBe(true);

      // Save a record
      await dbUser1.accounts.put({
        id: 'acc-1',
        userId: user1,
        name: 'Savings',
        currency: 'INR',
        accountType: 'bank',
        isArchived: false,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // Sign out
      await manager.closeCurrentDatabase();

      expect(dbUser1.isOpen()).toBe(false);
      expect(manager.getActiveUserId()).toBeNull();
      // Record remains safely in storage
      expect(dbUser1.accountsStorage.has('acc-1')).toBe(true);
    });

    it('7. User switching rebuilds the repository dependency graph', async () => {
      const manager = new DatabaseManager(mockAuth as unknown as AuthPort, mockDbFactory);

      const repos1 = await manager.getActiveRepositories();
      expect(repos1.userId).toBe(user1);
      expect((repos1.database as unknown as MockLaxmiLensDB).name).toBe(`LaxmiLens_LocalDB_${user1}`);

      // Switch to User 2
      mockAuth.currentUser = {
        id: user2,
        email: 'user2@example.com',
        appMetadata: {},
        userMetadata: {}
      };

      const repos2 = await manager.getActiveRepositories();
      expect(repos2.userId).toBe(user2);
      expect((repos2.database as unknown as MockLaxmiLensDB).name).toBe(`LaxmiLens_LocalDB_${user2}`);
      expect(repos2.accountRepo).not.toBe(repos1.accountRepo);
      expect(repos2.unitOfWork).not.toBe(repos1.unitOfWork);
      expect(repos2.syncCoordinator).not.toBe(repos1.syncCoordinator);
    });

    it('8. User A cannot access User B database through manager', async () => {
      // User 1 is authenticated
      const manager = new DatabaseManager(mockAuth as unknown as AuthPort, mockDbFactory);

      const activeDb = (await manager.getActiveDatabase()) as unknown as MockLaxmiLensDB;
      expect(activeDb.name).toBe(`LaxmiLens_LocalDB_${user1}`);
      expect(activeDb.name).not.toBe(`LaxmiLens_LocalDB_${user2}`);
      expect(manager.isUserActive(user2)).toBe(false);
      expect(manager.isUserActive(user1)).toBe(true);

      // Attempting to directly open User 2's database while authenticated as User 1 throws UnauthorizedDatabaseAccessError
      await expect(manager.openForUser(user2)).rejects.toThrow(UnauthorizedDatabaseAccessError);

      // Active state remains completely untouched
      expect(manager.getActiveUserId()).toBe(user1);
      expect(manager.isUserActive(user1)).toBe(true);
    });

    it('9. A stale User A operation cannot write into User B database', async () => {
      const manager = new DatabaseManager(mockAuth as unknown as AuthPort, mockDbFactory);

      const reposUserA = await manager.getActiveRepositories();
      const generationA = manager.getSessionGeneration();

      // User 2 logs in before User A operation completes
      mockAuth.currentUser = {
        id: user2,
        email: 'user2@example.com',
        appMetadata: {},
        userMetadata: {}
      };
      await manager.openForUser(user2);
      const generationB = manager.getSessionGeneration();

      expect(generationB).toBeGreaterThan(generationA);
      // User A database is closed
      expect((reposUserA.database as unknown as MockLaxmiLensDB).isOpen()).toBe(false);
      // Repositories for A are strictly bound to A's database
      expect((reposUserA.database as unknown as MockLaxmiLensDB).name).toBe(`LaxmiLens_LocalDB_${user1}`);
    });

    it('10. Repositories and UnitOfWork share the same database instance', async () => {
      const manager = new DatabaseManager(mockAuth as unknown as AuthPort, mockDbFactory);
      const repos = await manager.getActiveRepositories();

      expect(repos.accountRepo['database']).toBe(repos.database);
      expect(repos.transactionRepo['database']).toBe(repos.database);
      expect(repos.categoryRepo['database']).toBe(repos.database);
      expect(repos.profileRepo['database']).toBe(repos.database);
      expect(repos.outboxManager['database']).toBe(repos.database);
      expect(repos.unitOfWork['database']).toBe(repos.database);
    });

    it('11. OutboxManager uses the active user database', async () => {
      const manager = new DatabaseManager(mockAuth as unknown as AuthPort, mockDbFactory);
      const repos = await manager.getActiveRepositories();

      await repos.outboxManager.enqueue({
        userId: user1,
        entity: 'accounts',
        entityId: 'acc-101',
        operation: 'INSERT',
        payload: { user_id: user1, name: 'Salary' }
      });

      const dbUser1 = repos.database as unknown as MockLaxmiLensDB;
      expect(dbUser1.outboxStorage.length).toBe(1);
      expect(dbUser1.outboxStorage[0].userId).toBe(user1);
      expect(dbUser1.outboxStorage[0].entityId).toBe('acc-101');
    });

    it('12. Pending outbox events remain intact across database reopens', async () => {
      const manager = new DatabaseManager(mockAuth as unknown as AuthPort, mockDbFactory);
      const repos = await manager.getActiveRepositories();

      await repos.outboxManager.enqueue({
        userId: user1,
        entity: 'accounts',
        entityId: 'acc-1',
        operation: 'INSERT',
        payload: { user_id: user1 }
      });

      // Sign out
      await manager.closeCurrentDatabase();

      // Sign back in
      const reopenedDb = (await manager.getActiveDatabase()) as unknown as MockLaxmiLensDB;
      expect(reopenedDb.outboxStorage.length).toBe(1);
      expect(reopenedDb.outboxStorage[0].entityId).toBe('acc-1');
    });

    it('13. Account-before-transaction sync ordering remains intact in user-scoped coordinator', async () => {
      const manager = new DatabaseManager(mockAuth as unknown as AuthPort, mockDbFactory);
      const repos = await manager.getActiveRepositories();

      // Enqueue transaction first, account second
      await repos.outboxManager.enqueue({
        userId: user1,
        entity: 'transactions',
        entityId: 'tx-1',
        operation: 'INSERT',
        payload: { user_id: user1, account_id: 'acc-1' }
      });

      await repos.outboxManager.enqueue({
        userId: user1,
        entity: 'accounts',
        entityId: 'acc-1',
        operation: 'INSERT',
        payload: { user_id: user1, name: 'Main' }
      });

      const pending = await repos.syncCoordinator.getPendingEntries(user1);
      expect(pending.length).toBe(2);
      expect(pending.some((e) => e.entity === 'accounts')).toBe(true);
      expect(pending.some((e) => e.entity === 'transactions')).toBe(true);
    });
  });

  describe('Part 2: Legacy Shared Database Preservation & Migration', () => {
    let legacyMockDb: MockLaxmiLensDB;
    let targetMockDb: MockLaxmiLensDB;

    beforeEach(() => {
      legacyMockDb = new MockLaxmiLensDB(LEGACY_DATABASE_NAME);
      legacyMockDb.open();
      targetMockDb = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user1}`);
      targetMockDb.open();
    });

    it('14. Legacy migration copies only exact matching ownership', async () => {
      // Seed User 1 record and User 2 record into legacy DB
      legacyMockDb.accountsStorage.set('acc-u1', {
        id: 'acc-u1',
        userId: user1,
        name: 'U1 Account',
        accountType: 'bank',
        currency: 'INR',
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      legacyMockDb.accountsStorage.set('acc-u2', {
        id: 'acc-u2',
        userId: user2,
        name: 'U2 Account',
        accountType: 'bank',
        currency: 'INR',
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      const migrator = new LegacyDatabaseMigrator();
      const result = await migrator.migrate(
        user1,
        targetMockDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      expect(result.isComplete).toBe(true);
      expect(result.accountsMigrated).toBe(1);
      expect(result.skippedForeignRecords).toBe(1);

      // Verify target DB contains only U1 account
      expect(targetMockDb.accountsStorage.has('acc-u1')).toBe(true);
      expect(targetMockDb.accountsStorage.has('acc-u2')).toBe(false);
    });

    it('15. Legacy HDFC and Job records of former user d94ba0c6 are NOT copied to User 1 or User 2', async () => {
      legacyMockDb.accountsStorage.set('hdfc-acc', {
        id: 'hdfc-acc',
        userId: FORMER_EXCLUDED_USER_ID,
        name: 'HDFC Bank',
        accountType: 'bank',
        currency: 'INR',
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      legacyMockDb.categoriesStorage.set('job-cat', {
        id: 'job-cat',
        userId: FORMER_EXCLUDED_USER_ID,
        name: 'Job / Salary',
        type: 'income',
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      const migrator = new LegacyDatabaseMigrator();
      const result = await migrator.migrate(
        user1,
        targetMockDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      expect(result.accountsMigrated).toBe(0);
      expect(result.categoriesMigrated).toBe(0);
      expect(result.skippedForeignRecords).toBe(2);
      expect(targetMockDb.accountsStorage.has('hdfc-acc')).toBe(false);
      expect(targetMockDb.categoriesStorage.has('job-cat')).toBe(false);
    });

    it('16. Conflicting ownership in outbox is safely skipped/quarantined', async () => {
      // Outbox event has top-level User 1, but payload specifies User 2
      legacyMockDb.outboxStorage.push({
        id: 1,
        userId: user1,
        entity: 'accounts',
        entityId: 'acc-conflicted',
        operation: 'UPDATE',
        payload: { user_id: user2, name: 'Spoofed' },
        attempts: 0,
        createdAt: '2026-01-01T00:00:00.000Z'
      });

      const migrator = new LegacyDatabaseMigrator();
      const result = await migrator.migrate(
        user1,
        targetMockDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      expect(result.outboxEntriesMigrated).toBe(0);
      expect(result.skippedAmbiguousRecords).toBe(1);
      expect(targetMockDb.outboxStorage.length).toBe(0);
    });

    it('17. Repeated migration is idempotent and does not create duplicates', async () => {
      legacyMockDb.accountsStorage.set('acc-1', {
        id: 'acc-1',
        userId: user1,
        name: 'Primary Checking',
        accountType: 'bank',
        currency: 'INR',
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      const migrator = new LegacyDatabaseMigrator();

      // First run
      const result1 = await migrator.migrate(
        user1,
        targetMockDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );
      expect(result1.accountsMigrated).toBe(1);

      // Second run on same target
      const result2 = await migrator.migrate(
        user1,
        targetMockDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );
      expect(result2.isComplete).toBe(true);
      expect(result2.accountsMigrated).toBe(0); // Marker skips redundant run
      expect(targetMockDb.accountsStorage.size).toBe(1);
    });

    it('18. Conflicting destination records stop unsafe migration', async () => {
      // Legacy has account at version 1
      legacyMockDb.accountsStorage.set('acc-conflict', {
        id: 'acc-conflict',
        userId: user1,
        name: 'Old Name',
        accountType: 'bank',
        currency: 'INR',
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      // Target already has same ID with version 2 and different name
      targetMockDb.accountsStorage.set('acc-conflict', {
        id: 'acc-conflict',
        userId: user1,
        name: 'New Different Name',
        accountType: 'bank',
        currency: 'INR',
        isArchived: false,
        version: 2,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      const migrator = new LegacyDatabaseMigrator();
      await expect(
        migrator.migrate(
          user1,
          targetMockDb as unknown as LaxmiLensDB,
          legacyMockDb as unknown as LaxmiLensDB
        )
      ).rejects.toThrow(MigrationConflictError);
    });

    it('19. Transaction paise amounts, versions, timestamps, and keys remain unchanged', async () => {
      const origTx: LocalTransactionRecord = {
        id: 'tx-exact-1',
        userId: user1,
        type: 'expense',
        accountId: 'acc-1',
        amountPaise: 450050, // 4,500.50 INR
        currency: 'INR',
        version: 3,
        idempotencyKey: 'idem-key-99',
        transactionDate: '2026-02-15T10:30:00.000Z',
        createdAt: '2026-02-15T10:30:00.000Z',
        updatedAt: '2026-02-15T10:30:00.000Z'
      };

      legacyMockDb.transactionsStorage.set(origTx.id, origTx);

      const migrator = new LegacyDatabaseMigrator();
      await migrator.migrate(
        user1,
        targetMockDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      const migrated = targetMockDb.transactionsStorage.get(origTx.id);
      expect(migrated).toBeDefined();
      expect(migrated!.amountPaise).toBe(450050);
      expect(migrated!.version).toBe(3);
      expect(migrated!.idempotencyKey).toBe('idem-key-99');
      expect(migrated!.transactionDate).toBe('2026-02-15T10:30:00.000Z');
    });

    it('20. Existing account and transaction repository operations function correctly in partitioned DB', async () => {
      const targetDb = targetMockDb as unknown as LaxmiLensDB;
      const accountRepo = new DexieAccountRepository(targetDb);
      const txRepo = new DexieTransactionRepository(targetDb);

      const accId = createAccountId('33333333-3333-4333-8333-333333333333');
      const uId = createUserId(user1);

      const account = new Account({
        id: accId,
        userId: uId,
        name: 'Partitioned Account',
        accountType: 'bank',
        openingBalancePaise: 100000,
        currency: 'INR',
        isArchived: false,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await accountRepo.save(account);

      const loaded = await accountRepo.findById(accId, uId);
      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe('Partitioned Account');
      expect(loaded!.userId).toBe(user1);

      // Verify transaction saving
      const txId = createTransactionId('44444444-4444-4444-8444-444444444444');
      const tx = new Transaction({
        id: txId,
        userId: uId,
        type: 'expense',
        amountPaise: 25000,
        title: 'Test Expense',
        currency: 'INR',
        accountId: accId,
        version: 1,
        idempotencyKey: 'tx-idem-1',
        transactionDate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await txRepo.save(tx);
      const loadedTx = await txRepo.findById(txId, uId);
      expect(loadedTx).not.toBeNull();
      expect(loadedTx!.amountPaise).toBe(25000);
    });

    it('21. Category seeding remains idempotent and tenant-isolated (no duplicate categories across tenants)', async () => {
      const db1 = targetMockDb as unknown as LaxmiLensDB;
      const catRepo1 = new DexieCategoryRepository(db1);

      // User 1 seeds defaults
      const seeded1 = await catRepo1.seedDefaults(createUserId(user1));
      expect(seeded1.length).toBe(17);

      // Second seed call is idempotent
      const seeded1Again = await catRepo1.seedDefaults(createUserId(user1));
      expect(seeded1Again.length).toBe(17);

      // User 1 finds all categories in DB 1
      const categories1 = await catRepo1.findAll(createUserId(user1));
      expect(categories1.length).toBe(17);

      // User 2 in a separate partitioned database
      const db2Mock = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user2}`);
      db2Mock.open();
      const catRepo2 = new DexieCategoryRepository(db2Mock as unknown as LaxmiLensDB);

      // User 2 seeds defaults in DB 2
      const seeded2 = await catRepo2.seedDefaults(createUserId(user2));
      expect(seeded2.length).toBe(17);

      // User 1 categories in DB 1 still strictly 17 (no cross-tenant leakage or 34-category duplication!)
      const categoriesAfter = await catRepo1.findAll(createUserId(user1));
      expect(categoriesAfter.length).toBe(17);
    });

    it('22. Existing shared database remains completely untouched during and after migration', async () => {
      const originalAccountsCount = legacyMockDb.accountsStorage.size;
      const originalTransactionsCount = legacyMockDb.transactionsStorage.size;
      const originalOutboxCount = legacyMockDb.outboxStorage.length;

      const migrator = new LegacyDatabaseMigrator();
      await migrator.migrate(
        user1,
        targetMockDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      // Legacy shared DB had ZERO mutations
      expect(legacyMockDb.accountsStorage.size).toBe(originalAccountsCount);
      expect(legacyMockDb.transactionsStorage.size).toBe(originalTransactionsCount);
      expect(legacyMockDb.outboxStorage.length).toBe(originalOutboxCount);
    });

    it('23. DatabaseManager authorization rejects anonymous callers and malformed sessions', async () => {
      const manager = new DatabaseManager(mockAuth as unknown as AuthPort, mockDbFactory);

      // Anonymous caller
      mockAuth.currentUser = null;
      await expect(manager.openForUser(user1)).rejects.toThrow(UnauthorizedDatabaseAccessError);

      // Malformed authenticated user
      mockAuth.currentUser = { id: 'malformed-not-uuid', email: 'test@example.com', appMetadata: {}, userMetadata: {} };
      await expect(manager.openForUser(user1)).rejects.toThrow(UnauthorizedDatabaseAccessError);

      // Invalid requested UUID
      mockAuth.currentUser = { id: user1, email: 'test@example.com', appMetadata: {}, userMetadata: {} };
      await expect(manager.openForUser('invalid-uuid')).rejects.toThrow(InvalidUserIdError);
    });

    it('24. DatabaseManager rechecks authorization at async boundary and aborts if session changed during open', async () => {
      let callCount = 0;
      mockAuth.getCurrentUser = vi.fn(async () => {
        callCount++;
        // First check matches user1, but during open auth switches to user2
        if (callCount === 1) {
          return { id: user1, email: 'u1@example.com', appMetadata: {}, userMetadata: {} };
        }
        return { id: user2, email: 'u2@example.com', appMetadata: {}, userMetadata: {} };
      });

      const manager = new DatabaseManager(mockAuth as unknown as AuthPort, mockDbFactory);
      await expect(manager.openForUser(user1)).rejects.toThrow(UnauthorizedDatabaseAccessError);
      expect(manager.getActiveUserId()).toBeNull();
    });

    it('25. DatabaseManager promise ownership prevents older open from clearing newer openPromise', async () => {
      const manager = new DatabaseManager(mockAuth as unknown as AuthPort, mockDbFactory);

      // User 1 starts opening
      mockAuth.currentUser = { id: user1, email: 'u1@example.com', appMetadata: {}, userMetadata: {} };
      const promise1 = manager.openForUser(user1);
      promise1.catch(() => {});

      // Switch to User 2 before promise1 settles
      mockAuth.currentUser = { id: user2, email: 'u2@example.com', appMetadata: {}, userMetadata: {} };
      const promise2 = manager.openForUser(user2);

      // Third caller requests User 2 and joins promise2 synchronously
      const promise3 = manager.openForUser(user2);
      expect(promise3).toBe(promise2);

      // Await both: promise1 should reject due to stale session, promise2 succeeds
      await expect(promise1).rejects.toThrow(StaleSessionError);
      const db2 = await promise2;
      expect((db2 as unknown as MockLaxmiLensDB).name).toBe(`LaxmiLens_LocalDB_${user2}`);
      expect(manager.getActiveUserId()).toBe(user2);
    });

    it('26. Per-User Migration Mutex returns same promise for concurrent calls on same user', async () => {
      const migrator = new LegacyDatabaseMigrator();

      const p1 = migrator.migrate(user1, targetMockDb as unknown as LaxmiLensDB, legacyMockDb as unknown as LaxmiLensDB);
      const p2 = migrator.migrate(user1, targetMockDb as unknown as LaxmiLensDB, legacyMockDb as unknown as LaxmiLensDB);

      expect(p1).toBe(p2);
      const [res1, res2] = await Promise.all([p1, p2]);
      expect(res1).toBe(res2);
      expect(res1.isComplete).toBe(true);
    });

    it('27. Migration Mutex allows different users to migrate independently', async () => {
      const migrator = new LegacyDatabaseMigrator();
      const target2MockDb = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user2}`);
      target2MockDb.open();

      const p1 = migrator.migrate(user1, targetMockDb as unknown as LaxmiLensDB, legacyMockDb as unknown as LaxmiLensDB);
      const p2 = migrator.migrate(user2, target2MockDb as unknown as LaxmiLensDB, legacyMockDb as unknown as LaxmiLensDB);

      expect(p1).not.toBe(p2);
      const [res1, res2] = await Promise.all([p1, p2]);
      expect(res1.isComplete).toBe(true);
      expect(res2.isComplete).toBe(true);
    });

    it('28. Migration failure is cleaned up from mutex and permits safe retry', async () => {
      const migrator = new LegacyDatabaseMigrator();

      // Seed a conflict to cause failure
      legacyMockDb.accountsStorage.set('acc-conflict', {
        id: 'acc-conflict',
        userId: user1,
        name: 'V1 Name',
        accountType: 'bank',
        currency: 'INR',
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });
      targetMockDb.accountsStorage.set('acc-conflict', {
        id: 'acc-conflict',
        userId: user1,
        name: 'V2 Conflict',
        accountType: 'bank',
        currency: 'INR',
        isArchived: false,
        version: 2,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      // First run fails with MigrationConflictError
      await expect(
        migrator.migrate(user1, targetMockDb as unknown as LaxmiLensDB, legacyMockDb as unknown as LaxmiLensDB)
      ).rejects.toThrow(MigrationConflictError);

      // Resolve the conflict
      targetMockDb.accountsStorage.delete('acc-conflict');

      // Second run can be immediately retried and succeeds cleanly
      const retryResult = await migrator.migrate(
        user1,
        targetMockDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );
      expect(retryResult.isComplete).toBe(true);
    });

    it('29. Legacy nil-UUID and missing-owner default categories are preserved in user partitioned database', async () => {
      // Nil-UUID default category
      legacyMockDb.categoriesStorage.set('nil-cat-food', {
        id: 'nil-cat-food',
        userId: '00000000-0000-0000-0000-000000000000',
        name: 'Food & Groceries',
        type: 'expense',
        isDefault: true,
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      // Missing-owner default category
      legacyMockDb.categoriesStorage.set('nil-cat-salary', {
        id: 'nil-cat-salary',
        userId: undefined as unknown as string,
        name: 'Salary',
        type: 'income',
        isSystem: true,
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      const migrator = new LegacyDatabaseMigrator();
      const result = await migrator.migrate(
        user1,
        targetMockDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      expect(result.categoriesMigrated).toBe(2);
      expect(targetMockDb.categoriesStorage.has('nil-cat-food')).toBe(true);
      expect(targetMockDb.categoriesStorage.has('nil-cat-salary')).toBe(true);
      expect(targetMockDb.categoriesStorage.get('nil-cat-food')!.userId).toBe('00000000-0000-0000-0000-000000000000');
    });

    it('30. Historical transaction referencing nil-UUID default category preserves reference and resolves via repository', async () => {
      legacyMockDb.categoriesStorage.set('sys-cat-rent', {
        id: 'sys-cat-rent',
        userId: '00000000-0000-0000-0000-000000000000',
        name: 'Rent & Housing',
        type: 'expense',
        isDefault: true,
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      legacyMockDb.transactionsStorage.set('tx-rent', {
        id: 'tx-rent',
        userId: user1,
        type: 'expense',
        amountPaise: 5000000,
        currency: 'INR',
        accountId: 'acc-1',
        categoryId: 'sys-cat-rent',
        version: 1,
        idempotencyKey: 'tx-idem-rent',
        transactionDate: '2026-02-01T00:00:00.000Z',
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z'
      });

      const migrator = new LegacyDatabaseMigrator();
      await migrator.migrate(
        user1,
        targetMockDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      // Verify transaction preserved categoryId
      const targetTx = targetMockDb.transactionsStorage.get('tx-rent');
      expect(targetTx).toBeDefined();
      expect(targetTx!.categoryId).toBe('sys-cat-rent');

      // Verify category repository can resolve the preserved nil-UUID default category
      const catRepo = new DexieCategoryRepository(targetMockDb as unknown as LaxmiLensDB);
      const resolvedCat = await catRepo.findById(createCategoryId('sys-cat-rent'), createUserId(user1));
      expect(resolvedCat).not.toBeNull();
      expect(resolvedCat!.name).toBe('Rent & Housing');
      expect(resolvedCat!.isDefault).toBe(true);
    });

    it('31. Ambiguous unassigned non-default categories are rejected as ambiguous', async () => {
      legacyMockDb.categoriesStorage.set('orphan-custom', {
        id: 'orphan-custom',
        userId: undefined as unknown as string,
        name: 'Mystery Custom Category',
        type: 'expense',
        isDefault: false,
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      const migrator = new LegacyDatabaseMigrator();
      const result = await migrator.migrate(
        user1,
        targetMockDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      expect(result.skippedAmbiguousRecords).toBe(1);
      expect(targetMockDb.categoriesStorage.has('orphan-custom')).toBe(false);
    });

    it('32. Legacy database access enforces explicit read-only transaction across all stores', async () => {
      const migrator = new LegacyDatabaseMigrator();
      await migrator.migrate(
        user1,
        targetMockDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      // Verify explicit 'r' read-only mode was invoked covering all 5 stores
      expect(legacyMockDb.transaction).toHaveBeenCalledWith(
        'r',
        expect.arrayContaining([
          legacyMockDb.accounts,
          legacyMockDb.transactions,
          legacyMockDb.categories,
          legacyMockDb.profiles,
          legacyMockDb.syncOutbox
        ]),
        expect.any(Function)
      );
    });

    it('33. LaxmiLensDB gracefully closes connection on versionchange event', () => {
      const db = new LaxmiLensDB('test_versionchange_db');
      const closeSpy = vi.spyOn(db, 'close');

      // Trigger versionchange event through Dexie event emitter
      (db.on as any).versionchange.fire({ newVersion: 5 });

      expect(closeSpy).toHaveBeenCalled();
    });

    it('34. Nonexistent legacy database completes without creating database', async () => {
      let openCalled = false;
      const fakeLegacy = {
        isOpen: () => false,
        open: vi.fn(async () => {
          openCalled = true;
          return fakeLegacy;
        }),
        close: vi.fn()
      };

      const migrator = new LegacyDatabaseMigrator(
        () => fakeLegacy as any,
        async () => false // Simulate legacy DB does not exist on disk
      );

      const result = await migrator.migrate(
        user1,
        targetMockDb as unknown as LaxmiLensDB
      );

      expect(result.isComplete).toBe(true);
      expect(openCalled).toBe(false);
      expect(fakeLegacy.open).not.toHaveBeenCalled();
      const marker = targetMockDb.metadataStorage.get(`legacy_migration_${user1}`);
      expect(marker).toBeDefined();
      expect(marker!.value).toBe('completed_no_legacy_db');
    });

    it('35. Schema-less legacy inspection does not invoke schema upgrade callbacks', async () => {
      await legacyMockDb.close();
      const openSpy = vi.spyOn(legacyMockDb, 'open');
      const migrator = new LegacyDatabaseMigrator();

      await migrator.migrate(
        user1,
        targetMockDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      expect(openSpy).toHaveBeenCalled();
      // Ensure no version/stores/upgrade modification methods were called on legacyDb
      expect((legacyMockDb as any).version).toBeUndefined();
    });

    it('36. local-user default category is preserved and normalized to nil-UUID', async () => {
      legacyMockDb.categoriesStorage.set('lu-default-groceries', {
        id: 'lu-default-groceries',
        userId: SENTINEL_LOCAL_USER,
        name: 'Groceries & Provisions',
        type: 'expense',
        isDefault: true,
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      const migrator = new LegacyDatabaseMigrator();
      const result = await migrator.migrate(
        user1,
        targetMockDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      expect(result.categoriesMigrated).toBe(1);
      const targetCat = targetMockDb.categoriesStorage.get('lu-default-groceries');
      expect(targetCat).toBeDefined();
      expect(targetCat!.userId).toBe(NIL_UUID);
      expect(targetCat!.isDefault).toBe(true);
      expect(targetCat!.isSystem).toBe(true);
      expect(targetCat!.name).toBe('Groceries & Provisions');
    });

    it('37. local-user custom category records migration conflict and is not migrated', async () => {
      legacyMockDb.categoriesStorage.set('lu-custom-hobby', {
        id: 'lu-custom-hobby',
        userId: SENTINEL_LOCAL_USER,
        name: 'Custom Hobby Equipment',
        type: 'expense',
        isDefault: false,
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      const migrator = new LegacyDatabaseMigrator();
      const result = await migrator.migrate(
        user1,
        targetMockDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      expect(result.categoriesMigrated).toBe(0);
      expect(result.skippedAmbiguousRecords).toBe(1);
      expect(targetMockDb.categoriesStorage.has('lu-custom-hobby')).toBe(false);
      expect(result.conflicts.length).toBe(1);
      expect(result.conflicts[0].entityId).toBe('lu-custom-hobby');
      expect(result.conflicts[0].ownerValue).toBe(SENTINEL_LOCAL_USER);
      expect(result.conflicts[0].reason).toContain("'local-user' custom category");
      expect(result.isComplete).toBe(true);

      const marker = targetMockDb.metadataStorage.get(`legacy_migration_${user1}`);
      expect(marker!.value).toBe('completed_with_quarantined_conflicts');
    });

    it('38. Nil-UUID custom category records migration conflict and is not migrated', async () => {
      legacyMockDb.categoriesStorage.set('nil-custom-coffee', {
        id: 'nil-custom-coffee',
        userId: NIL_UUID,
        name: 'Specialty Coffee',
        type: 'expense',
        isDefault: false,
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      const migrator = new LegacyDatabaseMigrator();
      const result = await migrator.migrate(
        user1,
        targetMockDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      expect(result.categoriesMigrated).toBe(0);
      expect(result.skippedAmbiguousRecords).toBe(1);
      expect(targetMockDb.categoriesStorage.has('nil-custom-coffee')).toBe(false);
      expect(result.conflicts.some((c) => c.entityId === 'nil-custom-coffee')).toBe(true);
    });

    it('39. Missing-owner custom category records migration conflict and is not migrated', async () => {
      legacyMockDb.categoriesStorage.set('missing-custom-art', {
        id: 'missing-custom-art',
        userId: undefined as unknown as string,
        name: 'Fine Art Supplies',
        type: 'expense',
        isDefault: false,
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      const migrator = new LegacyDatabaseMigrator();
      const result = await migrator.migrate(
        user1,
        targetMockDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      expect(result.categoriesMigrated).toBe(0);
      expect(result.skippedAmbiguousRecords).toBe(1);
      expect(targetMockDb.categoriesStorage.has('missing-custom-art')).toBe(false);
      expect(result.conflicts.some((c) => c.entityId === 'missing-custom-art')).toBe(true);
      expect(result.conflicts.find((c) => c.entityId === 'missing-custom-art')!.reason).toContain('Missing-owner');
    });

    it('40. Foreign custom category is excluded without conflict logging', async () => {
      legacyMockDb.categoriesStorage.set('foreign-u2-cat', {
        id: 'foreign-u2-cat',
        userId: user2,
        name: 'User 2 Secret Category',
        type: 'expense',
        isDefault: false,
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      const migrator = new LegacyDatabaseMigrator();
      const result = await migrator.migrate(
        user1,
        targetMockDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      expect(result.skippedForeignRecords).toBe(1);
      expect(targetMockDb.categoriesStorage.has('foreign-u2-cat')).toBe(false);
      expect(result.conflicts.some((c) => c.entityId === 'foreign-u2-cat')).toBe(false);
    });

    it('41. Historical transaction category ID preserved and unresolved reference reported', async () => {
      legacyMockDb.categoriesStorage.set('unmigrated-cat', {
        id: 'unmigrated-cat',
        userId: SENTINEL_LOCAL_USER,
        name: 'Unmigrated Custom Category',
        type: 'expense',
        isDefault: false,
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      legacyMockDb.transactionsStorage.set('tx-unresolved', {
        id: 'tx-unresolved',
        userId: user1,
        type: 'expense',
        accountId: 'acc-1',
        categoryId: 'unmigrated-cat',
        amountPaise: 75000,
        currency: 'INR',
        version: 1,
        idempotencyKey: 'idem-unres-1',
        transactionDate: '2026-02-10T00:00:00.000Z',
        createdAt: '2026-02-10T00:00:00.000Z',
        updatedAt: '2026-02-10T00:00:00.000Z'
      });

      const migrator = new LegacyDatabaseMigrator();
      const result = await migrator.migrate(
        user1,
        targetMockDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      // Verify transaction was migrated and categoryId was NOT nulled out
      const migratedTx = targetMockDb.transactionsStorage.get('tx-unresolved');
      expect(migratedTx).toBeDefined();
      expect(migratedTx!.categoryId).toBe('unmigrated-cat');

      // Verify unresolved reference was reported in summary and conflict record
      expect(result.unresolvedCategoryReferences).toEqual([
        { transactionId: 'tx-unresolved', categoryId: 'unmigrated-cat' }
      ]);
      const conflict = result.conflicts.find((c) => c.entityId === 'unmigrated-cat');
      expect(conflict).toBeDefined();
      expect(conflict!.referencingTransactionIds).toContain('tx-unresolved');
    });

    it('42. Missing optional stores in legacy database are safely handled without error', async () => {
      // Mock legacy DB where syncOutbox table is missing
      const partialLegacy = {
        name: LEGACY_DATABASE_NAME,
        isOpen: () => true,
        open: vi.fn(),
        close: vi.fn(),
        accounts: legacyMockDb.accounts,
        transactions: legacyMockDb.transactions,
        categories: legacyMockDb.categories,
        profiles: legacyMockDb.profiles,
        syncOutbox: undefined,
        transaction: vi.fn(async (_mode, _tables, fn) => fn())
      };

      legacyMockDb.accountsStorage.set('acc-partial', {
        id: 'acc-partial',
        userId: user1,
        name: 'Partial Acc',
        accountType: 'bank',
        currency: 'INR',
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      const migrator = new LegacyDatabaseMigrator();
      const result = await migrator.migrate(
        user1,
        targetMockDb as unknown as LaxmiLensDB,
        partialLegacy as any
      );

      expect(result.isComplete).toBe(true);
      expect(result.accountsMigrated).toBe(1);
      expect(result.outboxEntriesMigrated).toBe(0);
      expect(partialLegacy.close).toHaveBeenCalled();
    });

    it('43. Legacy inspection connection closes in finally block on success and failure', async () => {
      const closeSpy = vi.spyOn(legacyMockDb, 'close');
      const migrator = new LegacyDatabaseMigrator();

      // Case A: Success path closes connection
      await migrator.migrate(
        user1,
        targetMockDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );
      expect(closeSpy).toHaveBeenCalled();

      // Case B: Read failure path closes connection
      const failingLegacy = {
        isOpen: () => true,
        open: vi.fn(),
        close: vi.fn(),
        accounts: {
          toArray: vi.fn().mockRejectedValue(new Error('Simulated IDB read failure'))
        },
        transaction: vi.fn(async () => {
          throw new Error('Simulated IDB transaction failure');
        })
      };

      const migrator2 = new LegacyDatabaseMigrator();
      const targetDb2 = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user2}`);
      targetDb2.open();

      const resultFail = await migrator2.migrate(
        user2,
        targetDb2 as unknown as LaxmiLensDB,
        failingLegacy as any
      );

      expect(failingLegacy.close).toHaveBeenCalled();
      expect(resultFail.errors.length).toBeGreaterThan(0);
    });

    it('44. Repository category lookup after migration resolves defaults and rejects foreign custom', async () => {
      const targetDb = targetMockDb as unknown as LaxmiLensDB;
      const catRepo = new DexieCategoryRepository(targetDb);

      // Save user-owned custom category
      targetMockDb.categoriesStorage.set('my-custom-cat', {
        id: 'my-custom-cat',
        userId: user1,
        name: 'My Projects',
        type: 'expense',
        isDefault: false,
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      // Save normalized nil-UUID default category
      targetMockDb.categoriesStorage.set('nil-default-salary', {
        id: 'nil-default-salary',
        userId: NIL_UUID,
        name: 'Salary & Wages',
        type: 'income',
        isDefault: true,
        isSystem: true,
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      // User 1 can find their custom category
      const customCat = await catRepo.findById(createCategoryId('my-custom-cat'), createUserId(user1));
      expect(customCat).not.toBeNull();
      expect(customCat!.name).toBe('My Projects');

      // User 1 can find the nil-UUID default category
      const defaultCat = await catRepo.findById(createCategoryId('nil-default-salary'), createUserId(user1));
      expect(defaultCat).not.toBeNull();
      expect(defaultCat!.name).toBe('Salary & Wages');

      // User 2 cannot access User 1's custom category
      await expect(
        catRepo.findById(createCategoryId('my-custom-cat'), createUserId(user2))
      ).rejects.toThrow();
    });

    it('45. Repeated migration is idempotent with quarantined conflicts marker', async () => {
      legacyMockDb.categoriesStorage.set('lu-custom-ambiguous', {
        id: 'lu-custom-ambiguous',
        userId: SENTINEL_LOCAL_USER,
        name: 'Ambiguous Cat',
        type: 'expense',
        isDefault: false,
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      const migrator = new LegacyDatabaseMigrator();

      // First run records quarantined conflict
      const res1 = await migrator.migrate(
        user1,
        targetMockDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );
      expect(res1.isComplete).toBe(true);
      expect(res1.conflicts.length).toBe(1);

      // Second run detects marker and skips execution safely
      const res2 = await migrator.migrate(
        user1,
        targetMockDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );
      expect(res2.isComplete).toBe(true);
      expect(res2.categoriesMigrated).toBe(0);
      // Durably restored conflicts from targetDb metadata
      expect(res2.conflicts.length).toBe(1);
      expect(res2.conflicts[0].entityId).toBe('lu-custom-ambiguous');
    });

    it('46. Existence checker throwing aborts inspection, fails closed, and writes no marker', async () => {
      let openCalled = false;
      const fakeLegacy = {
        isOpen: () => false,
        open: vi.fn(async () => {
          openCalled = true;
          return fakeLegacy;
        }),
        close: vi.fn()
      };

      const migrator = new LegacyDatabaseMigrator(
        () => fakeLegacy as any,
        async () => {
          throw new Error('IDBDatabase blocked or storage permission denied');
        }
      );

      const targetDb = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user1}`);
      targetDb.open();

      const result = await migrator.migrate(user1, targetDb as unknown as LaxmiLensDB);

      // Must fail closed
      expect(result.isComplete).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('existence check error');
      // Must NOT open legacy database
      expect(openCalled).toBe(false);
      expect(fakeLegacy.open).not.toHaveBeenCalled();
      // Must NOT write a completed marker
      expect(targetDb.metadataStorage.get(`legacy_migration_${user1}`)).toBeUndefined();
    });

    it('47. Existence checker returning invalid result (non-boolean) aborts, fails closed, and writes no marker', async () => {
      const fakeLegacy = {
        isOpen: () => false,
        open: vi.fn(),
        close: vi.fn()
      };

      const migrator = new LegacyDatabaseMigrator(
        () => fakeLegacy as any,
        async () => 'invalid-non-boolean' as unknown as boolean
      );

      const targetDb = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user1}`);
      targetDb.open();

      const result = await migrator.migrate(user1, targetDb as unknown as LaxmiLensDB);

      // Must fail closed
      expect(result.isComplete).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Invalid existence check result');
      expect(fakeLegacy.open).not.toHaveBeenCalled();
      expect(targetDb.metadataStorage.get(`legacy_migration_${user1}`)).toBeUndefined();
    });

    it('48. Legacy read failure fails closed without writing a completed marker', async () => {
      const failingLegacy = {
        isOpen: () => true,
        open: vi.fn(),
        close: vi.fn(),
        accounts: {
          toArray: vi.fn().mockRejectedValue(new Error('Corrupt IDB store'))
        },
        transaction: vi.fn(async () => {
          throw new Error('Transaction aborted due to disk error');
        })
      };

      const migrator = new LegacyDatabaseMigrator();
      const targetDb = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user1}`);
      targetDb.open();

      const result = await migrator.migrate(
        user1,
        targetDb as unknown as LaxmiLensDB,
        failingLegacy as any
      );

      expect(result.isComplete).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Legacy database inspection failed (read error)');
      expect(failingLegacy.close).toHaveBeenCalled();
      expect(targetDb.metadataStorage.get(`legacy_migration_${user1}`)).toBeUndefined();
    });

    it('49. Quarantined conflicts and unresolved category references are durably persisted in targetDb.syncMetadata', async () => {
      legacyMockDb.categoriesStorage.set('lu-ambiguous-pet', {
        id: 'lu-ambiguous-pet',
        userId: SENTINEL_LOCAL_USER,
        name: 'Pet Expenses',
        type: 'expense',
        isDefault: false,
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      legacyMockDb.transactionsStorage.set('tx-pet-food', {
        id: 'tx-pet-food',
        userId: user1,
        accountId: 'acc-1',
        categoryId: 'lu-ambiguous-pet',
        amountPaise: 45000,
        currency: 'INR',
        version: 1,
        idempotencyKey: 'idem-pet-1',
        transactionDate: '2026-02-12T00:00:00.000Z',
        createdAt: '2026-02-12T00:00:00.000Z',
        updatedAt: '2026-02-12T00:00:00.000Z'
      });

      const migrator = new LegacyDatabaseMigrator();
      const targetDb = targetMockDb as unknown as LaxmiLensDB;

      const result = await migrator.migrate(
        user1,
        targetDb,
        legacyMockDb as unknown as LaxmiLensDB
      );

      expect(result.isComplete).toBe(true);
      expect(result.conflicts.length).toBe(1);
      expect(result.unresolvedCategoryReferences.length).toBe(1);

      // Verify durable persistence in targetDb syncMetadata
      const diagRecord = targetMockDb.metadataStorage.get(`legacy_migration_diagnostics_${user1}`);
      expect(diagRecord).toBeDefined();

      const parsedDiag = JSON.parse(diagRecord!.value);
      expect(parsedDiag.userId).toBe(user1);
      expect(parsedDiag.conflicts.length).toBe(1);
      expect(parsedDiag.conflicts[0].entityId).toBe('lu-ambiguous-pet');
      expect(parsedDiag.conflicts[0].referencingTransactionIds).toContain('tx-pet-food');
      expect(parsedDiag.unresolvedCategoryReferences).toEqual([
        { transactionId: 'tx-pet-food', categoryId: 'lu-ambiguous-pet' }
      ]);
    });

    it('50. Repeated application startup restores durably persisted conflicts and does not overwrite with empty result', async () => {
      legacyMockDb.categoriesStorage.set('lu-ambiguous-gardening', {
        id: 'lu-ambiguous-gardening',
        userId: SENTINEL_LOCAL_USER,
        name: 'Gardening & Plants',
        type: 'expense',
        isDefault: false,
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      const migrator = new LegacyDatabaseMigrator();
      const targetDb = targetMockDb as unknown as LaxmiLensDB;

      // Initial run: executes migration and persists diagnostics
      const initialRun = await migrator.migrate(
        user1,
        targetDb,
        legacyMockDb as unknown as LaxmiLensDB
      );
      expect(initialRun.conflicts.length).toBe(1);

      // Simulate application restart: hasMigrated is now true
      const restartRun = await migrator.migrate(
        user1,
        targetDb,
        legacyMockDb as unknown as LaxmiLensDB
      );

      // Must restore persisted conflicts, NOT overwrite with empty array
      expect(restartRun.isComplete).toBe(true);
      expect(restartRun.conflicts.length).toBe(1);
      expect(restartRun.conflicts[0].entityId).toBe('lu-ambiguous-gardening');
      expect(restartRun.skippedAmbiguousRecords).toBe(1);

      // Verify direct retrieval helper
      const diagnostics = await migrator.getPersistedDiagnostics(user1, targetDb);
      expect(diagnostics).not.toBeNull();
      expect(diagnostics!.conflicts[0].entityId).toBe('lu-ambiguous-gardening');
    });

    it('51. Persisted conflict records and migration markers are strictly isolated per user database', async () => {
      const migrator = new LegacyDatabaseMigrator();

      const targetDbU1 = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user1}`);
      targetDbU1.open();
      const targetDbU2 = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user2}`);
      targetDbU2.open();

      // Seed conflict for User 1's migration
      legacyMockDb.categoriesStorage.set('lu-ambiguous-u1', {
        id: 'lu-ambiguous-u1',
        userId: SENTINEL_LOCAL_USER,
        name: 'U1 Custom Category',
        type: 'expense',
        isDefault: false,
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      await migrator.migrate(user1, targetDbU1 as unknown as LaxmiLensDB, legacyMockDb as unknown as LaxmiLensDB);

      // User 1 DB must have diagnostics
      const diagU1 = await migrator.getPersistedDiagnostics(user1, targetDbU1 as unknown as LaxmiLensDB);
      expect(diagU1).not.toBeNull();
      expect(diagU1!.conflicts.length).toBe(1);

      // User 2 DB must NOT have User 1's diagnostics or marker
      const diagU2 = await migrator.getPersistedDiagnostics(user1, targetDbU2 as unknown as LaxmiLensDB);
      expect(diagU2).toBeNull();
      expect(targetDbU2.metadataStorage.get(`legacy_migration_${user1}`)).toBeUndefined();
    });

    it('52. Clean migration without conflicts produces completed marker and no diagnostics record', async () => {
      // Clean account for User 1
      legacyMockDb.accountsStorage.set('acc-clean', {
        id: 'acc-clean',
        userId: user1,
        name: 'Clean Bank Account',
        accountType: 'bank',
        currency: 'INR',
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      const migrator = new LegacyDatabaseMigrator();
      const targetDb = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user1}`);
      targetDb.open();

      const result = await migrator.migrate(
        user1,
        targetDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      expect(result.isComplete).toBe(true);
      expect(result.conflicts.length).toBe(0);
      expect(result.unresolvedCategoryReferences.length).toBe(0);

      // Completed marker must be 'completed' (not with conflicts)
      const marker = targetDb.metadataStorage.get(`legacy_migration_${user1}`);
      expect(marker).toBeDefined();
      expect(marker!.value).toBe('completed');

      // No diagnostics record created for clean migration
      const diag = targetDb.metadataStorage.get(`legacy_migration_diagnostics_${user1}`);
      expect(diag).toBeUndefined();
    });

    it('53. Genuinely missing diagnostics record returns null', async () => {
      const migrator = new LegacyDatabaseMigrator();
      const targetDb = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user1}`);
      targetDb.open();

      const diag = await migrator.getPersistedDiagnostics(user1, targetDb as unknown as LaxmiLensDB);
      expect(diag).toBeNull();
    });

    it('54. Valid diagnostics retrieval successfully parses conflicts and unresolvedCategoryReferences', async () => {
      const migrator = new LegacyDatabaseMigrator();
      const targetDb = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user1}`);
      targetDb.open();

      const validPayload = {
        userId: user1,
        migrationMarker: `legacy_migration_${user1}`,
        conflicts: [
          {
            entity: 'categories',
            entityId: 'cat-test-1',
            name: 'Test Category',
            ownerValue: SENTINEL_LOCAL_USER,
            reason: 'Sentinel owner lacks default flag'
          }
        ],
        unresolvedCategoryReferences: [
          { transactionId: 'tx-1', categoryId: 'cat-test-1' }
        ],
        recordedAt: '2026-02-01T00:00:00.000Z'
      };

      targetDb.metadataStorage.set(`legacy_migration_diagnostics_${user1}`, {
        key: `legacy_migration_diagnostics_${user1}`,
        value: JSON.stringify(validPayload),
        updatedAt: '2026-02-01T00:00:00.000Z'
      });

      const diag = await migrator.getPersistedDiagnostics(user1, targetDb as unknown as LaxmiLensDB);
      expect(diag).not.toBeNull();
      expect(diag!.conflicts.length).toBe(1);
      expect(diag!.conflicts[0].entityId).toBe('cat-test-1');
      expect(diag!.unresolvedCategoryReferences).toEqual([
        { transactionId: 'tx-1', categoryId: 'cat-test-1' }
      ]);
    });

    it('55. Malformed JSON throws DiagnosticIntegrityError and preserves stored record', async () => {
      const migrator = new LegacyDatabaseMigrator();
      const targetDb = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user1}`);
      targetDb.open();

      const malformedJson = '{ corrupted_json: true, ... ';
      targetDb.metadataStorage.set(`legacy_migration_diagnostics_${user1}`, {
        key: `legacy_migration_diagnostics_${user1}`,
        value: malformedJson,
        updatedAt: '2026-02-01T00:00:00.000Z'
      });

      await expect(
        migrator.getPersistedDiagnostics(user1, targetDb as unknown as LaxmiLensDB)
      ).rejects.toThrow(DiagnosticIntegrityError);

      // Stored record must NOT be deleted or overwritten
      const stored = targetDb.metadataStorage.get(`legacy_migration_diagnostics_${user1}`);
      expect(stored).toBeDefined();
      expect(stored!.value).toBe(malformedJson);
    });

    it('56. Mismatched user ID in diagnostics record throws DiagnosticIntegrityError', async () => {
      const migrator = new LegacyDatabaseMigrator();
      const targetDb = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user1}`);
      targetDb.open();

      const mismatchedPayload = {
        userId: user2, // Mismatched user
        migrationMarker: `legacy_migration_${user1}`,
        conflicts: [],
        unresolvedCategoryReferences: []
      };

      targetDb.metadataStorage.set(`legacy_migration_diagnostics_${user1}`, {
        key: `legacy_migration_diagnostics_${user1}`,
        value: JSON.stringify(mismatchedPayload),
        updatedAt: '2026-02-01T00:00:00.000Z'
      });

      await expect(
        migrator.getPersistedDiagnostics(user1, targetDb as unknown as LaxmiLensDB)
      ).rejects.toThrow(/Mismatched userId in diagnostics record/);
    });

    it('57. Mismatched migration marker reference in diagnostics throws DiagnosticIntegrityError', async () => {
      const migrator = new LegacyDatabaseMigrator();
      const targetDb = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user1}`);
      targetDb.open();

      const mismatchedPayload = {
        userId: user1,
        migrationMarker: 'legacy_migration_wrong_reference', // Mismatched marker reference
        conflicts: [],
        unresolvedCategoryReferences: []
      };

      targetDb.metadataStorage.set(`legacy_migration_diagnostics_${user1}`, {
        key: `legacy_migration_diagnostics_${user1}`,
        value: JSON.stringify(mismatchedPayload),
        updatedAt: '2026-02-01T00:00:00.000Z'
      });

      await expect(
        migrator.getPersistedDiagnostics(user1, targetDb as unknown as LaxmiLensDB)
      ).rejects.toThrow(/Mismatched migrationMarker reference in diagnostics record/);
    });

    it('58. Diagnostics persistence failure aborts transaction and does not write completion marker', async () => {
      legacyMockDb.categoriesStorage.set('lu-ambiguous-fail', {
        id: 'lu-ambiguous-fail',
        userId: SENTINEL_LOCAL_USER,
        name: 'Ambiguous Fail Cat',
        type: 'expense',
        isDefault: false,
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      const failingTargetDb = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user1}`);
      failingTargetDb.open();

      // Simulate failure on syncMetadata put when diagnostics key is written
      const origPut = failingTargetDb.syncMetadata.put.bind(failingTargetDb.syncMetadata);
      failingTargetDb.syncMetadata.put = vi.fn(async (record: LocalSyncMetadataRecord) => {
        if (record.key.startsWith('legacy_migration_diagnostics_')) {
          throw new Error('Disk error during diagnostic record write');
        }
        return origPut(record);
      });

      const migrator = new LegacyDatabaseMigrator();
      await expect(
        migrator.migrate(
          user1,
          failingTargetDb as unknown as LaxmiLensDB,
          legacyMockDb as unknown as LaxmiLensDB
        )
      ).rejects.toThrow(/Disk error during diagnostic record write/);

      // Completion marker MUST NOT be written
      expect(failingTargetDb.metadataStorage.get(`legacy_migration_${user1}`)).toBeUndefined();
    });

    it('59. Completion marker is not written if diagnostic verification fails', async () => {
      legacyMockDb.categoriesStorage.set('lu-ambiguous-verify-fail', {
        id: 'lu-ambiguous-verify-fail',
        userId: SENTINEL_LOCAL_USER,
        name: 'Verify Fail Cat',
        type: 'expense',
        isDefault: false,
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      const verifyFailTargetDb = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user1}`);
      verifyFailTargetDb.open();

      // Simulate corruption where get returns corrupt data on verification
      verifyFailTargetDb.syncMetadata.get = vi.fn(async (key: string) => {
        if (key.startsWith('legacy_migration_diagnostics_')) {
          return { key, value: 'corrupted_value_not_matching', updatedAt: '2026-01-01' };
        }
        return verifyFailTargetDb.metadataStorage.get(key) || null;
      });

      const migrator = new LegacyDatabaseMigrator();
      await expect(
        migrator.migrate(
          user1,
          verifyFailTargetDb as unknown as LaxmiLensDB,
          legacyMockDb as unknown as LaxmiLensDB
        )
      ).rejects.toThrow(DiagnosticIntegrityError);

      // Completion marker MUST NOT be written
      expect(verifyFailTargetDb.metadataStorage.get(`legacy_migration_${user1}`)).toBeUndefined();
    });

    it('60. Previously persisted diagnostics are preserved across subsequent runs and migration halts on corruption', async () => {
      const migrator = new LegacyDatabaseMigrator();
      const targetDb = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user1}`);
      targetDb.open();

      // Simulate a previously completed migration with marker
      targetDb.metadataStorage.set(`legacy_migration_${user1}`, {
        key: `legacy_migration_${user1}`,
        value: 'completed_with_quarantined_conflicts',
        updatedAt: '2026-02-01T00:00:00.000Z'
      });

      // Valid diagnostics exist
      const validPayload = {
        userId: user1,
        migrationMarker: `legacy_migration_${user1}`,
        conflicts: [
          {
            entity: 'categories',
            entityId: 'cat-preserved-1',
            name: 'Preserved Hobby',
            ownerValue: SENTINEL_LOCAL_USER,
            reason: 'Sentinel owner custom category'
          }
        ],
        unresolvedCategoryReferences: [],
        recordedAt: '2026-02-01T00:00:00.000Z'
      };

      targetDb.metadataStorage.set(`legacy_migration_diagnostics_${user1}`, {
        key: `legacy_migration_diagnostics_${user1}`,
        value: JSON.stringify(validPayload),
        updatedAt: '2026-02-01T00:00:00.000Z'
      });

      const result = await migrator.migrate(
        user1,
        targetDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      expect(result.isComplete).toBe(true);
      expect(result.conflicts.length).toBe(1);
      expect(result.conflicts[0].entityId).toBe('cat-preserved-1');

      // Now corrupt the diagnostics payload and test that migration detects it and fails closed
      targetDb.metadataStorage.set(`legacy_migration_diagnostics_${user1}`, {
        key: `legacy_migration_diagnostics_${user1}`,
        value: '{ corrupted json',
        updatedAt: '2026-02-01T00:00:00.000Z'
      });

      const corruptResult = await migrator.migrate(
        user1,
        targetDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      expect(corruptResult.isComplete).toBe(false);
      expect(corruptResult.errors.length).toBeGreaterThan(0);
      expect(corruptResult.errors[0]).toContain('Malformed diagnostics JSON');
      // Corrupt payload remains preserved on disk
      expect(targetDb.metadataStorage.get(`legacy_migration_diagnostics_${user1}`)!.value).toBe('{ corrupted json');
    });

    it('61. Conflict completion marker with missing diagnostics fails closed', async () => {
      const migrator = new LegacyDatabaseMigrator();
      const targetDb = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user1}`);
      targetDb.open();

      // Marker is completed_with_quarantined_conflicts
      targetDb.metadataStorage.set(`legacy_migration_${user1}`, {
        key: `legacy_migration_${user1}`,
        value: 'completed_with_quarantined_conflicts',
        updatedAt: '2026-02-01T00:00:00.000Z'
      });

      // No diagnostics record is stored
      expect(targetDb.metadataStorage.get(`legacy_migration_diagnostics_${user1}`)).toBeUndefined();

      const result = await migrator.migrate(
        user1,
        targetDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      // Must fail closed and not return an empty successful summary
      expect(result.isComplete).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Diagnostic integrity failure');
      expect(result.errors[0]).toContain("Migration marker indicates 'completed_with_quarantined_conflicts'");
      expect(result.errors[0]).toContain('diagnostics record is missing');
    });

    it('62. Clean completion marker without diagnostics succeeds', async () => {
      const migrator = new LegacyDatabaseMigrator();
      const targetDb = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user1}`);
      targetDb.open();

      // Marker is clean completed
      targetDb.metadataStorage.set(`legacy_migration_${user1}`, {
        key: `legacy_migration_${user1}`,
        value: 'completed',
        updatedAt: '2026-02-01T00:00:00.000Z'
      });

      // No diagnostics record is stored
      expect(targetDb.metadataStorage.get(`legacy_migration_diagnostics_${user1}`)).toBeUndefined();

      const result = await migrator.migrate(
        user1,
        targetDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      // Must cleanly succeed with no conflicts or errors
      expect(result.isComplete).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.conflicts.length).toBe(0);
      expect(result.unresolvedCategoryReferences.length).toBe(0);
    });

    it('63. Diagnostics and marker writes roll back together on failure', async () => {
      legacyMockDb.categoriesStorage.set('lu-rollback-test-cat', {
        id: 'lu-rollback-test-cat',
        userId: SENTINEL_LOCAL_USER,
        name: 'Rollback Ambiguous Category',
        type: 'expense',
        isDefault: false,
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      const failingTargetDb = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user1}`);
      failingTargetDb.open();

      // Simulate failure at the marker write stage (after diagnostics record is written & verified)
      const origPut = failingTargetDb.syncMetadata.put.bind(failingTargetDb.syncMetadata);
      failingTargetDb.syncMetadata.put = vi.fn(async (record: LocalSyncMetadataRecord) => {
        if (record.key === `legacy_migration_${user1}`) {
          throw new Error('Disk failure during completion marker write');
        }
        return origPut(record);
      });

      const migrator = new LegacyDatabaseMigrator();

      await expect(
        migrator.migrate(
          user1,
          failingTargetDb as unknown as LaxmiLensDB,
          legacyMockDb as unknown as LaxmiLensDB
        )
      ).rejects.toThrow(/Disk failure during completion marker write/);

      // Verify that NEITHER the completion marker NOR the diagnostics record was committed
      expect(failingTargetDb.metadataStorage.get(`legacy_migration_${user1}`)).toBeUndefined();
      expect(
        failingTargetDb.metadataStorage.get(`legacy_migration_diagnostics_${user1}`)
      ).toBeUndefined();
      // Verify that any category write was also rolled back
      expect(failingTargetDb.categoriesStorage.get('lu-rollback-test-cat')).toBeUndefined();
    });

    it('64. Existing corrupted diagnostics remain unchanged on inspection failure', async () => {
      const migrator = new LegacyDatabaseMigrator();
      const targetDb = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user1}`);
      targetDb.open();

      targetDb.metadataStorage.set(`legacy_migration_${user1}`, {
        key: `legacy_migration_${user1}`,
        value: 'completed_with_quarantined_conflicts',
        updatedAt: '2026-02-01T00:00:00.000Z'
      });

      const corruptContent = '{"corrupted": true, syntax_error:';
      targetDb.metadataStorage.set(`legacy_migration_diagnostics_${user1}`, {
        key: `legacy_migration_diagnostics_${user1}`,
        value: corruptContent,
        updatedAt: '2026-02-01T00:00:00.000Z'
      });

      const result = await migrator.migrate(
        user1,
        targetDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      expect(result.isComplete).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Malformed diagnostics JSON');

      // Stored record must remain completely unchanged
      const preserved = targetDb.metadataStorage.get(`legacy_migration_diagnostics_${user1}`);
      expect(preserved).toBeDefined();
      expect(preserved!.value).toBe(corruptContent);
    });

    it('65. completed_no_legacy_db completion marker cleanly returns completed', async () => {
      const migrator = new LegacyDatabaseMigrator();
      const targetDb = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user1}`);
      targetDb.open();

      targetDb.metadataStorage.set(`legacy_migration_${user1}`, {
        key: `legacy_migration_${user1}`,
        value: 'completed_no_legacy_db',
        updatedAt: '2026-02-01T00:00:00.000Z'
      });

      const result = await migrator.migrate(
        user1,
        targetDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      expect(result.isComplete).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.conflicts.length).toBe(0);
      expect(result.unresolvedCategoryReferences.length).toBe(0);
    });

    it('66. Unknown marker value such as completed_unknown fails closed', async () => {
      const migrator = new LegacyDatabaseMigrator();
      const targetDb = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user1}`);
      targetDb.open();

      targetDb.metadataStorage.set(`legacy_migration_${user1}`, {
        key: `legacy_migration_${user1}`,
        value: 'completed_unknown',
        updatedAt: '2026-02-01T00:00:00.000Z'
      });

      const result = await migrator.migrate(
        user1,
        targetDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      // Must fail closed with error identifying unexpected marker
      expect(result.isComplete).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Diagnostic integrity failure');
      expect(result.errors[0]).toContain("Unexpected migration marker value 'completed_unknown'");

      // Marker must not be overwritten or deleted
      const storedMarker = targetDb.metadataStorage.get(`legacy_migration_${user1}`);
      expect(storedMarker).toBeDefined();
      expect(storedMarker!.value).toBe('completed_unknown');
    });

    it('67. Empty or whitespace marker value fails closed', async () => {
      const migrator = new LegacyDatabaseMigrator();
      const targetDb = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user1}`);
      targetDb.open();

      targetDb.metadataStorage.set(`legacy_migration_${user1}`, {
        key: `legacy_migration_${user1}`,
        value: '   ',
        updatedAt: '2026-02-01T00:00:00.000Z'
      });

      const result = await migrator.migrate(
        user1,
        targetDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      expect(result.isComplete).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Diagnostic integrity failure');
      expect(result.errors[0]).toContain('Malformed migration marker record');
      expect(result.errors[0]).toContain('empty string');

      // Marker remains stored without deletion or overwrite
      expect(targetDb.metadataStorage.get(`legacy_migration_${user1}`)!.value).toBe('   ');
    });

    it('68. Non-string marker value fails closed', async () => {
      const migrator = new LegacyDatabaseMigrator();
      const targetDb = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user1}`);
      targetDb.open();

      targetDb.metadataStorage.set(`legacy_migration_${user1}`, {
        key: `legacy_migration_${user1}`,
        value: 12345 as unknown as string,
        updatedAt: '2026-02-01T00:00:00.000Z'
      });

      const result = await migrator.migrate(
        user1,
        targetDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      expect(result.isComplete).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Diagnostic integrity failure');
      expect(result.errors[0]).toContain('Malformed migration marker record');
      expect(result.errors[0]).toContain('number');

      // Marker remains stored
      expect(targetDb.metadataStorage.get(`legacy_migration_${user1}`)!.value).toBe(12345 as unknown as string);
    });

    it('69. Existing diagnostics remain unchanged after invalid-marker detection', async () => {
      const migrator = new LegacyDatabaseMigrator();
      const targetDb = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user1}`);
      targetDb.open();

      targetDb.metadataStorage.set(`legacy_migration_${user1}`, {
        key: `legacy_migration_${user1}`,
        value: 'completed_corrupt_variant',
        updatedAt: '2026-02-01T00:00:00.000Z'
      });

      const validDiagPayload = JSON.stringify({
        userId: user1,
        migrationMarker: `legacy_migration_${user1}`,
        conflicts: [],
        unresolvedCategoryReferences: []
      });

      targetDb.metadataStorage.set(`legacy_migration_diagnostics_${user1}`, {
        key: `legacy_migration_diagnostics_${user1}`,
        value: validDiagPayload,
        updatedAt: '2026-02-01T00:00:00.000Z'
      });

      const result = await migrator.migrate(
        user1,
        targetDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      expect(result.isComplete).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("Unexpected migration marker value 'completed_corrupt_variant'");

      // Diagnostics must remain completely unchanged
      const diagRecord = targetDb.metadataStorage.get(`legacy_migration_diagnostics_${user1}`);
      expect(diagRecord).toBeDefined();
      expect(diagRecord!.value).toBe(validDiagPayload);

      // Marker must remain unchanged
      expect(targetDb.metadataStorage.get(`legacy_migration_${user1}`)!.value).toBe('completed_corrupt_variant');
    });

    it('70. Legacy database inspection is not started after invalid-marker detection', async () => {
      const existenceCheckerSpy = vi.fn(async () => true);
      const migrator = new LegacyDatabaseMigrator(
        () => legacyMockDb as unknown as any,
        existenceCheckerSpy
      );
      const targetDb = new MockLaxmiLensDB(`LaxmiLens_LocalDB_${user1}`);
      targetDb.open();

      targetDb.metadataStorage.set(`legacy_migration_${user1}`, {
        key: `legacy_migration_${user1}`,
        value: 'completed_unrecognized',
        updatedAt: '2026-02-01T00:00:00.000Z'
      });

      const openSpy = vi.spyOn(legacyMockDb, 'open');

      const result = await migrator.migrate(
        user1,
        targetDb as unknown as LaxmiLensDB,
        legacyMockDb as unknown as LaxmiLensDB
      );

      expect(result.isComplete).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("Unexpected migration marker value 'completed_unrecognized'");

      // Legacy database existenceChecker and open must NEVER be called
      expect(existenceCheckerSpy).not.toHaveBeenCalled();
      expect(openSpy).not.toHaveBeenCalled();
    });
  });
});

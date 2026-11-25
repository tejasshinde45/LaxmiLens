import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ManualSyncCoordinator,
  UnifiedSyncResult
} from '@/infrastructure/sync/ManualSyncCoordinator';
import { AccountSyncDispatcher } from '@/infrastructure/sync/dispatchers/AccountSyncDispatcher';
import { TransactionSyncDispatcher } from '@/infrastructure/sync/dispatchers/TransactionSyncDispatcher';
import { CategorySyncDispatcher } from '@/infrastructure/sync/dispatchers/CategorySyncDispatcher';
import { LenderSyncDispatcher } from '@/infrastructure/sync/dispatchers/LenderSyncDispatcher';
import { BorrowingSyncDispatcher } from '@/infrastructure/sync/dispatchers/BorrowingSyncDispatcher';
import { BorrowingRepaymentSyncDispatcher } from '@/infrastructure/sync/dispatchers/BorrowingRepaymentSyncDispatcher';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { AuthPort } from '@/application/ports/AuthPort';
import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';

describe('ManualSyncCoordinator — Personal Borrowings 6-Stage Execution & Dependency Isolation', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const accountId = '22222222-2222-4222-8222-222222222222';
  const categoryId = '33333333-3333-4333-8333-333333333333';
  const transactionId = '44444444-4444-4444-8444-444444444444';
  const lenderId = '55555555-5555-4555-8555-555555555555';
  const borrowingId = '66666666-6666-4666-8666-666666666666';
  const repaymentId = '77777777-7777-4777-8777-777777777777';

  let mockAccountDispatcher: AccountSyncDispatcher;
  let mockCategoryDispatcher: CategorySyncDispatcher;
  let mockTransactionDispatcher: TransactionSyncDispatcher;
  let mockLenderDispatcher: LenderSyncDispatcher;
  let mockBorrowingDispatcher: BorrowingSyncDispatcher;
  let mockRepaymentDispatcher: BorrowingRepaymentSyncDispatcher;
  let mockOutboxManager: OutboxManager;
  let mockAuthPort: AuthPort;
  let coordinator: ManualSyncCoordinator;

  let outboxEntries: LocalOutboxRecord[];
  let executionOrder: string[];

  beforeEach(() => {
    outboxEntries = [];
    executionOrder = [];

    mockAccountDispatcher = {
      dispatch: vi.fn().mockImplementation(async (entry: LocalOutboxRecord) => {
        executionOrder.push(`account:${entry.entityId}`);
        await mockOutboxManager.markSuccess(entry.id!);
      })
    } as unknown as AccountSyncDispatcher;

    mockCategoryDispatcher = {
      dispatch: vi.fn().mockImplementation(async (entry: LocalOutboxRecord) => {
        executionOrder.push(`category:${entry.entityId}`);
        await mockOutboxManager.markSuccess(entry.id!);
      })
    } as unknown as CategorySyncDispatcher;

    mockTransactionDispatcher = {
      dispatch: vi.fn().mockImplementation(async (entry: LocalOutboxRecord) => {
        executionOrder.push(`transaction:${entry.entityId}`);
        await mockOutboxManager.markSuccess(entry.id!);
      })
    } as unknown as TransactionSyncDispatcher;

    mockLenderDispatcher = {
      dispatch: vi.fn().mockImplementation(async (entry: LocalOutboxRecord) => {
        executionOrder.push(`lender:${entry.entityId}`);
        await mockOutboxManager.markSuccess(entry.id!);
      })
    } as unknown as LenderSyncDispatcher;

    mockBorrowingDispatcher = {
      dispatch: vi.fn().mockImplementation(async (entry: LocalOutboxRecord) => {
        executionOrder.push(`borrowing:${entry.entityId}`);
        await mockOutboxManager.markSuccess(entry.id!);
      })
    } as unknown as BorrowingSyncDispatcher;

    mockRepaymentDispatcher = {
      dispatch: vi.fn().mockImplementation(async (entry: LocalOutboxRecord) => {
        executionOrder.push(`repayment:${entry.entityId}`);
        await mockOutboxManager.markSuccess(entry.id!);
      })
    } as unknown as BorrowingRepaymentSyncDispatcher;

    mockOutboxManager = {
      getPendingEntries: vi.fn().mockImplementation(async () => [...outboxEntries]),
      getPendingCount: vi.fn().mockImplementation(async () => outboxEntries.length),
      markSuccess: vi.fn().mockImplementation(async (id: number) => {
        outboxEntries = outboxEntries.filter((e) => e.id !== id);
      }),
      markFailure: vi.fn().mockImplementation(async (id: number, error: string) => {
        const item = outboxEntries.find((e) => e.id === id);
        if (item) {
          item.attempts += 1;
          item.lastError = error;
        }
      })
    } as unknown as OutboxManager;

    mockAuthPort = {
      getCurrentUser: vi.fn().mockResolvedValue({ id: userId, email: 'user@example.com' }),
      getSession: vi.fn(),
      signInWithPassword: vi.fn(),
      signUpWithPassword: vi.fn(),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updatePassword: vi.fn(),
      onAuthStateChange: vi.fn().mockReturnValue(() => {})
    };

    coordinator = new ManualSyncCoordinator(
      mockAccountDispatcher,
      mockTransactionDispatcher,
      mockOutboxManager,
      mockAuthPort,
      mockCategoryDispatcher,
      mockLenderDispatcher,
      mockBorrowingDispatcher,
      mockRepaymentDispatcher
    );
  });

  it('enforces strict 6-stage order: Accounts -> Categories -> Transactions -> Lenders -> Borrowings -> Repayments', async () => {
    // Intentionally enqueue out of order
    outboxEntries = [
      {
        id: 1,
        userId,
        entity: 'borrowing_repayments',
        entityId: repaymentId,
        operation: 'INSERT',
        payload: {
          borrowing_id: borrowingId,
          lender_id: lenderId,
          payment_account_id: accountId,
          transaction_id: transactionId
        },
        idempotencyKey: 'k-rep',
        attempts: 0,
        createdAt: '2026-03-01T10:00:00Z'
      },
      {
        id: 2,
        userId,
        entity: 'borrowings',
        entityId: borrowingId,
        operation: 'INSERT',
        payload: {
          lender_id: lenderId,
          receiving_account_id: accountId,
          transaction_id: transactionId
        },
        idempotencyKey: 'k-bor',
        attempts: 0,
        createdAt: '2026-03-01T10:00:00Z'
      },
      {
        id: 3,
        userId,
        entity: 'lenders',
        entityId: lenderId,
        operation: 'INSERT',
        payload: { name: 'Rahul' },
        idempotencyKey: 'k-len',
        attempts: 0,
        createdAt: '2026-03-01T10:00:00Z'
      },
      {
        id: 4,
        userId,
        entity: 'transactions',
        entityId: transactionId,
        operation: 'INSERT',
        payload: { account_id: accountId },
        idempotencyKey: 'k-tx',
        attempts: 0,
        createdAt: '2026-03-01T10:00:00Z'
      },
      {
        id: 5,
        userId,
        entity: 'categories',
        entityId: categoryId,
        operation: 'INSERT',
        payload: { name: 'Loans' },
        idempotencyKey: 'k-cat',
        attempts: 0,
        createdAt: '2026-03-01T10:00:00Z'
      },
      {
        id: 6,
        userId,
        entity: 'accounts',
        entityId: accountId,
        operation: 'INSERT',
        payload: { name: 'Main Bank' },
        idempotencyKey: 'k-acc',
        attempts: 0,
        createdAt: '2026-03-01T10:00:00Z'
      }
    ];

    const result = await coordinator.run();

    expect(result.syncedCount).toBe(6);
    expect(result.failedCount).toBe(0);
    expect(executionOrder).toEqual([
      `account:${accountId}`,
      `category:${categoryId}`,
      `transaction:${transactionId}`,
      `lender:${lenderId}`,
      `borrowing:${borrowingId}`,
      `repayment:${repaymentId}`
    ]);
  });

  it('safely blocks borrowing and repayment if lender fails sync without deleting them from outbox', async () => {
    (mockLenderDispatcher.dispatch as any).mockRejectedValueOnce(
      new Error('Cloud connection failed during lender sync')
    );

    outboxEntries = [
      {
        id: 1,
        userId,
        entity: 'lenders',
        entityId: lenderId,
        operation: 'INSERT',
        payload: { name: 'Rahul' },
        idempotencyKey: 'k-len',
        attempts: 0,
        createdAt: '2026-03-01T10:00:00Z'
      },
      {
        id: 2,
        userId,
        entity: 'borrowings',
        entityId: borrowingId,
        operation: 'INSERT',
        payload: {
          lender_id: lenderId,
          receiving_account_id: accountId,
          transaction_id: transactionId
        },
        idempotencyKey: 'k-bor',
        attempts: 0,
        createdAt: '2026-03-01T10:00:00Z'
      },
      {
        id: 3,
        userId,
        entity: 'borrowing_repayments',
        entityId: repaymentId,
        operation: 'INSERT',
        payload: {
          borrowing_id: borrowingId,
          lender_id: lenderId,
          payment_account_id: accountId,
          transaction_id: transactionId
        },
        idempotencyKey: 'k-rep',
        attempts: 0,
        createdAt: '2026-03-01T10:00:00Z'
      }
    ];

    const result = await coordinator.run();

    // Lender failed, so borrowing and repayment were blocked by dependency
    expect(result.syncedCount).toBe(0);
    expect(result.failedCount).toBe(3);
    expect(result.lenders.failedCount).toBe(1);
    expect(result.borrowings.failedCount).toBe(1);
    expect(result.borrowings.dependencyBlockedCount).toBe(1);
    expect(result.borrowing_repayments.failedCount).toBe(1);
    expect(result.borrowing_repayments.dependencyBlockedCount).toBe(1);

    // Dispatcher was never called for dependent borrowing or repayment
    expect(mockBorrowingDispatcher.dispatch).not.toHaveBeenCalled();
    expect(mockRepaymentDispatcher.dispatch).not.toHaveBeenCalled();

    // All 3 entries remain in outbox
    expect(outboxEntries.length).toBe(3);
  });

  it('safely blocks borrowing and repayment if transfer transaction fails sync', async () => {
    (mockTransactionDispatcher.dispatch as any).mockRejectedValueOnce(
      new Error('Transaction validation failed')
    );

    outboxEntries = [
      {
        id: 1,
        userId,
        entity: 'transactions',
        entityId: transactionId,
        operation: 'INSERT',
        payload: { account_id: accountId },
        idempotencyKey: 'k-tx',
        attempts: 0,
        createdAt: '2026-03-01T10:00:00Z'
      },
      {
        id: 2,
        userId,
        entity: 'lenders',
        entityId: lenderId,
        operation: 'INSERT',
        payload: { name: 'Rahul' },
        idempotencyKey: 'k-len',
        attempts: 0,
        createdAt: '2026-03-01T10:00:00Z'
      },
      {
        id: 3,
        userId,
        entity: 'borrowings',
        entityId: borrowingId,
        operation: 'INSERT',
        payload: {
          lender_id: lenderId,
          receiving_account_id: accountId,
          transaction_id: transactionId
        },
        idempotencyKey: 'k-bor',
        attempts: 0,
        createdAt: '2026-03-01T10:00:00Z'
      }
    ];

    const result = await coordinator.run();

    expect(result.transactions.failedCount).toBe(1);
    expect(result.lenders.syncedCount).toBe(1); // Independent lender succeeds!
    expect(result.borrowings.dependencyBlockedCount).toBe(1); // Borrowing blocked due to transaction failure
    expect(mockBorrowingDispatcher.dispatch).not.toHaveBeenCalled();
    expect(outboxEntries.some((e) => e.entityId === borrowingId)).toBe(true);
  });

  it('safely blocks repayment if borrowing fails sync', async () => {
    (mockBorrowingDispatcher.dispatch as any).mockRejectedValueOnce(
      new Error('Borrowing insert failed')
    );

    outboxEntries = [
      {
        id: 1,
        userId,
        entity: 'lenders',
        entityId: lenderId,
        operation: 'INSERT',
        payload: { name: 'Rahul' },
        idempotencyKey: 'k-len',
        attempts: 0,
        createdAt: '2026-03-01T10:00:00Z'
      },
      {
        id: 2,
        userId,
        entity: 'borrowings',
        entityId: borrowingId,
        operation: 'INSERT',
        payload: {
          lender_id: lenderId,
          receiving_account_id: accountId,
          transaction_id: transactionId
        },
        idempotencyKey: 'k-bor',
        attempts: 0,
        createdAt: '2026-03-01T10:00:00Z'
      },
      {
        id: 3,
        userId,
        entity: 'borrowing_repayments',
        entityId: repaymentId,
        operation: 'INSERT',
        payload: {
          borrowing_id: borrowingId,
          lender_id: lenderId,
          payment_account_id: accountId,
          transaction_id: transactionId
        },
        idempotencyKey: 'k-rep',
        attempts: 0,
        createdAt: '2026-03-01T10:00:00Z'
      }
    ];

    const result = await coordinator.run();

    expect(result.lenders.syncedCount).toBe(1);
    expect(result.borrowings.failedCount).toBe(1);
    expect(result.borrowing_repayments.dependencyBlockedCount).toBe(1);
    expect(mockRepaymentDispatcher.dispatch).not.toHaveBeenCalled();
    expect(outboxEntries.some((e) => e.entityId === repaymentId)).toBe(true);
  });

  it('dispatches borrowing UPDATES in Stage 7 (after Stage 6 repayments) to guarantee cloud settlement precedence and prevent error 22000', async () => {
    outboxEntries = [
      {
        id: 1,
        userId,
        entity: 'borrowings',
        entityId: borrowingId,
        operation: 'UPDATE',
        payload: {
          id: borrowingId,
          user_id: userId,
          status: 'repaid'
        },
        idempotencyKey: 'k-bor-upd',
        attempts: 0,
        createdAt: '2026-03-01T10:02:00Z'
      },
      {
        id: 2,
        userId,
        entity: 'borrowing_repayments',
        entityId: repaymentId,
        operation: 'INSERT',
        payload: {
          borrowing_id: borrowingId,
          lender_id: lenderId,
          payment_account_id: accountId,
          transaction_id: transactionId
        },
        idempotencyKey: 'k-rep',
        attempts: 0,
        createdAt: '2026-03-01T10:01:00Z'
      },
      {
        id: 3,
        userId,
        entity: 'borrowings',
        entityId: borrowingId,
        operation: 'INSERT',
        payload: {
          lender_id: lenderId,
          receiving_account_id: accountId,
          transaction_id: transactionId
        },
        idempotencyKey: 'k-bor-ins',
        attempts: 0,
        createdAt: '2026-03-01T10:00:00Z'
      }
    ];

    const result = await coordinator.run();

    expect(result.syncedCount).toBe(3);
    expect(result.failedCount).toBe(0);
    // Crucial guarantee: Borrowing INSERT runs first (satisfying FK for repayment),
    // then Repayment INSERT runs (settling cloud principal),
    // and only THEN Borrowing UPDATE runs in Stage 7!
    expect(executionOrder).toEqual([
      `borrowing:${borrowingId}`,
      `repayment:${repaymentId}`,
      `borrowing:${borrowingId}`
    ]);
  });
});

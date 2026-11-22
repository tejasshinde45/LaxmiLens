import { describe, it, expect } from 'vitest';
import { TransactionMapper, CloudTransactionRow } from '@/infrastructure/database/cloud/mappers/TransactionMapper';
import { Transaction } from '@/domain/entities/Transaction';
import {
  createTransactionId,
  createAccountId,
  createCategoryId,
  createUserId
} from '@/domain/value-objects/Identifiers';
import {
  InvalidMoneyError,
  InvalidUserIdError,
  TransferAccountMismatchError
} from '@/domain/errors/DomainErrors';

describe('TransactionMapper (PostgreSQL Canonical Contract)', () => {
  const validTxId = '11111111-1111-4111-8111-111111111111';
  const validUserId = '22222222-2222-4222-8222-222222222222';
  const validSourceAccId = '33333333-3333-4333-8333-333333333333';
  const validDestAccId = '44444444-4444-4444-8444-444444444444';
  const validCategoryId = '55555555-5555-4555-8555-555555555555';
  const validDateIso = '2026-11-21T10:00:00.000Z';

  describe('toDomain', () => {
    it('converts a canonical cloud expense row to domain Transaction entity', () => {
      const row: CloudTransactionRow = {
        id: validTxId,
        user_id: validUserId,
        type: 'expense',
        amount_paise: 25000,
        currency: 'INR',
        account_id: validSourceAccId,
        destination_account_id: null,
        category_id: validCategoryId,
        title: 'Lunch',
        note: 'Swiggy order',
        transaction_date: validDateIso,
        deleted_at: null,
        version: 1,
        device_id: 'dev-1',
        idempotency_key: 'idemp-1',
        created_at: validDateIso,
        updated_at: validDateIso
      };

      const entity = TransactionMapper.toDomain(row);
      expect(entity.id).toBe(validTxId);
      expect(entity.userId).toBe(validUserId);
      expect(entity.type).toBe('expense');
      expect(entity.amountPaise).toBe(25000);
      expect(entity.amount.rupees).toBe(250);
      expect(entity.accountId).toBe(validSourceAccId);
      expect(entity.destinationAccountId).toBeUndefined();
      expect(entity.categoryId).toBe(validCategoryId);
      expect(entity.title).toBe('Lunch');
      expect(entity.note).toBe('Swiggy order');
      expect(entity.isDeleted).toBe(false);
      expect(entity.version).toBe(1);
    });

    it('converts a canonical cloud transfer row to domain Transaction entity', () => {
      const row: CloudTransactionRow = {
        id: validTxId,
        user_id: validUserId,
        type: 'transfer',
        amount_paise: 100000,
        currency: 'INR',
        account_id: validSourceAccId,
        destination_account_id: validDestAccId,
        category_id: null,
        title: 'Transfer to Savings',
        note: null,
        transaction_date: validDateIso,
        deleted_at: null,
        version: 1,
        device_id: null,
        idempotency_key: 'idemp-2',
        created_at: validDateIso,
        updated_at: validDateIso
      };

      const entity = TransactionMapper.toDomain(row);
      expect(entity.isTransfer()).toBe(true);
      expect(entity.destinationAccountId).toBe(validDestAccId);
      expect(entity.categoryId).toBeUndefined();
    });

    it('rejects non-integer, zero, or negative amounts from cloud', () => {
      const row: CloudTransactionRow = {
        id: validTxId,
        user_id: validUserId,
        type: 'expense',
        amount_paise: -500,
        currency: 'INR',
        account_id: validSourceAccId,
        destination_account_id: null,
        category_id: null,
        title: 'Invalid',
        note: null,
        transaction_date: validDateIso,
        deleted_at: null,
        version: 1,
        device_id: null,
        idempotency_key: 'idemp-inv'
      };

      expect(() => TransactionMapper.toDomain(row)).toThrow(InvalidMoneyError);
      expect(() => TransactionMapper.toDomain({ ...row, amount_paise: 0 })).toThrow(InvalidMoneyError);
      expect(() => TransactionMapper.toDomain({ ...row, amount_paise: 12.5 })).toThrow(InvalidMoneyError);
    });
  });

  describe('toCloud', () => {
    it('serializes domain Transaction to canonical CloudTransactionRow without legacy columns', () => {
      const tx = new Transaction({
        id: createTransactionId(validTxId),
        userId: createUserId(validUserId),
        type: 'expense',
        amountPaise: 49900,
        currency: 'INR',
        accountId: createAccountId(validSourceAccId),
        categoryId: createCategoryId(validCategoryId),
        title: 'Groceries',
        note: 'Supermarket',
        transactionDate: new Date(validDateIso),
        idempotencyKey: 'idemp-groceries',
        version: 1,
        status: 'cleared'
      });

      const cloud = TransactionMapper.toCloud(tx);

      // Verify canonical column presence
      expect(cloud.id).toBe(validTxId);
      expect(cloud.user_id).toBe(validUserId);
      expect(cloud.type).toBe('expense');
      expect(cloud.amount_paise).toBe(49900);
      expect(cloud.currency).toBe('INR');
      expect(cloud.account_id).toBe(validSourceAccId);
      expect(cloud.destination_account_id).toBeNull();
      expect(cloud.category_id).toBe(validCategoryId);
      expect(cloud.title).toBe('Groceries');
      expect(cloud.note).toBe('Supermarket');
      expect(cloud.deleted_at).toBeNull();
      expect(cloud.version).toBe(1);

      // Verify absence of legacy/local-only fields
      const raw = cloud as Record<string, unknown>;
      expect(raw.target_account_id).toBeUndefined();
      expect(raw.targetAccountId).toBeUndefined();
      expect(raw.description).toBeUndefined();
      expect(raw.notes).toBeUndefined();
      expect(raw.date).toBeUndefined();
      expect(raw.amount_in_paise).toBeUndefined();
      expect(raw.amountInPaise).toBeUndefined();
      expect(raw.is_deleted).toBeUndefined();
      expect(raw.isDeleted).toBeUndefined();
      expect(raw.status).toBeUndefined();
    });
  });

  describe('mapCreatePayload', () => {
    it('maps valid expense insert payload correctly', () => {
      const payload = {
        id: validTxId,
        user_id: validUserId,
        type: 'expense',
        amount_paise: 50000,
        currency: 'INR',
        account_id: validSourceAccId,
        category_id: validCategoryId,
        title: 'Office Supplies',
        note: 'Printer ink',
        transaction_date: validDateIso,
        idempotency_key: 'key-1'
      };

      const row = TransactionMapper.mapCreatePayload(payload);
      expect(row.id).toBe(validTxId);
      expect(row.user_id).toBe(validUserId);
      expect(row.amount_paise).toBe(50000);
      expect(row.destination_account_id).toBeNull();
      expect(row.deleted_at).toBeNull();
      expect(row.version).toBe(1);
    });

    it('maps valid transfer insert payload and enforces destination account', () => {
      const payload = {
        id: validTxId,
        user_id: validUserId,
        type: 'transfer',
        amount_paise: 150000,
        currency: 'INR',
        account_id: validSourceAccId,
        destination_account_id: validDestAccId,
        title: 'Funds Transfer',
        transaction_date: validDateIso,
        idempotency_key: 'key-transfer'
      };

      const row = TransactionMapper.mapCreatePayload(payload);
      expect(row.type).toBe('transfer');
      expect(row.destination_account_id).toBe(validDestAccId);
      expect(row.category_id).toBeNull();
    });

    it('rejects transfer with missing destination account', () => {
      const payload = {
        id: validTxId,
        user_id: validUserId,
        type: 'transfer',
        amount_paise: 150000,
        account_id: validSourceAccId,
        title: 'Funds Transfer',
        transaction_date: validDateIso,
        idempotency_key: 'key-transfer'
      };

      expect(() => TransactionMapper.mapCreatePayload(payload)).toThrow(TransferAccountMismatchError);
    });

    it('rejects transfer where source and destination accounts are identical', () => {
      const payload = {
        id: validTxId,
        user_id: validUserId,
        type: 'transfer',
        amount_paise: 150000,
        account_id: validSourceAccId,
        destination_account_id: validSourceAccId,
        title: 'Self Transfer',
        transaction_date: validDateIso,
        idempotency_key: 'key-self'
      };

      expect(() => TransactionMapper.mapCreatePayload(payload)).toThrow(TransferAccountMismatchError);
    });

    it('rejects non-transfer with destination account specified', () => {
      const payload = {
        id: validTxId,
        user_id: validUserId,
        type: 'expense',
        amount_paise: 10000,
        account_id: validSourceAccId,
        destination_account_id: validDestAccId,
        title: 'Invalid Destination',
        transaction_date: validDateIso,
        idempotency_key: 'key-inv'
      };

      expect(() => TransactionMapper.mapCreatePayload(payload)).toThrow(
        'Only transfer transactions may specify a destination account.'
      );
    });

    it('rejects invalid or non-UUID id', () => {
      const payload = {
        id: 'not-a-uuid',
        user_id: validUserId,
        type: 'expense',
        amount_paise: 1000,
        account_id: validSourceAccId,
        title: 'Bad ID',
        transaction_date: validDateIso,
        idempotency_key: 'key-bad-id'
      };

      expect(() => TransactionMapper.mapCreatePayload(payload)).toThrow("must be a valid UUID");
    });

    it('rejects invalid or non-UUID user_id', () => {
      const payload = {
        id: validTxId,
        user_id: 'bad-user',
        type: 'expense',
        amount_paise: 1000,
        account_id: validSourceAccId,
        title: 'Bad User',
        transaction_date: validDateIso,
        idempotency_key: 'key-bad-user'
      };

      expect(() => TransactionMapper.mapCreatePayload(payload)).toThrow(InvalidUserIdError);
    });

    it('rejects invalid category ID string rather than silently nullifying it (Category Safety)', () => {
      const payload = {
        id: validTxId,
        user_id: validUserId,
        type: 'expense',
        amount_paise: 1000,
        account_id: validSourceAccId,
        category_id: 'invalid-cat-uuid',
        title: 'Bad Category',
        transaction_date: validDateIso,
        idempotency_key: 'key-bad-cat'
      };

      expect(() => TransactionMapper.mapCreatePayload(payload)).toThrow(
        "Invalid category ID 'invalid-cat-uuid': must be a valid UUID."
      );
    });

    it('rejects empty title or title exceeding 255 characters', () => {
      const base = {
        id: validTxId,
        user_id: validUserId,
        type: 'expense',
        amount_paise: 1000,
        account_id: validSourceAccId,
        transaction_date: validDateIso,
        idempotency_key: 'key-title'
      };

      expect(() => TransactionMapper.mapCreatePayload({ ...base, title: '   ' })).toThrow('must not be empty');
      expect(() => TransactionMapper.mapCreatePayload({ ...base, title: 'a'.repeat(256) })).toThrow('exceeds maximum length of 255');
    });

    it('rejects non-positive safe integer amounts', () => {
      const base = {
        id: validTxId,
        user_id: validUserId,
        type: 'expense',
        account_id: validSourceAccId,
        title: 'Valid Title',
        transaction_date: validDateIso,
        idempotency_key: 'key-amt'
      };

      expect(() => TransactionMapper.mapCreatePayload({ ...base, amount_paise: 0 })).toThrow(InvalidMoneyError);
      expect(() => TransactionMapper.mapCreatePayload({ ...base, amount_paise: -100 })).toThrow(InvalidMoneyError);
      expect(() => TransactionMapper.mapCreatePayload({ ...base, amount_paise: 100.5 })).toThrow(InvalidMoneyError);
      expect(() => TransactionMapper.mapCreatePayload({ ...base, amount_paise: NaN })).toThrow(InvalidMoneyError);
    });
  });

  describe('mapUpdatePayload', () => {
    it('maps valid mutable fields and strips immutable fields', () => {
      const payload = {
        id: validTxId,
        user_id: validUserId,
        type: 'income',
        currency: 'USD',
        idempotency_key: 'key-imm',
        created_at: validDateIso,
        amount_paise: 75000,
        title: 'Updated Title',
        note: 'Updated Note',
        version: 2
      };

      const patch = TransactionMapper.mapUpdatePayload(payload);

      expect(patch.amount_paise).toBe(75000);
      expect(patch.title).toBe('Updated Title');
      expect(patch.note).toBe('Updated Note');
      expect(patch.version).toBe(2);
      expect(patch.updated_at).toBeDefined();

      // Verify immutable fields are strictly stripped
      const raw = patch as Record<string, unknown>;
      expect(raw.id).toBeUndefined();
      expect(raw.user_id).toBeUndefined();
      expect(raw.type).toBeUndefined();
      expect(raw.currency).toBeUndefined();
      expect(raw.idempotency_key).toBeUndefined();
      expect(raw.created_at).toBeUndefined();
    });

    it('rejects version less than 2 in update payload', () => {
      const payload = {
        title: 'New Title',
        version: 1
      };

      expect(() => TransactionMapper.mapUpdatePayload(payload)).toThrow("Invalid target version '1'");
    });

    it('strips legacy Dexie compatibility fields', () => {
      const payload = {
        title: 'Clean Patch',
        version: 2,
        description: 'old desc',
        notes: 'old notes',
        date: '2026-01-01',
        amountInPaise: 1000,
        status: 'pending',
        isDeleted: false
      };

      const patch = TransactionMapper.mapUpdatePayload(payload);
      const raw = patch as Record<string, unknown>;
      expect(raw.description).toBeUndefined();
      expect(raw.notes).toBeUndefined();
      expect(raw.date).toBeUndefined();
      expect(raw.amountInPaise).toBeUndefined();
      expect(raw.status).toBeUndefined();
      expect(raw.isDeleted).toBeUndefined();
    });
  });

  describe('mapSoftDeletePayload', () => {
    it('produces a minimal soft-delete patch with version increment and deleted_at', () => {
      const payload = {
        id: validTxId,
        deleted_at: validDateIso,
        version: 2
      };

      const patch = TransactionMapper.mapSoftDeletePayload(payload);
      expect(patch.deleted_at).toBe(validDateIso);
      expect(patch.version).toBe(2);
      expect(patch.updated_at).toBeDefined();
    });

    it('rejects soft-delete payload with version less than 2', () => {
      const payload = {
        id: validTxId,
        deleted_at: validDateIso,
        version: 1
      };

      expect(() => TransactionMapper.mapSoftDeletePayload(payload)).toThrow("Invalid version '1'");
    });
  });
});

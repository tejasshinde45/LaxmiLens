import { describe, it, expect } from 'vitest';
import { AccountMapper, CloudAccountRow } from '@/infrastructure/database/cloud/mappers/AccountMapper';
import { Account } from '@/domain/entities/Account';
import { createAccountId, createUserId } from '@/domain/value-objects/Identifiers';
import { InvalidMoneyError, InvalidUserIdError } from '@/domain/errors/DomainErrors';

describe('AccountMapper', () => {
  const validId = '123e4567-e89b-12d3-a456-426614174000';
  const validUserId = '987fcdeb-51a2-43f7-9876-543210987654';

  describe('mapCreatePayload', () => {
    it('correctly maps a complete creation payload with all fields', () => {
      const payload = {
        id: validId,
        user_id: validUserId,
        name: 'HDFC Salary Bank',
        account_type: 'bank',
        opening_balance_paise: 500000,
        currency: 'INR',
        institution_name: 'HDFC Bank',
        color: '#10B981',
        icon: 'Landmark',
        notes: 'Monthly corporate salary',
        is_archived: false,
        version: 1
      };

      const mapped = AccountMapper.mapCreatePayload(payload);

      expect(mapped.id).toBe(validId);
      expect(mapped.user_id).toBe(validUserId);
      expect(mapped.name).toBe('HDFC Salary Bank');
      expect(mapped.account_type).toBe('bank');
      expect(mapped.opening_balance_paise).toBe(500000);
      expect(mapped.currency).toBe('INR');
      expect(mapped.institution_name).toBe('HDFC Bank');
      expect(mapped.color).toBe('#10B981');
      expect(mapped.icon).toBe('Landmark');
      expect(mapped.notes).toBe('Monthly corporate salary');
      expect(mapped.is_archived).toBe(false);
      expect(mapped.version).toBe(1);
    });

    it('handles optional fields mapping undefined/empty to null', () => {
      const payload = {
        id: validId,
        user_id: validUserId,
        name: 'Cash Wallet',
        account_type: 'cash',
        opening_balance_paise: 0,
        currency: 'INR',
        is_archived: false,
        version: 1
      };

      const mapped = AccountMapper.mapCreatePayload(payload);

      expect(mapped.institution_name).toBeNull();
      expect(mapped.color).toBeNull();
      expect(mapped.icon).toBeNull();
      expect(mapped.notes).toBeNull();
    });

    it('strictly preserves the client-generated UUID without altering case or generating a new one', () => {
      const payload = {
        id: validId,
        user_id: validUserId,
        name: 'Savings',
        account_type: 'savings',
        opening_balance_paise: 100000
      };

      const mapped = AccountMapper.mapCreatePayload(payload);
      expect(mapped.id).toBe(validId);
      expect(mapped.user_id).toBe(validUserId);
    });

    it('strictly rejects non-safe integer or float paise values', () => {
      expect(() =>
        AccountMapper.mapCreatePayload({
          id: validId,
          user_id: validUserId,
          name: 'Invalid Money',
          account_type: 'cash',
          opening_balance_paise: 12.5
        })
      ).toThrow(InvalidMoneyError);

      expect(() =>
        AccountMapper.mapCreatePayload({
          id: validId,
          user_id: validUserId,
          name: 'Invalid Money',
          account_type: 'cash',
          opening_balance_paise: NaN
        })
      ).toThrow(InvalidMoneyError);

      expect(() =>
        AccountMapper.mapCreatePayload({
          id: validId,
          user_id: validUserId,
          name: 'Invalid Money',
          account_type: 'cash',
          opening_balance_paise: '500000' as unknown as number
        })
      ).toThrow(InvalidMoneyError);
    });

    it('rejects invalid or missing user UUID', () => {
      expect(() =>
        AccountMapper.mapCreatePayload({
          id: validId,
          user_id: 'local-user',
          name: 'Account',
          account_type: 'bank',
          opening_balance_paise: 0
        })
      ).toThrow(InvalidUserIdError);

      expect(() =>
        AccountMapper.mapCreatePayload({
          id: validId,
          name: 'Account',
          account_type: 'bank',
          opening_balance_paise: 0
        })
      ).toThrow(InvalidUserIdError);
    });

    it('rejects invalid account ID', () => {
      expect(() =>
        AccountMapper.mapCreatePayload({
          id: 'bad-id',
          user_id: validUserId,
          name: 'Account',
          account_type: 'bank',
          opening_balance_paise: 0
        })
      ).toThrow(/Invalid account ID/);
    });

    it('excludes legacy Dexie compatibility fields from mapped cloud row', () => {
      const payload = {
        id: validId,
        user_id: validUserId,
        name: 'Account',
        account_type: 'bank',
        opening_balance_paise: 100000,
        type: 'bank',
        openingBalanceInPaise: 100000,
        status: 'active'
      };

      const mapped = AccountMapper.mapCreatePayload(payload);
      expect(mapped).not.toHaveProperty('type');
      expect(mapped).not.toHaveProperty('openingBalanceInPaise');
      expect(mapped).not.toHaveProperty('status');
    });
  });

  describe('mapUpdatePayload', () => {
    it('maps only defined mutable fields and sets updated_at', () => {
      const payload = {
        id: validId,
        user_id: validUserId,
        name: 'Updated Name',
        notes: 'Updated notes',
        version: 2
      };

      const patch = AccountMapper.mapUpdatePayload(payload);

      expect(patch.name).toBe('Updated Name');
      expect(patch.notes).toBe('Updated notes');
      expect(patch.version).toBe(2);
      expect(patch.updated_at).toBeDefined();

      // Does not destructively map omitted optional fields to null
      expect(patch).not.toHaveProperty('institution_name');
      expect(patch).not.toHaveProperty('color');
      expect(patch).not.toHaveProperty('icon');
      expect(patch).not.toHaveProperty('opening_balance_paise');
    });

    it('never includes immutable fields in the returned update patch', () => {
      const payload = {
        id: validId,
        user_id: validUserId,
        currency: 'USD',
        created_at: '2026-01-01T00:00:00.000Z',
        name: 'Attempted Immutable Change',
        version: 2
      };

      const patch = AccountMapper.mapUpdatePayload(payload);

      expect(patch).not.toHaveProperty('id');
      expect(patch).not.toHaveProperty('user_id');
      expect(patch).not.toHaveProperty('currency');
      expect(patch).not.toHaveProperty('created_at');
    });

    it('excludes legacy Dexie fields from update patch', () => {
      const payload = {
        id: validId,
        user_id: validUserId,
        name: 'New Name',
        version: 2,
        type: 'bank',
        openingBalanceInPaise: 100000,
        status: 'active'
      };

      const patch = AccountMapper.mapUpdatePayload(payload);
      expect(patch).not.toHaveProperty('type');
      expect(patch).not.toHaveProperty('openingBalanceInPaise');
      expect(patch).not.toHaveProperty('status');
    });

    it('rejects invalid or unsafe integer paise in update', () => {
      expect(() =>
        AccountMapper.mapUpdatePayload({
          id: validId,
          user_id: validUserId,
          opening_balance_paise: 99.99,
          version: 2
        })
      ).toThrow(InvalidMoneyError);
    });
  });

  describe('mapArchivePayload and mapRestorePayload', () => {
    it('maps archive payload with is_archived = true and target version', () => {
      const payload = {
        id: validId,
        user_id: validUserId,
        is_archived: true,
        version: 3
      };

      const patch = AccountMapper.mapArchivePayload(payload);
      expect(patch.is_archived).toBe(true);
      expect(patch.version).toBe(3);
      expect(patch.updated_at).toBeDefined();
    });

    it('maps restore payload with is_archived = false and target version', () => {
      const payload = {
        id: validId,
        user_id: validUserId,
        is_archived: false,
        version: 4
      };

      const patch = AccountMapper.mapRestorePayload(payload);
      expect(patch.is_archived).toBe(false);
      expect(patch.version).toBe(4);
      expect(patch.updated_at).toBeDefined();
    });
  });

  describe('toDomain and toCloud round-trip', () => {
    it('converts between Domain Account and CloudAccountRow accurately', () => {
      const original = new Account({
        id: createAccountId(validId),
        userId: createUserId(validUserId),
        name: 'Salary Account',
        accountType: 'bank',
        openingBalancePaise: 2500000,
        currency: 'INR',
        institutionName: 'Axis Bank',
        color: '#D6AD60',
        icon: 'CreditCard',
        notes: 'Monthly corporate salary credit',
        isArchived: false,
        version: 1
      });

      const cloudRow = AccountMapper.toCloud(original);
      expect(cloudRow.id).toBe(validId);
      expect(cloudRow.user_id).toBe(validUserId);
      expect(cloudRow.opening_balance_paise).toBe(2500000);

      const restoredDomain = AccountMapper.toDomain(cloudRow);
      expect(restoredDomain.id).toBe(original.id);
      expect(restoredDomain.userId).toBe(original.userId);
      expect(restoredDomain.name).toBe(original.name);
      expect(restoredDomain.accountType).toBe(original.accountType);
      expect(restoredDomain.openingBalancePaise).toBe(original.openingBalancePaise);
      expect(restoredDomain.institutionName).toBe(original.institutionName);
      expect(restoredDomain.color).toBe(original.color);
      expect(restoredDomain.icon).toBe(original.icon);
      expect(restoredDomain.notes).toBe(original.notes);
      expect(restoredDomain.isArchived).toBe(original.isArchived);
      expect(restoredDomain.version).toBe(original.version);
    });
  });
});

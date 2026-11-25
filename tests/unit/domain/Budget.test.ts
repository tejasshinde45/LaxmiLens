import { describe, it, expect } from 'vitest';
import { Budget } from '@/domain/entities/Budget';
import {
  createBudgetId,
  createCategoryId,
  createUserId
} from '@/domain/value-objects/Identifiers';
import { Money } from '@/domain/value-objects/Money';
import { InvalidUserIdError } from '@/domain/errors/DomainErrors';
import {
  InvalidBudgetLimitError,
  InvalidBudgetPeriodError,
  InvalidSpendingAmountError
} from '@/domain/errors/BudgetErrors';

describe('Budget Entity — Domain Foundation', () => {
  const validBudgetId = createBudgetId('11111111-1111-4111-8111-111111111111');
  const validUserId = createUserId('22222222-2222-4222-8222-222222222222');
  const validCategoryId = createCategoryId('33333333-3333-4333-8333-333333333333');
  const validPeriod = '2026-11';
  const validLimitPaise = 5000000; // ₹50,000.00

  it('constructs a valid budget with default version and timestamps', () => {
    const budget = new Budget({
      id: validBudgetId,
      userId: validUserId,
      categoryId: validCategoryId,
      period: validPeriod,
      limitPaise: validLimitPaise
    });

    expect(budget.id).toBe(validBudgetId);
    expect(budget.userId).toBe(validUserId);
    expect(budget.categoryId).toBe(validCategoryId);
    expect(budget.period).toBe('2026-11');
    expect(budget.limitPaise).toBe(5000000);
    expect(budget.version).toBe(1);
    expect(budget.createdAt).toBeInstanceOf(Date);
    expect(budget.updatedAt).toBeInstanceOf(Date);
    expect(Object.isFrozen(budget)).toBe(true);

    // Compatibility getters
    expect(budget.limit).toBeInstanceOf(Money);
    expect(budget.limit.paise).toBe(5000000);
    expect(budget.limit.rupees).toBe(50000);
  });

  it('preserves custom version and timestamps during construction and updateLimit', () => {
    const createdAt = new Date('2026-11-01T00:00:00.000Z');
    const updatedAt = new Date('2026-11-01T00:00:00.000Z');

    const budget = new Budget({
      id: validBudgetId,
      userId: validUserId,
      categoryId: validCategoryId,
      period: validPeriod,
      limitPaise: validLimitPaise,
      version: 3,
      createdAt,
      updatedAt
    });

    expect(budget.version).toBe(3);
    expect(budget.createdAt).toEqual(createdAt);
    expect(budget.updatedAt).toEqual(updatedAt);

    // Immutable update
    const updated = budget.updateLimit(7500000);
    expect(updated.limitPaise).toBe(7500000);
    expect(updated.version).toBe(4);
    expect(updated.createdAt).toEqual(createdAt);
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(updatedAt.getTime());
    expect(budget.limitPaise).toBe(5000000); // Original remains unchanged
  });

  describe('Identity and UUID validation', () => {
    it('rejects missing or invalid budget ID', () => {
      expect(() => {
        new Budget({
          id: '' as any,
          userId: validUserId,
          categoryId: validCategoryId,
          period: validPeriod,
          limitPaise: validLimitPaise
        });
      }).toThrow('Budget ID is required and must be a valid UUID.');

      expect(() => {
        new Budget({
          id: 'not-a-uuid' as any,
          userId: validUserId,
          categoryId: validCategoryId,
          period: validPeriod,
          limitPaise: validLimitPaise
        });
      }).toThrow('Budget ID is required and must be a valid UUID.');
    });

    it('rejects missing or invalid user ID with InvalidUserIdError', () => {
      expect(() => {
        new Budget({
          id: validBudgetId,
          userId: '' as any,
          categoryId: validCategoryId,
          period: validPeriod,
          limitPaise: validLimitPaise
        });
      }).toThrow(InvalidUserIdError);

      expect(() => {
        new Budget({
          id: validBudgetId,
          userId: 'non-uuid-user' as any,
          categoryId: validCategoryId,
          period: validPeriod,
          limitPaise: validLimitPaise
        });
      }).toThrow(InvalidUserIdError);
    });

    it('rejects missing or invalid category ID', () => {
      expect(() => {
        new Budget({
          id: validBudgetId,
          userId: validUserId,
          categoryId: '' as any,
          period: validPeriod,
          limitPaise: validLimitPaise
        });
      }).toThrow('Category ID is required and must be a valid UUID.');

      expect(() => {
        new Budget({
          id: validBudgetId,
          userId: validUserId,
          categoryId: 'invalid-category-uuid' as any,
          period: validPeriod,
          limitPaise: validLimitPaise
        });
      }).toThrow('Category ID is required and must be a valid UUID.');
    });
  });

  describe('Calendar Period validation', () => {
    it('accepts valid YYYY-MM periods', () => {
      const jan = new Budget({
        id: validBudgetId,
        userId: validUserId,
        categoryId: validCategoryId,
        period: '2026-01',
        limitPaise: validLimitPaise
      });
      expect(jan.period).toBe('2026-01');

      const dec = new Budget({
        id: validBudgetId,
        userId: validUserId,
        categoryId: validCategoryId,
        period: '2026-12',
        limitPaise: validLimitPaise
      });
      expect(dec.period).toBe('2026-12');
    });

    it('rejects malformed period strings', () => {
      const invalidPeriods = [
        '',
        '   ',
        '2026',
        '2026-1', // Single digit month
        '2026-13', // Out of bounds month
        '2026-00', // Month 00
        '2026/11', // Slash separator
        '26-11', // 2-digit year
        '202611', // Missing separator
        'November 2026',
        '2026-Nov'
      ];

      for (const p of invalidPeriods) {
        expect(() => {
          new Budget({
            id: validBudgetId,
            userId: validUserId,
            categoryId: validCategoryId,
            period: p,
            limitPaise: validLimitPaise
          });
        }).toThrow(InvalidBudgetPeriodError);
      }
    });
  });

  describe('Monetary limit validation', () => {
    it('rejects zero and negative limit amounts', () => {
      expect(() => {
        new Budget({
          id: validBudgetId,
          userId: validUserId,
          categoryId: validCategoryId,
          period: validPeriod,
          limitPaise: 0
        });
      }).toThrow(InvalidBudgetLimitError);

      expect(() => {
        new Budget({
          id: validBudgetId,
          userId: validUserId,
          categoryId: validCategoryId,
          period: validPeriod,
          limitPaise: -1
        });
      }).toThrow(InvalidBudgetLimitError);

      expect(() => {
        new Budget({
          id: validBudgetId,
          userId: validUserId,
          categoryId: validCategoryId,
          period: validPeriod,
          limitPaise: -50000
        });
      }).toThrow(InvalidBudgetLimitError);
    });

    it('rejects non-integer, NaN, and Infinity amounts', () => {
      expect(() => {
        new Budget({
          id: validBudgetId,
          userId: validUserId,
          categoryId: validCategoryId,
          period: validPeriod,
          limitPaise: 499.99
        });
      }).toThrow(InvalidBudgetLimitError);

      expect(() => {
        new Budget({
          id: validBudgetId,
          userId: validUserId,
          categoryId: validCategoryId,
          period: validPeriod,
          limitPaise: NaN
        });
      }).toThrow(InvalidBudgetLimitError);

      expect(() => {
        new Budget({
          id: validBudgetId,
          userId: validUserId,
          categoryId: validCategoryId,
          period: validPeriod,
          limitPaise: Infinity
        });
      }).toThrow(InvalidBudgetLimitError);
    });

    it('rejects unsafe integer amounts exceeding Number.MAX_SAFE_INTEGER', () => {
      expect(() => {
        new Budget({
          id: validBudgetId,
          userId: validUserId,
          categoryId: validCategoryId,
          period: validPeriod,
          limitPaise: Number.MAX_SAFE_INTEGER + 100
        });
      }).toThrow(InvalidBudgetLimitError);

      // Accepts safe maximum integer
      const maxBudget = new Budget({
        id: validBudgetId,
        userId: validUserId,
        categoryId: validCategoryId,
        period: validPeriod,
        limitPaise: Number.MAX_SAFE_INTEGER
      });
      expect(maxBudget.limitPaise).toBe(Number.MAX_SAFE_INTEGER);
    });
  });

  describe('Financial Calculations and Invariants', () => {
    const budget = new Budget({
      id: validBudgetId,
      userId: validUserId,
      categoryId: validCategoryId,
      period: validPeriod,
      limitPaise: 100000 // ₹1,000.00
    });

    describe('Zero Spending', () => {
      it('handles zero spending correctly', () => {
        expect(budget.isExceeded(0)).toBe(false);
        expect(budget.remainingPaise(0)).toBe(100000);
        expect(budget.utilizationPercentage(0)).toBe(0);

        // Compatibility
        expect(budget.isOverBudget(Money.zero())).toBe(false);
        expect(budget.remaining(Money.zero()).paise).toBe(100000);
      });
    });

    describe('Normal Partial Spending', () => {
      it('calculates remaining and utilization percentage accurately', () => {
        const spentPaise = 40000; // ₹400.00 (40%)

        expect(budget.isExceeded(spentPaise)).toBe(false);
        expect(budget.remainingPaise(spentPaise)).toBe(60000);
        expect(budget.utilizationPercentage(spentPaise)).toBe(40);

        // Compatibility
        expect(budget.isOverBudget(Money.fromPaise(spentPaise))).toBe(false);
        expect(budget.remaining(Money.fromPaise(spentPaise)).paise).toBe(60000);
      });

      it('rounds non-even percentages to nearest integer without floating point artifacts', () => {
        // ₹333.33 of ₹1,000 = 33.333% -> 33%
        expect(budget.utilizationPercentage(33333)).toBe(33);

        // ₹666.67 of ₹1,000 = 66.667% -> 67%
        expect(budget.utilizationPercentage(66667)).toBe(67);
      });
    });

    describe('Exact Limit Reached', () => {
      it('evaluates exact limit equality correctly', () => {
        const exactPaise = 100000; // Exactly ₹1,000.00

        expect(budget.isExceeded(exactPaise)).toBe(false);
        expect(budget.remainingPaise(exactPaise)).toBe(0);
        expect(budget.utilizationPercentage(exactPaise)).toBe(100);
      });
    });

    describe('Exceeded Budget (Spending Above 100%)', () => {
      it('identifies exceeded budget and preserves unclamped utilization percentage above 100%', () => {
        const spentPaise = 150000; // ₹1,500.00 (150%)

        expect(budget.isExceeded(spentPaise)).toBe(true);
        expect(budget.remainingPaise(spentPaise)).toBe(0); // Floor at 0, never negative
        expect(budget.utilizationPercentage(spentPaise)).toBe(150); // Unclamped above 100%

        // 250% utilization
        expect(budget.utilizationPercentage(250000)).toBe(250);
        expect(budget.remainingPaise(250000)).toBe(0);
        expect(budget.isExceeded(250000)).toBe(true);
      });
    });

    describe('Negative and Invalid Spending Rejection', () => {
      it('rejects negative spending values across all calculation methods', () => {
        expect(() => budget.isExceeded(-1)).toThrow(InvalidSpendingAmountError);
        expect(() => budget.isExceeded(-5000)).toThrow(InvalidSpendingAmountError);

        expect(() => budget.remainingPaise(-1)).toThrow(InvalidSpendingAmountError);
        expect(() => budget.remainingPaise(-5000)).toThrow(InvalidSpendingAmountError);

        expect(() => budget.utilizationPercentage(-1)).toThrow(InvalidSpendingAmountError);
        expect(() => budget.utilizationPercentage(-5000)).toThrow(InvalidSpendingAmountError);
      });

      it('rejects non-integer, NaN, and unsafe spending values', () => {
        expect(() => budget.isExceeded(499.5)).toThrow(InvalidSpendingAmountError);
        expect(() => budget.remainingPaise(NaN)).toThrow(InvalidSpendingAmountError);
        expect(() => budget.utilizationPercentage(Infinity)).toThrow(InvalidSpendingAmountError);
        expect(() => budget.isExceeded(Number.MAX_SAFE_INTEGER + 1)).toThrow(InvalidSpendingAmountError);
      });
    });
  });
});

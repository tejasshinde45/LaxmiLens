import { describe, it, expect } from 'vitest';
import { Money } from '@/domain/value-objects/Money';
import { InvalidMoneyError } from '@/domain/errors/DomainErrors';

describe('Money Value Object', () => {
  it('correctly creates Money from exact integer paise', () => {
    const money = Money.fromPaise(15050);
    expect(money.paise).toBe(15050);
    expect(money.rupees).toBe(150.5);
    expect(money.currency).toBe('INR');
  });

  it('correctly converts decimal rupee values into exact paise (e.g. ₹1,250.75 = 125075 paise)', () => {
    const money = Money.fromRupees(1250.75);
    expect(money.paise).toBe(125075);
    expect(money.rupees).toBe(1250.75);
    expect(money.format()).toBe('₹1,250.75');
  });

  it('correctly converts rupees to integer paise without floating-point errors', () => {
    // 0.1 + 0.2 in JS float = 0.30000000000000004
    const money = Money.fromRupees(0.1 + 0.2);
    expect(money.paise).toBe(30);
    expect(money.rupees).toBe(0.3);
  });

  it('rejects unsafe floating-point paise', () => {
    expect(() => Money.fromPaise(100.55)).toThrow(InvalidMoneyError);
    expect(() => Money.fromPaise(NaN)).toThrow(InvalidMoneyError);
    expect(() => Money.fromPaise(Infinity)).toThrow(InvalidMoneyError);
  });

  it('performs exact addition and subtraction', () => {
    const a = Money.fromRupees(100.5); // 10050 paise
    const b = Money.fromRupees(49.5); // 4950 paise

    const sum = a.add(b);
    expect(sum.paise).toBe(15000);
    expect(sum.rupees).toBe(150.0);

    const diff = a.subtract(b);
    expect(diff.paise).toBe(5100);
    expect(diff.rupees).toBe(51.0);
  });

  it('correctly handles large monetary values (e.g. 10 Crore = ₹10,00,00,000)', () => {
    // 10 Crore rupees = 10,000,000,000 paise (well within Number.MAX_SAFE_INTEGER 9e15)
    const tenCrores = Money.fromRupees(100000000);
    expect(tenCrores.paise).toBe(10000000000);
    expect(tenCrores.rupees).toBe(100000000);
    expect(tenCrores.format()).toBe('₹10,00,00,000.00');
  });

  it('distributes allocation without losing odd paise', () => {
    // ₹100 into 3 parts (10000 paise / 3) -> 3334, 3333, 3333
    const money = Money.fromRupees(100);
    const shares = money.allocate([1, 1, 1]);

    expect(shares.length).toBe(3);
    expect(shares[0].paise).toBe(3334);
    expect(shares[1].paise).toBe(3333);
    expect(shares[2].paise).toBe(3333);

    const totalAllocated = shares.reduce((acc, m) => acc.add(m), Money.zero());
    expect(totalAllocated.paise).toBe(10000);
  });

  it('formats to Indian numbering format with rupee symbol', () => {
    const money = Money.fromPaise(12345678); // ₹1,23,456.78
    expect(money.format()).toBe('₹1,23,456.78');

    const negative = Money.fromPaise(-50000); // -₹500.00
    expect(negative.format()).toBe('-₹500.00');
  });

  it('supports comparisons correctly', () => {
    const small = Money.fromRupees(50);
    const big = Money.fromRupees(100);

    expect(big.greaterThan(small)).toBe(true);
    expect(small.lessThan(big)).toBe(true);
    expect(small.equals(Money.fromPaise(5000))).toBe(true);
    expect(Money.zero().isZero()).toBe(true);
    expect(small.isPositive()).toBe(true);
    expect(Money.fromPaise(-100).isNegative()).toBe(true);
  });
});

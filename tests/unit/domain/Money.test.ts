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

  it('correctly converts rupees to integer paise without floating-point errors', () => {
    // 0.1 + 0.2 in JS float = 0.30000000000000004
    const money = Money.fromRupees(0.1 + 0.2);
    expect(money.paise).toBe(30);
    expect(money.rupees).toBe(0.3);
  });

  it('rejects unsafe floating-point paise', () => {
    expect(() => Money.fromPaise(100.55)).toThrow(InvalidMoneyError);
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
});

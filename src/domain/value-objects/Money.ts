import { InvalidMoneyError } from '../errors/DomainErrors';

/**
 * Money Value Object
 *
 * Immutably represents an amount of currency strictly as integer paise (1 INR = 100 paise).
 * Eliminates IEEE-754 floating point arithmetic inaccuracies.
 */
export class Money {
  private readonly _paise: number;
  private readonly _currency: string;

  private constructor(paise: number, currency = 'INR') {
    if (!Number.isSafeInteger(paise)) {
      throw new InvalidMoneyError(`Amount in paise must be a safe integer, received: ${paise}`);
    }
    this._paise = paise;
    this._currency = currency;
    Object.freeze(this);
  }

  /**
   * Creates a Money instance from an exact integer count of paise.
   */
  public static fromPaise(paise: number | bigint, currency = 'INR'): Money {
    const numericPaise = typeof paise === 'bigint' ? Number(paise) : paise;
    return new Money(numericPaise, currency);
  }

  /**
   * Creates a Money instance from rupees (e.g. 150.50 -> 15050 paise).
   * Uses Math.round to avoid floating point precision conversion artifacts.
   */
  public static fromRupees(rupees: number, currency = 'INR'): Money {
    if (!Number.isFinite(rupees)) {
      throw new InvalidMoneyError(`Rupees must be a finite number, received: ${rupees}`);
    }
    const paise = Math.round(rupees * 100);
    return new Money(paise, currency);
  }

  /**
   * Creates a Money instance with a value of zero.
   */
  public static zero(currency = 'INR'): Money {
    return new Money(0, currency);
  }

  public get paise(): number {
    return this._paise;
  }

  public get rupees(): number {
    return this._paise / 100;
  }

  public get currency(): string {
    return this._currency;
  }

  public add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this._paise + other._paise, this._currency);
  }

  public subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this._paise - other._paise, this._currency);
  }

  public multiply(factor: number): Money {
    if (!Number.isFinite(factor)) {
      throw new InvalidMoneyError(`Multiplication factor must be finite, received: ${factor}`);
    }
    return new Money(Math.round(this._paise * factor), this._currency);
  }

  /**
   * Distributes an amount across proportional ratios without losing paise.
   * e.g., allocating ₹100 into 3 parts yields [3334, 3333, 3333] paise.
   */
  public allocate(ratios: number[]): Money[] {
    if (ratios.length === 0) return [];
    const totalRatio = ratios.reduce((sum, r) => sum + r, 0);
    if (totalRatio <= 0) {
      throw new InvalidMoneyError('Sum of allocation ratios must be positive.');
    }

    let remainder = this._paise;
    const results: Money[] = [];

    for (let i = 0; i < ratios.length; i++) {
      const share = Math.floor((this._paise * ratios[i]) / totalRatio);
      results.push(new Money(share, this._currency));
      remainder -= share;
    }

    // Distribute remainder 1 paise at a time to ensure exact balance
    for (let i = 0; i < remainder; i++) {
      results[i] = results[i].add(new Money(1, this._currency));
    }

    return results;
  }

  public equals(other: Money): boolean {
    return this._currency === other._currency && this._paise === other._paise;
  }

  public greaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this._paise > other._paise;
  }

  public lessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this._paise < other._paise;
  }

  public isZero(): boolean {
    return this._paise === 0;
  }

  public isPositive(): boolean {
    return this._paise > 0;
  }

  public isNegative(): boolean {
    return this._paise < 0;
  }

  public negate(): Money {
    return new Money(-this._paise, this._currency);
  }

  public abs(): Money {
    return new Money(Math.abs(this._paise), this._currency);
  }

  public format(options: { showSymbol?: boolean; showDecimals?: boolean } = {}): string {
    const { showSymbol = true, showDecimals = true } = options;
    const isNeg = this.isNegative();
    const absPaise = Math.abs(this._paise);
    const rupees = Math.floor(absPaise / 100);
    const remainder = absPaise % 100;

    const formattedRupees = rupees.toLocaleString('en-IN');
    const decimalPart = showDecimals ? `.${remainder.toString().padStart(2, '0')}` : '';
    const symbol = showSymbol ? (this._currency === 'INR' ? '₹' : `${this._currency} `) : '';
    const prefix = isNeg ? '-' : '';

    return `${prefix}${symbol}${formattedRupees}${decimalPart}`;
  }

  public toJSON(): number {
    return this._paise;
  }

  private assertSameCurrency(other: Money): void {
    if (this._currency !== other._currency) {
      throw new InvalidMoneyError(
        `Cannot perform arithmetic across currencies: '${this._currency}' and '${other._currency}'.`
      );
    }
  }
}

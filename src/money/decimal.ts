// Exact decimal arithmetic for money, prices, quantities and rates.
//
// A Decimal is an integer number of units at a given scale: 54.07 is 5407 at scale 2.
// Addition, subtraction and multiplication are exact. Division rounds to a chosen scale
// (default 18 decimal places) using banker's rounding (half to even), and rounding for
// display or storage is always explicit. JavaScript numbers are never used for values.

import { isDecimalString } from '../db/conventions';

export type RoundingMode = 'half-even' | 'half-up' | 'down';

/** Decimal places kept by division unless another scale is given. */
export const DEFAULT_DIVISION_SCALE = 18;

const TEN = 10n;

function pow10(exponent: number): bigint {
  return TEN ** BigInt(exponent);
}

/** Divides a by b (b > 0 or b < 0), rounding the quotient to an integer. */
function divideRounded(a: bigint, b: bigint, mode: RoundingMode): bigint {
  if (b === 0n) throw new RangeError('Division by zero');
  const negative = a < 0n !== b < 0n;
  const absA = a < 0n ? -a : a;
  const absB = b < 0n ? -b : b;
  let quotient = absA / absB;
  const remainder = absA % absB;
  if (remainder !== 0n && mode !== 'down') {
    const twice = remainder * 2n;
    if (twice > absB || (twice === absB && (mode === 'half-up' || quotient % 2n === 1n))) {
      quotient += 1n;
    }
  }
  return negative ? -quotient : quotient;
}

export class Decimal {
  private constructor(
    /** The value times 10^scale. */
    readonly units: bigint,
    /** Number of decimal places. */
    readonly scale: number,
  ) {}

  static readonly ZERO = new Decimal(0n, 0);
  static readonly ONE = new Decimal(1n, 0);

  /** Parses a canonical decimal string, e.g. '54.07' or '-0.00125'. Throws on anything else. */
  static parse(value: string): Decimal {
    if (!isDecimalString(value)) {
      throw new TypeError(`Not a valid decimal string: ${JSON.stringify(value)}`);
    }
    const negative = value.startsWith('-');
    const body = negative ? value.slice(1) : value;
    const [whole = '0', fraction = ''] = body.split('.');
    const units = BigInt(whole + fraction);
    return new Decimal(negative ? -units : units, fraction.length);
  }

  /** Builds a Decimal from an integer, e.g. a share count. */
  static fromInteger(value: bigint | number): Decimal {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
      throw new TypeError(`Not a safe integer: ${value}`);
    }
    return new Decimal(BigInt(value), 0);
  }

  static sum(values: Iterable<Decimal>): Decimal {
    let total = Decimal.ZERO;
    for (const value of values) total = total.plus(value);
    return total;
  }

  private rescale(scale: number): bigint {
    return this.units * pow10(scale - this.scale);
  }

  plus(other: Decimal): Decimal {
    const scale = Math.max(this.scale, other.scale);
    return new Decimal(this.rescale(scale) + other.rescale(scale), scale);
  }

  minus(other: Decimal): Decimal {
    return this.plus(other.negated());
  }

  times(other: Decimal): Decimal {
    return new Decimal(this.units * other.units, this.scale + other.scale);
  }

  /** Divides, rounding the result to `scale` decimal places. */
  dividedBy(other: Decimal, scale: number = DEFAULT_DIVISION_SCALE, mode: RoundingMode = 'half-even'): Decimal {
    // this / other = (a / 10^sa) / (b / 10^sb); the result at scale s has units a * 10^(s - sa + sb) / b.
    const exponent = scale - this.scale + other.scale;
    const numerator = exponent >= 0 ? this.units * pow10(exponent) : this.units;
    const denominator = exponent >= 0 ? other.units : other.units * pow10(-exponent);
    return new Decimal(divideRounded(numerator, denominator, mode), scale);
  }

  /** Rounds (or pads) to exactly `scale` decimal places. */
  round(scale: number, mode: RoundingMode = 'half-even'): Decimal {
    if (scale >= this.scale) return new Decimal(this.rescale(scale), scale);
    return new Decimal(divideRounded(this.units, pow10(this.scale - scale), mode), scale);
  }

  negated(): Decimal {
    return new Decimal(-this.units, this.scale);
  }

  abs(): Decimal {
    return this.units < 0n ? this.negated() : this;
  }

  compare(other: Decimal): -1 | 0 | 1 {
    const scale = Math.max(this.scale, other.scale);
    const a = this.rescale(scale);
    const b = other.rescale(scale);
    return a < b ? -1 : a > b ? 1 : 0;
  }

  equals(other: Decimal): boolean {
    return this.compare(other) === 0;
  }

  lessThan(other: Decimal): boolean {
    return this.compare(other) < 0;
  }

  greaterThan(other: Decimal): boolean {
    return this.compare(other) > 0;
  }

  isZero(): boolean {
    return this.units === 0n;
  }

  isNegative(): boolean {
    return this.units < 0n;
  }

  /** Removes trailing fractional zeros: 54.0700 becomes 54.07, 2.000 becomes 2. */
  normalized(): Decimal {
    let { units, scale } = this;
    while (scale > 0 && units % TEN === 0n) {
      units /= TEN;
      scale -= 1;
    }
    return new Decimal(units, scale);
  }

  /** The canonical decimal string at this value's scale, e.g. '54.0700'. Never uses exponents. */
  toString(): string {
    const negative = this.units < 0n;
    const digits = (negative ? -this.units : this.units).toString().padStart(this.scale + 1, '0');
    const whole = digits.slice(0, digits.length - this.scale);
    const fraction = digits.slice(digits.length - this.scale);
    const text = this.scale > 0 ? `${whole}.${fraction}` : whole;
    return negative && this.units !== 0n ? `-${text}` : text;
  }

  /** Rounded to `scale` places and formatted, e.g. toFixed(2) for display of money. */
  toFixed(scale: number, mode: RoundingMode = 'half-even'): string {
    return this.round(scale, mode).toString();
  }
}

/** Shorthand for Decimal.parse. */
export function dec(value: string): Decimal {
  return Decimal.parse(value);
}

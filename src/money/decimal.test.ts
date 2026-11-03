import { describe, expect, it } from 'vitest';
import { isDecimalString } from '../db/conventions';
import { Decimal, dec } from './decimal';

describe('Decimal parsing and formatting', () => {
  it('round-trips canonical strings exactly, keeping trailing zeros', () => {
    for (const value of ['0', '54.07', '54.0700', '-0.00125', '1000000.000001', '7']) {
      expect(dec(value).toString()).toBe(value);
    }
  });

  it('rejects non-canonical input', () => {
    for (const value of ['', '1e3', '.5', '01', '1,000', 'abc', '-0']) {
      expect(() => dec(value)).toThrow(TypeError);
    }
  });

  it('formats small and negative values', () => {
    expect(dec('0.05').negated().toString()).toBe('-0.05');
    expect(dec('0.000001').toString()).toBe('0.000001');
  });

  it('never produces "-0"', () => {
    expect(dec('0.10').minus(dec('0.1')).toString()).toBe('0.00');
    expect(dec('0').negated().toString()).toBe('0');
  });

  it('builds from integers', () => {
    expect(Decimal.fromInteger(42).toString()).toBe('42');
    expect(() => Decimal.fromInteger(1.5)).toThrow(TypeError);
  });
});

describe('Decimal arithmetic', () => {
  it('adds exactly where floating point does not', () => {
    expect(dec('0.1').plus(dec('0.2')).toString()).toBe('0.3');
  });

  it('subtracts across scales', () => {
    expect(dec('100').minus(dec('0.01')).toString()).toBe('99.99');
  });

  it('multiplies exactly', () => {
    expect(dec('10').times(dec('54.07')).toString()).toBe('540.70');
    expect(dec('0.5').times(dec('-0.5')).toString()).toBe('-0.25');
  });

  it('divides with a chosen scale and banker’s rounding', () => {
    expect(dec('1').dividedBy(dec('3'), 4).toString()).toBe('0.3333');
    expect(dec('2').dividedBy(dec('3'), 4).toString()).toBe('0.6667');
    expect(dec('0.25').dividedBy(dec('1'), 1).toString()).toBe('0.2'); // half to even
    expect(dec('0.35').dividedBy(dec('1'), 1).toString()).toBe('0.4'); // half to even
    expect(dec('-1').dividedBy(dec('8'), 2).toString()).toBe('-0.12');
    expect(dec('540.70').dividedBy(dec('10')).normalized().toString()).toBe('54.07');
  });

  it('divides when the dividend has more decimals than the result scale', () => {
    expect(dec('1.23456').dividedBy(dec('2'), 2).toString()).toBe('0.62');
    expect(dec('5').dividedBy(dec('0.04'), 0).toString()).toBe('125');
  });

  it('refuses division by zero', () => {
    expect(() => dec('1').dividedBy(dec('0'))).toThrow(RangeError);
  });

  it('rounds for display with explicit modes', () => {
    expect(dec('2.345').toFixed(2)).toBe('2.34');
    expect(dec('2.345').toFixed(2, 'half-up')).toBe('2.35');
    expect(dec('2.349').toFixed(2, 'down')).toBe('2.34');
    expect(dec('-2.345').toFixed(2, 'half-up')).toBe('-2.35');
    expect(dec('2').toFixed(2)).toBe('2.00');
  });

  it('compares across scales', () => {
    expect(dec('1.0').equals(dec('1'))).toBe(true);
    expect(dec('0.99').lessThan(dec('1'))).toBe(true);
    expect(dec('-1').greaterThan(dec('-2'))).toBe(true);
  });

  it('sums lists and normalizes', () => {
    expect(Decimal.sum([dec('1.10'), dec('2.20'), dec('3.30')]).normalized().toString()).toBe('6.6');
    expect(Decimal.sum([]).toString()).toBe('0');
  });

  it('always produces canonical decimal strings', () => {
    const values = [dec('1').dividedBy(dec('7')), dec('-3.5').times(dec('2')), dec('0.0').plus(dec('0'))];
    for (const value of values) {
      expect(isDecimalString(value.toString())).toBe(true);
    }
  });
});

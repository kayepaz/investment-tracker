import { describe, expect, it } from 'vitest';
import { dec } from '../money/decimal';
import { formatMoney, formatNumber, formatPercent, formatSignedMoney, today } from './format';

describe('format', () => {
  it('formats money with grouping and two decimals', () => {
    expect(formatMoney('1234567.505', 'CAD')).toBe('1,234,567.50 CAD');
    expect(formatMoney(dec('-4'), 'USD')).toBe('−4.00 USD');
    expect(formatMoney('0', 'CAD')).toBe('0.00 CAD');
  });

  it('adds a plus sign to positive signed amounts', () => {
    expect(formatSignedMoney(dec('12.3'), 'CAD')).toBe('+12.30 CAD');
    expect(formatSignedMoney(dec('-12.3'), 'CAD')).toBe('−12.30 CAD');
  });

  it('formats quantities without trailing zeros', () => {
    expect(formatNumber('1500.000')).toBe('1,500');
    expect(formatNumber('0.00125')).toBe('0.00125');
    expect(formatNumber('1.123456789')).toBe('1.123457');
  });

  it('formats percentages', () => {
    expect(formatPercent(dec('8.1400'))).toBe('8.14%');
  });

  it('gives today as a local ISO date', () => {
    expect(today(new Date(2026, 10, 2, 23, 59))).toBe('2026-11-02');
  });
});

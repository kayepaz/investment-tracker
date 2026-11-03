import { describe, expect, it } from 'vitest';
import { isCurrencyCode, isDecimalString, isIsoDate, isUuidV7, uuidv7 } from './conventions';

describe('uuidv7', () => {
  it('produces valid version 7 UUIDs', () => {
    for (let i = 0; i < 50; i++) {
      expect(isUuidV7(uuidv7())).toBe(true);
    }
  });

  it('encodes the timestamp so IDs sort by creation time', () => {
    const zeros = (bytes: Uint8Array) => bytes.fill(0);
    const earlier = uuidv7(1_700_000_000_000, zeros);
    const later = uuidv7(1_700_000_000_001, zeros);
    expect(earlier < later).toBe(true);
    expect(earlier.slice(0, 13)).toBe('018bcfe5-6800');
  });

  it('is unique across many calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(ids.size).toBe(1000);
  });
});

describe('isIsoDate', () => {
  it('accepts real dates', () => {
    expect(isIsoDate('2026-11-02')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
  });

  it('rejects impossible or badly formatted dates', () => {
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2025-02-29')).toBe(false);
    expect(isIsoDate('2026-1-2')).toBe(false);
    expect(isIsoDate('2026-11-02T00:00:00Z')).toBe(false);
  });
});

describe('isDecimalString', () => {
  it('accepts canonical decimals', () => {
    for (const value of ['0', '12', '12.5', '-0.00125', '1000000.000001']) {
      expect(isDecimalString(value)).toBe(true);
    }
  });

  it('rejects non-canonical forms', () => {
    for (const value of ['', '01', '1.', '.5', '+1', '1e3', '-0', '1,000', 'NaN']) {
      expect(isDecimalString(value)).toBe(false);
    }
  });
});

describe('isCurrencyCode', () => {
  it('accepts upper-case three-letter codes only', () => {
    expect(isCurrencyCode('CAD')).toBe(true);
    expect(isCurrencyCode('cad')).toBe(false);
    expect(isCurrencyCode('CADX')).toBe(false);
  });
});

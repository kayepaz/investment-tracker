import { describe, expect, it } from 'vitest';
import {
  describeResult,
  eodhdLastCloseUrl,
  fetchAndParse,
  parseBankOfCanada,
  parseEodhdLastClose,
} from './providers';

describe('parseBankOfCanada', () => {
  it('reads the latest observation', () => {
    const json = { observations: [{ d: '2026-10-30', FXUSDCAD: { v: '1.3912' } }] };
    expect(parseBankOfCanada(json)).toEqual({ ok: true, summary: 'USD/CAD 1.3912 on 2026-10-30' });
  });

  it('reports an empty response', () => {
    expect(parseBankOfCanada({ observations: [] })).toMatchObject({ ok: false, kind: 'bad-response' });
    expect(parseBankOfCanada(null)).toMatchObject({ ok: false, kind: 'bad-response' });
  });
});

describe('parseEodhdLastClose', () => {
  it('accepts a number or numeric string', () => {
    expect(parseEodhdLastClose('XIU.TO', 41.25)).toEqual({ ok: true, summary: 'XIU.TO last close 41.25' });
    expect(parseEodhdLastClose('XIU.TO', '41.25')).toMatchObject({ ok: true });
  });

  it('rejects anything else', () => {
    expect(parseEodhdLastClose('XIU.TO', { error: 'x' })).toMatchObject({ ok: false, kind: 'bad-response' });
  });
});

describe('eodhdLastCloseUrl', () => {
  it('builds the last-close URL', () => {
    expect(eodhdLastCloseUrl('XIU.TO', 'k')).toBe(
      'https://eodhd.com/api/eod/XIU.TO?api_token=k&fmt=json&filter=last_close',
    );
  });
});

describe('fetchAndParse', () => {
  const parse = (json: unknown) => parseEodhdLastClose('X', json);

  it('reports a network-level failure as blocked', async () => {
    const failing = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
    expect(await fetchAndParse('https://x', parse, failing)).toMatchObject({ ok: false, kind: 'blocked' });
  });

  it('reports HTTP errors', async () => {
    const unauthorized = (() =>
      Promise.resolve(new Response('no', { status: 401, statusText: 'Unauthorized' }))) as unknown as typeof fetch;
    expect(await fetchAndParse('https://x', parse, unauthorized)).toEqual({
      ok: false,
      kind: 'http',
      detail: 'HTTP 401 Unauthorized',
    });
  });

  it('parses a successful response', async () => {
    const okFetch = (() => Promise.resolve(new Response('12.5'))) as unknown as typeof fetch;
    expect(await fetchAndParse('https://x', parse, okFetch)).toMatchObject({ ok: true });
  });
});

describe('describeResult', () => {
  it('summarizes results', () => {
    expect(describeResult(null)).toBe('not run');
    expect(describeResult({ ok: true, summary: 's' })).toBe('OK: s');
    expect(describeResult({ ok: false, kind: 'http', detail: 'd' })).toBe('FAILED (http): d');
  });
});

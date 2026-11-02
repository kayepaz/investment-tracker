// Data conventions shared by both databases. See docs/data-model.md.
//
// - IDs: UUID v7 strings (time-ordered, safe to combine across databases).
// - Calendar/business dates: 'YYYY-MM-DD' text, no time zone.
// - Record-keeping timestamps: integer milliseconds since the Unix epoch, UTC.
// - Money, prices, quantities and rates: exact decimal strings, never JavaScript numbers.

/** Generates a UUID version 7 (RFC 9562): 48-bit millisecond timestamp, then random bits. */
export function uuidv7(now: number = Date.now(), random: (bytes: Uint8Array) => void = fillRandom): string {
  const bytes = new Uint8Array(16);
  random(bytes);
  let ms = Math.floor(now);
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 9562 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fillRandom(bytes: Uint8Array): void {
  crypto.getRandomValues(bytes);
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuidV7(value: string): boolean {
  return UUID_V7.test(value);
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date in 'YYYY-MM-DD' form (rejects e.g. 2026-02-30). */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return (
    date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d)
  );
}

const DECIMAL = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/**
 * True for a canonical exact decimal string: optional minus, no leading zeros, no exponent,
 * no plus sign, no trailing decimal point. Examples: '0', '12.5', '-0.00125'.
 */
export function isDecimalString(value: string): boolean {
  return DECIMAL.test(value) && value !== '-0';
}

/** Three-letter ISO 4217 currency code, upper case. */
export function isCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

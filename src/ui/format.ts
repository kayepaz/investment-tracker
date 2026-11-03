import { Decimal } from '../money/decimal';

/** Groups the whole part with commas: '1234567.5' → '1,234,567.5'. Uses a real minus sign. */
function group(text: string): string {
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const [whole = '0', fraction] = body.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '−' : ''}${grouped}${fraction !== undefined ? `.${fraction}` : ''}`;
}

function toDecimal(value: Decimal | string): Decimal {
  return typeof value === 'string' ? Decimal.parse(value) : value;
}

/** Money for display: '1,234.56 CAD'. */
export function formatMoney(value: Decimal | string, currency: string): string {
  return `${group(toDecimal(value).toFixed(2))} ${currency}`;
}

/** A signed money amount: '+12.30 CAD' or '−4.00 CAD'. */
export function formatSignedMoney(value: Decimal, currency: string): string {
  const text = formatMoney(value, currency);
  return value.isNegative() || value.isZero() ? text : `+${text}`;
}

/** A quantity or price, keeping its meaningful decimals: '10', '0.00125', '1,500'. */
export function formatNumber(value: Decimal | string, maxDecimals = 6): string {
  const decimal = toDecimal(value);
  const rounded = decimal.scale > maxDecimals ? decimal.round(maxDecimals) : decimal;
  return group(rounded.normalized().toString());
}

/** A percentage with two decimals: '8.14%'. */
export function formatPercent(value: Decimal): string {
  return `${group(value.toFixed(2))}%`;
}

/** Today's date in the user's time zone, as 'YYYY-MM-DD'. */
export function today(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** '2026-11-02' → 'Nov 2, 2026'. */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

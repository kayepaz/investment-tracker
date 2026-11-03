import { expect, type Page } from '@playwright/test';

/** A fixed Bank of Canada answer, so tests don't depend on the network or on today's rates. */
export async function mockBankOfCanada(page: Page) {
  await page.route('https://www.bankofcanada.ca/**', (route) =>
    route.fulfill({
      json: {
        observations: [{ d: '2026-11-02', FXUSDCAD: { v: '1.4000' }, FXEURCAD: { v: '1.5000' } }],
      },
    }),
  );
}

export async function openApp(page: Page) {
  await mockBankOfCanada(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Buckets' })).toBeVisible();
}

export async function tab(page: Page, name: string) {
  await page.locator('nav.tab-bar').getByRole('link', { name }).click();
}

/** Creates an account from the Accounts tab and leaves the browser on its screen. */
export async function createAccount(page: Page, name: string, openingCash?: string) {
  await tab(page, 'Accounts');
  await page.getByRole('link', { name: '+ New account' }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  if (openingCash) await page.getByLabel('Cash in the account').fill(openingCash);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

/** Adds a buy of a new listed security from the account screen. */
export async function buyNewSecurity(
  page: Page,
  opts: { exchange?: string; symbol: string; name: string; quantity: string; price: string; fxRate?: string },
) {
  await page.getByRole('link', { name: '+ Add transaction' }).click();
  await expect(page.getByRole('heading', { name: 'Add transaction' })).toBeVisible();
  // A select's accessible name includes its current choice, so match the label's start.
  const security = page.getByRole('combobox', { name: /^Security/ });
  if ((await security.inputValue()) !== 'new') await security.selectOption('new');
  if (opts.exchange) await page.getByLabel('Exchange').selectOption(opts.exchange);
  await page.getByLabel('Ticker symbol').fill(opts.symbol);
  await page.getByLabel('Name', { exact: true }).fill(opts.name);
  await page.getByLabel('Trade date', { exact: true }).fill('2026-11-02');
  await page.getByLabel('Quantity (units)').fill(opts.quantity);
  await page.getByLabel('Price per unit').fill(opts.price);
  if (opts.fxRate) await page.getByLabel(/exchange rate on the trade date/).fill(opts.fxRate);
  await page.getByRole('button', { name: 'Save transaction' }).click();
  await expect(page.getByRole('heading', { name: 'Add transaction' })).toBeHidden();
}

/** The value of an <option> whose text contains `text`, for selects with indented labels. */
export async function optionValue(page: Page, selectLabel: string, text: string, index = 0) {
  const select = page.getByRole('combobox', { name: new RegExp(`^${selectLabel}`) }).nth(index);
  const value = await select.locator('option', { hasText: text }).first().getAttribute('value');
  if (value === null) throw new Error(`No option "${text}" in ${selectLabel}`);
  return { select, value };
}

/**
 * Fixed Alpha Vantage and Finnhub answers. `limited` symbols get Alpha Vantage's daily-limit notice.
 * Counts requests so tests can check nothing is fetched twice.
 */
export async function mockPriceProviders(page: Page, opts: { limited?: string[] } = {}) {
  const requests: string[] = [];
  const closes: Record<string, string> = { 'XIU.TRT': '55.0000', 'ZAG.TRT': '14.2000', AAPL: '200.00' };
  await page.route('https://www.alphavantage.co/**', (route) => {
    const symbol = new URL(route.request().url()).searchParams.get('symbol') ?? '';
    requests.push(`alphavantage:${symbol}`);
    if (opts.limited?.includes(symbol)) {
      return route.fulfill({ json: { Information: 'Our standard API rate limit is 25 requests per day.' } });
    }
    const close = closes[symbol];
    if (!close) return route.fulfill({ json: { 'Error Message': 'Invalid API call.' } });
    return route.fulfill({
      json: { 'Time Series (Daily)': { '2026-11-02': { '4. close': close }, '2026-10-30': { '4. close': '1.00' } } },
    });
  });
  await page.route('https://finnhub.io/**', (route) => {
    const symbol = new URL(route.request().url()).searchParams.get('symbol') ?? '';
    requests.push(`finnhub:${symbol}`);
    const prices: Record<string, number> = { AAPL: 150 };
    const c = prices[symbol] ?? 0;
    // 2026-11-02 21:00 UTC (4 pm in New York).
    return route.fulfill({ json: { c, t: c ? 1793653200 : 0 } });
  });
  return requests;
}

export async function saveApiKey(page: Page, providerName: string, key: string) {
  await tab(page, 'Settings');
  await page.getByLabel(`${providerName} API key`).fill(key);
  await page.locator('.provider-row', { hasText: providerName }).getByRole('button', { name: 'Save key' }).click();
  await expect(page.getByText(`Key saved (ending …${key.slice(-4)})`)).toBeVisible();
}

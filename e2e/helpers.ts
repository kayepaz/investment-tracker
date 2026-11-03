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
  const security = page.getByLabel('Security', { exact: true });
  if ((await security.inputValue()) !== 'new') await security.selectOption('new');
  if (opts.exchange) await page.getByLabel('Exchange').selectOption(opts.exchange);
  await page.getByLabel('Ticker symbol').fill(opts.symbol);
  await page.getByLabel('Name', { exact: true }).fill(opts.name);
  await page.getByLabel('Trade date').fill('2026-11-02');
  await page.getByLabel('Quantity (units)').fill(opts.quantity);
  await page.getByLabel('Price per unit').fill(opts.price);
  if (opts.fxRate) await page.getByLabel(/exchange rate on the trade date/).fill(opts.fxRate);
  await page.getByRole('button', { name: 'Save transaction' }).click();
  await expect(page.getByRole('heading', { name: 'Add transaction' })).toBeHidden();
}

/** The value of an <option> whose text contains `text`, for selects with indented labels. */
export async function optionValue(page: Page, selectLabel: string, text: string, index = 0) {
  const select = page.getByLabel(selectLabel, { exact: true }).nth(index);
  const value = await select.locator('option', { hasText: text }).first().getAttribute('value');
  if (value === null) throw new Error(`No option "${text}" in ${selectLabel}`);
  return { select, value };
}

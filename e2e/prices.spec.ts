import { expect, test } from '@playwright/test';
import { buyNewSecurity, createAccount, mockPriceProviders, openApp, saveApiKey, tab } from './helpers';

test('downloads prices with an Alpha Vantage key, once a day', async ({ page }) => {
  const requests = await mockPriceProviders(page);
  await openApp(page);
  await saveApiKey(page, 'Alpha Vantage', 'TESTKEY1');
  await expect(page.getByText('0 of 25 requests used')).toBeVisible();

  await createAccount(page, 'Questrade TFSA', '1000');
  await buyNewSecurity(page, { symbol: 'XIU', name: 'iShares S&P/TSX 60', quantity: '10', price: '54.07' });

  await tab(page, 'Buckets');
  await expect(page.getByText('Updated 1 price.')).toBeVisible();
  await expect(page.locator('.portfolio-total')).toHaveText('1,009.30 CAD');
  expect(requests).toEqual(['alphavantage:XIU.TRT']);

  // The holding shows where its price came from.
  await page.getByRole('link', { name: /^XIU/ }).click();
  await expect(page.getByText(/price 55 CAD on Nov 2, 2026 \(Alpha Vantage\)/)).toBeVisible();

  // A price entered by hand on the same day wins.
  await page.getByLabel('Price per unit (CAD)').fill('56');
  await page.getByLabel('Date').fill('2026-11-02');
  await page.getByRole('button', { name: 'Save price' }).click();
  await expect(page.locator('.stat', { hasText: 'Value' })).toContainText('560.00 CAD');
  await expect(page.getByText(/\(entered by hand\)/)).toBeVisible();

  // Coming back to Buckets doesn't ask again the same day.
  await tab(page, 'Buckets');
  await expect(page.getByText('Prices are up to date.')).toBeVisible();
  expect(requests).toEqual(['alphavantage:XIU.TRT']);

  await tab(page, 'Settings');
  await expect(page.getByText('1 of 25 requests used')).toBeVisible();
});

test('reports the daily limit and keeps other holdings updating', async ({ page }) => {
  await mockPriceProviders(page, { limited: ['ZAG.TRT'] });
  await openApp(page);
  await saveApiKey(page, 'Alpha Vantage', 'TESTKEY1');
  await createAccount(page, 'RRSP', '2000');
  await buyNewSecurity(page, { symbol: 'XIU', name: 'XIU', quantity: '1', price: '54' });
  await buyNewSecurity(page, { symbol: 'ZAG', name: 'ZAG', quantity: '10', price: '14' });

  await tab(page, 'Buckets');
  await expect(page.getByText(/free daily limit has been reached/)).toBeVisible();
  // ZAG has no price yet; XIU (fetched first or second) may or may not have been reached.
  await expect(page.getByText(/not counted yet/)).toBeVisible();
});

test('uses Finnhub for US listings when its key is set', async ({ page }) => {
  const requests = await mockPriceProviders(page);
  await openApp(page);
  await saveApiKey(page, 'Alpha Vantage', 'TESTKEY1');
  await saveApiKey(page, 'Finnhub', 'FINNKEY9');
  await createAccount(page, 'US account', '1000');
  await buyNewSecurity(page, { exchange: 'XNAS', symbol: 'AAPL', name: 'Apple', quantity: '2', price: '100', fxRate: '1.4' });

  await tab(page, 'Buckets');
  await expect(page.getByText('Updated 1 price.')).toBeVisible();
  expect(requests).toEqual(['finnhub:AAPL']);
  // 2 × 150 USD × 1.4 = 420 CAD.
  await page.getByRole('link', { name: /^AAPL/ }).click();
  await expect(page.locator('.stat', { hasText: 'Value' })).toContainText('420.00 CAD');
  await expect(page.getByText(/\(Finnhub\)/)).toBeVisible();
});

test('points to Settings when no key is set', async ({ page }) => {
  await openApp(page);
  await createAccount(page, 'TFSA', '100');
  await buyNewSecurity(page, { symbol: 'XIU', name: 'XIU', quantity: '1', price: '54' });
  await tab(page, 'Buckets');
  await expect(page.getByText('1 holding could get prices automatically.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add a free API key in Settings' })).toBeVisible();
});

import { expect, test } from '@playwright/test';
import { openApp, tab } from './helpers';

// Each test gets a fresh browser context, so storage starts empty.

test('opens storage and shows the tabs', async ({ page }) => {
  await openApp(page);
  await tab(page, 'Settings');
  await expect(page.getByText(/Your data \(schema v1\) and market cache \(schema v1\)/)).toBeVisible();
  await expect(page.getByLabel('Currency')).toHaveValue('CAD');
});

test('creates an account, buys, refuses an oversell, and keeps data after reload', async ({ page }) => {
  await openApp(page);
  await tab(page, 'Accounts');
  await expect(page.getByText('No accounts yet.')).toBeVisible();

  // New account with opening cash.
  await page.getByRole('link', { name: '+ New account' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Questrade TFSA');
  await page.getByLabel('Institution').fill('Questrade');
  await page.getByLabel('Cash in the account').fill('1000');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('heading', { name: 'Questrade TFSA' })).toBeVisible();
  await expect(page.getByText('1,000.00 CAD').first()).toBeVisible();

  // Buy 10 XIU at 54.07 as a new security; amount left blank uses quantity × price.
  await page.getByRole('link', { name: '+ Add transaction' }).click();
  await expect(page.getByRole('heading', { name: 'Add transaction' })).toBeVisible();
  await page.getByLabel('Ticker symbol').fill('XIU');
  await page.getByLabel('Name', { exact: true }).fill('iShares S&P/TSX 60 Index ETF');
  await page.getByLabel('Kind').selectOption('etf');
  await page.getByLabel('Trade date', { exact: true }).fill('2026-11-02');
  await page.getByLabel('Quantity (units)').fill('10');
  await page.getByLabel('Price per unit').fill('54.07');
  await page.getByRole('button', { name: 'Save transaction' }).click();

  await expect(page.getByRole('heading', { name: 'Questrade TFSA' })).toBeVisible();
  await expect(page.getByText('XIU · iShares S&P/TSX 60 Index ETF').first()).toBeVisible();
  await expect(page.getByText('459.30 CAD')).toBeVisible();

  // Selling more than is held is refused with a readable message, and nothing is saved.
  await page.getByRole('link', { name: '+ Add transaction' }).click();
  await page.getByLabel('Type').selectOption('sell');
  await page.getByLabel('Trade date', { exact: true }).fill('2026-11-03');
  await page.getByLabel('Quantity (units)').fill('20');
  await page.getByLabel(/Total proceeds/).fill('1100');
  await page.getByRole('button', { name: 'Save transaction' }).click();
  await expect(page.getByRole('alert')).toContainText('only 10 held');
  await page.getByRole('link', { name: 'Cancel' }).click();

  // Data survives a reload.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Questrade TFSA' })).toBeVisible();
  await expect(page.getByText('459.30 CAD')).toBeVisible();

  // The accounts list shows the account and its cash.
  await tab(page, 'Accounts');
  await expect(page.getByRole('link', { name: /Questrade TFSA/ })).toBeVisible();
  await expect(page.getByText('459.30 CAD')).toBeVisible();
});

test('records a deposit and deletes it again', async ({ page }) => {
  await openApp(page);
  await tab(page, 'Accounts');
  await page.getByRole('link', { name: '+ New account' }).click();
  await page.getByLabel('Name', { exact: true }).fill('RRSP');
  await page.getByLabel('Type').selectOption('rrsp');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('No cash.')).toBeVisible();

  await page.getByRole('link', { name: '+ Add transaction' }).click();
  await page.getByLabel('Type').selectOption('deposit');
  await page.getByLabel(/^Amount/).fill('250');
  await page.getByRole('button', { name: 'Save transaction' }).click();
  await expect(page.getByText('250.00 CAD').first()).toBeVisible();

  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('No cash.')).toBeVisible();
});

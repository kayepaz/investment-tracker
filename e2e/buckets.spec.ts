import { expect, test } from '@playwright/test';
import { buyNewSecurity, createAccount, openApp, optionValue, tab } from './helpers';

test('values holdings, nests buckets and moves a holding into one', async ({ page }) => {
  await openApp(page);
  await expect(page.getByText('Nothing to show yet.')).toBeVisible();

  await createAccount(page, 'Questrade TFSA', '1000');
  await buyNewSecurity(page, { symbol: 'XIU', name: 'iShares S&P/TSX 60', quantity: '10', price: '54.07' });

  // Home: cash is counted; XIU has no price yet and is flagged.
  await tab(page, 'Buckets');
  await expect(page.locator('.portfolio-total')).toHaveText('459.30 CAD');
  await expect(page.getByText('1 holding not counted yet')).toBeVisible();
  await expect(page.locator('.tree-row', { hasText: 'Unassigned' })).toBeVisible();

  // Enter a price on the holding screen.
  await page.getByRole('link', { name: /^XIU/ }).click();
  await expect(page.getByRole('heading', { name: 'XIU' })).toBeVisible();
  await page.getByLabel('Price per unit (CAD)').fill('55');
  await page.getByRole('button', { name: 'Save price' }).click();
  await expect(page.getByText('Price saved.')).toBeVisible();
  await expect(page.locator('.stat', { hasText: 'Value' })).toContainText('550.00 CAD');
  await expect(page.locator('.stat', { hasText: 'Change' })).toContainText('+1.72%');

  // Total now includes XIU: 459.30 + 550.00.
  await tab(page, 'Buckets');
  await expect(page.locator('.portfolio-total')).toHaveText('1,009.30 CAD');

  // Create Retirement with TFSA inside it.
  await page.getByRole('link', { name: 'Manage buckets' }).click();
  await page.getByLabel('Name', { exact: true }).first().fill('Retirement');
  await page.getByRole('button', { name: 'Add bucket' }).click();
  await page.getByLabel('Name', { exact: true }).first().fill('TFSA');
  const parent = await optionValue(page, 'Inside', 'Retirement');
  await parent.select.selectOption(parent.value);
  await page.getByRole('button', { name: 'Add bucket' }).click();
  await expect(page.locator('.bucket-edit')).toHaveCount(3);

  // A bucket with sub-buckets can't be deleted.
  const retirementEditor = page.locator('.bucket-edit').filter({ has: page.locator('input[value="Retirement"]') });
  await retirementEditor.getByRole('button', { name: 'Delete' }).click();
  await retirementEditor.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page.getByRole('alert')).toContainText('has sub-buckets');

  // Move XIU into TFSA.
  await tab(page, 'Buckets');
  await page.getByRole('link', { name: /^XIU/ }).click();
  const target = await optionValue(page, 'Move to', 'TFSA');
  await target.select.selectOption(target.value);
  await expect(page.getByText('Moved.')).toBeVisible();

  await tab(page, 'Buckets');
  await expect(page.locator('.tree-row.bucket', { hasText: 'Retirement' })).toContainText('550.00 CAD');
  await expect(page.locator('.tree-row.bucket', { hasText: 'Unassigned' })).toContainText('459.30 CAD');
  // Share of total: 550 / 1009.30.
  await expect(page.locator('.tree-row.bucket', { hasText: 'Retirement' })).toContainText('54.49%');

  // Still there after a reload.
  await page.reload();
  await expect(page.locator('.tree-row.bucket', { hasText: 'Retirement' })).toContainText('550.00 CAD');
});

test('converts US-dollar holdings with Bank of Canada rates', async ({ page }) => {
  await openApp(page);
  await createAccount(page, 'US account', '1000');
  await buyNewSecurity(page, { exchange: 'XNAS', symbol: 'AAPL', name: 'Apple', quantity: '2', price: '100', fxRate: '1.4' });

  await tab(page, 'Buckets');
  await page.getByRole('link', { name: /^AAPL/ }).click();
  await page.getByLabel('Price per unit (USD)').fill('150');
  await page.getByRole('button', { name: 'Save price' }).click();
  // 2 × 150 USD × 1.4 = 420 CAD; change is the USD price movement only.
  await expect(page.locator('.stat', { hasText: 'Value' })).toContainText('420.00 CAD');
  await expect(page.locator('.stat', { hasText: 'Change' })).toContainText('+50.00%');

  await tab(page, 'Buckets');
  await expect(page.getByText('Exchange rates: Bank of Canada')).toBeVisible();
  // 1000 CAD cash + 420 AAPL − 200 USD (280 CAD) taken from USD cash.
  await expect(page.locator('.portfolio-total')).toHaveText('1,140.00 CAD');
});

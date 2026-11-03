import { expect, test, type Page } from '@playwright/test';
import { buyNewSecurity, createAccount, openApp, tab } from './helpers';

/** 1000 CAD account; buys 10 XIU at 54 and prices it at 54: XIU 540, cash 460, total 1000. */
async function setUpPortfolio(page: Page) {
  await openApp(page);
  await createAccount(page, 'Questrade TFSA', '1000');
  await buyNewSecurity(page, { symbol: 'XIU', name: 'iShares S&P/TSX 60', quantity: '10', price: '54' });
  await tab(page, 'Buckets');
  await page.getByRole('link', { name: /^XIU/ }).click();
  await page.getByLabel('Price per unit (CAD)').fill('54');
  await page.getByRole('button', { name: 'Save price' }).click();
  await expect(page.getByText('Price saved.')).toBeVisible();
}

async function newRule(page: Page, setUp: () => Promise<void>) {
  await tab(page, 'Settings');
  await page.getByRole('link', { name: 'Rules', exact: true }).click();
  await page.getByRole('link', { name: '+ New rule' }).click();
  await setUp();
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByRole('heading', { name: 'Rules' })).toBeVisible();
}

test('a concentration limit badges the tree, and warnings can be snoozed and acknowledged', async ({ page }) => {
  await setUpPortfolio(page);
  await newRule(page, async () => {
    await page.getByLabel('Maximum share (%)').fill('50');
  });
  await expect(page.getByText('No single holding over 50%').first()).toBeVisible();

  // XIU is 540 of 1000 = 54%.
  await tab(page, 'Buckets');
  await expect(page.getByRole('link', { name: 'Show all warnings · 1' })).toBeVisible();
  await expect(page.locator('.tree-row.bucket', { hasText: 'Unassigned' }).locator('.warning-badge')).toHaveText('1');
  await expect(page.getByRole('link', { name: /^XIU/ }).locator('.warning-badge')).toHaveText('1');

  // The warnings view lists it; snooze hides it.
  await page.getByRole('link', { name: 'Show all warnings · 1' }).click();
  await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
  await expect(page.getByText('XIU is 54.0% of the portfolio (limit 50%)')).toBeVisible();
  await page.getByRole('button', { name: 'Snooze' }).click();
  await page.getByRole('button', { name: '1 week' }).click();
  await expect(page.getByText('No warnings right now.')).toBeVisible();
  await expect(page.getByText('1 snoozed or acknowledged')).toBeVisible();

  // Show it again, then acknowledge it with a note.
  await page.getByText('1 snoozed or acknowledged').click();
  await page.getByRole('button', { name: 'Show again' }).click();
  await expect(page.getByText('XIU is 54.0% of the portfolio (limit 50%)')).toBeVisible();
  await page.getByRole('button', { name: 'Acknowledge' }).click();
  await page.getByLabel(/^Note/).fill('Fine for now');
  await page.getByRole('button', { name: 'Acknowledge for 30 days' }).click();
  await expect(page.getByText('No warnings right now.')).toBeVisible();

  await tab(page, 'Buckets');
  await expect(page.locator('.portfolio-total')).toHaveText('1,000.00 CAD');
  await expect(page.getByRole('link', { name: /Show all warnings/ })).toHaveCount(0);
  await expect(page.locator('.warning-badge')).toHaveCount(0);
});

test('a portfolio cash floor shows on the header, and a disabled rule stops warning', async ({ page }) => {
  await setUpPortfolio(page);
  await newRule(page, async () => {
    await page.getByRole('combobox', { name: /^Kind of rule/ }).selectOption('cash_floor');
    await page.getByLabel('Minimum cash (%)').fill('50');
  });

  await tab(page, 'Buckets');
  // Cash is 460 of 1000.
  await expect(page.locator('.portfolio-warnings')).toContainText('Cash is 46.0% of the portfolio (minimum 50%)');

  await tab(page, 'Settings');
  await page.getByRole('link', { name: 'Rules', exact: true }).click();
  await page.getByRole('checkbox', { name: 'On' }).uncheck();
  await tab(page, 'Buckets');
  await expect(page.locator('.portfolio-total')).toHaveText('1,000.00 CAD');
  await expect(page.locator('.portfolio-warnings')).toHaveCount(0);
});

test('allocation targets use tags set on the holding', async ({ page }) => {
  await setUpPortfolio(page);
  // Tag XIU as Equity on its screen.
  await page.getByRole('checkbox', { name: 'Equity' }).check();
  await expect(page.getByRole('checkbox', { name: 'Equity' })).toBeChecked();

  await newRule(page, async () => {
    await page.getByRole('combobox', { name: /^Kind of rule/ }).selectOption('allocation');
    await page.getByRole('combobox', { name: /^Tag/ }).selectOption({ label: 'Equity' });
    await page.getByLabel('Target (%)').fill('40');
  });
  await expect(page.getByText('Equity 40%, ± 5 points').first()).toBeVisible();

  await tab(page, 'Buckets');
  await page.getByRole('link', { name: /Show all warnings/ }).click();
  await expect(page.getByText('Equity is 54.0% of the portfolio, above its 40% target (± 5%)')).toBeVisible();
});

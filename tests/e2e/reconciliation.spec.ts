import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { newAdmin, seedReconciliationMonth, signIn } from './helpers';

// A past month's reconciliation (E2): two late payments to a retired wallet, one whose transfer was read on-chain and
// one whose wasn't, and USDT that arrived with no record behind it. The summary, the match list and its filters, and
// both downloads.

const MONTH = '2025-02';
const shots = process.env.SHOTS_DIR;

async function shoot(page: Page, name: string) {
  if (!shots) return;
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((t) => localStorage.setItem('blockcoop-theme', t), theme);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Match list' })).toBeVisible();
    for (const [size, viewport] of [['desktop', { width: 1366, height: 1000 }], ['phone', { width: 390, height: 844 }]] as const) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: `${shots}/${name}-${size}-${theme}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1366, height: 900 });
  }
  await page.evaluate(() => localStorage.removeItem('blockcoop-theme'));
}

test.describe('Reconciliation (E2)', () => {
  test("a month's records are matched against the transfers read on-chain, and saved as CSV and XLSX", async ({ page }) => {
    const seeded = await seedReconciliationMonth(MONTH);
    const admin = await newAdmin(page, ['POOL.READ'], 'Reconciler');
    await signIn(page, admin.email, admin.password);

    // it's in the Pool menu
    await page.goto('/pool/health');
    await page.getByRole('link', { name: 'Reconciliation' }).first().click();
    await expect(page).toHaveURL(/\/pool\/reconciliation$/);
    await page.getByLabel('Month', { exact: true }).fill(MONTH);
    await expect(page).toHaveURL(new RegExp(`month=${MONTH}`));
    await expect(page.getByLabel('Month', { exact: true })).toHaveValue(MONTH);
    // every pool wallet is read past the month's end
    await expect(page.getByText(/something missing on-chain may just not be read yet/)).toHaveCount(0);

    const records = page.getByRole('region', { name: 'What the records say' });
    await expect(records).toContainText('Late payments65.00USDT2 to retired wallets');
    const balances = page.getByRole('table', { name: 'Balances' });
    const usdt = balances.getByRole('row').filter({ hasText: /^USDT/ });
    await expect(usdt.getByRole('cell').nth(2)).toHaveText('47.00 USDT');
    await expect(usdt.getByRole('cell').nth(5)).toHaveText('47.00 USDT');

    const list = page.getByRole('region', { name: 'Match list' });
    const rows = list.getByRole('table', { name: 'Match list' }).getByRole('row');
    // a header and three lines
    await expect(rows).toHaveCount(4);
    await expect(rows.filter({ hasText: `Quote ${seeded.matched.quoteId}` })).toContainText('Matched');
    await expect(rows.filter({ hasText: `Quote ${seeded.missing.quoteId}` })).toContainText('Missing on-chain');
    await shoot(page, 'reconciliation');

    await list.getByRole('button', { name: 'Missing on-chain (1)' }).click();
    await expect(page).toHaveURL(/show=missing_on_chain/);
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText(seeded.missing.quoteId);
    await expect(rows.nth(1)).toContainText('25.00 USDT');
    await list.getByRole('button', { name: 'No record (1)' }).click();
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText(`In from ${seeded.stranger.slice(0, 6)}…${seeded.stranger.slice(-4)}`);
    await expect(rows.nth(1)).toContainText('7.00 USDT');

    const csv = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download CSV' }).click();
    const file = await csv;
    expect(file.suggestedFilename()).toBe(`reconciliation-${MONTH}.csv`);
    const text = readFileSync((await file.path())!, 'utf-8');
    expect(text).toContain(`Reconciliation,${MONTH},Africa/Nairobi`);
    expect(text).toContain('Late payments to retired wallets,2,65,USDT');
    expect(text).toContain(seeded.missing.quoteId);

    const xlsx = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download XLSX' }).click();
    const sheet = await xlsx;
    expect(sheet.suggestedFilename()).toBe(`reconciliation-${MONTH}.xlsx`);
    // a zip, as an XLSX file is
    expect(readFileSync((await sheet.path())!).subarray(0, 2).toString('latin1')).toBe('PK');

    // a month that hasn't happened can't be picked
    await page.goto('/pool/reconciliation');
    await expect(page.getByRole('button', { name: 'Next month' })).toBeDisabled();
  });

  test('without POOL.READ the screen is closed', async ({ page }) => {
    const admin = await newAdmin(page, ['MEMBERS.READ'], 'NoPool');
    await signIn(page, admin.email, admin.password);
    await page.goto('/pool/reconciliation');
    await expect(page.getByRole('link', { name: 'Reconciliation' })).toHaveCount(0);
    await expect(page.getByText(/don't have access|can't open/i).first()).toBeVisible();
  });
});

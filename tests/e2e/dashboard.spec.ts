import { expect, test } from '@playwright/test';
import { newAdmin, newMember, seedGuarantee, signIn, stack } from './helpers';

test.describe('dashboard (Phase D)', () => {
  test('shows what needs attention and the pool, opens each screen, and shows a chart as a table', async ({ page }) => {
    const member = await newMember('Dashboard', 'D' + Array.from({ length: 7 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join(''));
    seedGuarantee(member);
    const { admin } = stack();
    await signIn(page, admin.email, admin.password);
    await expect(page).toHaveURL(/\/dashboard$/);
    for (const section of ['Needs attention', 'Pool health', 'Risk checks', 'Guarantees and money', 'Liquid Funds', 'Premiums and claims, USDT', 'Guarantees by status', 'Backing by asset, USDT value', 'Waiting for approval', 'Open alerts']) {
      await expect(page.getByRole('heading', { name: section, level: 2, exact: true })).toBeVisible();
    }

    // the premiums chart's table: every one of the 12 months, this month first
    const premiums = page.getByRole('region', { name: 'Premiums and claims, USDT' });
    await expect(premiums.getByRole('img', { name: /^Premiums received and claims paid each month/ })).toBeVisible();
    await premiums.getByRole('button', { name: 'Show as a table' }).click();
    const table = premiums.getByRole('table', { name: 'Premiums received and claims paid each month' });
    await expect(table.getByRole('row')).toHaveCount(13);
    const thisMonth = new Date().toLocaleDateString('en-GB', { timeZone: 'Africa/Nairobi', month: 'long', year: 'numeric' });
    await expect(table.getByRole('row').nth(1)).toContainText(thisMonth);
    await premiums.getByRole('button', { name: 'Show the chart' }).click();
    await expect(table).toHaveCount(0);

    // a status opens the guarantees with it
    const statuses = page.getByRole('list', { name: 'Guarantees by status' });
    await expect(statuses.getByRole('button')).toHaveCount(3);
    await statuses.getByRole('button', { name: /^Active/ }).click();
    await expect(page).toHaveURL(/\/guarantees\?status=active$/);

    await page.goto('/dashboard');
    await page.getByRole('link', { name: /^Open alerts/ }).click();
    await expect(page).toHaveURL(/\/alerts$/);
    await page.goto('/dashboard');
    await page.getByRole('link', { name: /^Refused Lipa payments/ }).click();
    await expect(page).toHaveURL(/\/payments\?status=failed&method=lipa&from=\d{4}-\d{2}-\d{2}$/);
  });

  test('shows a narrow role only the parts it can read', async ({ page }) => {
    const narrow = await newAdmin(page, ['REFUNDS.READ'], 'Refunds');
    await signIn(page, narrow.email, narrow.password);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('link', { name: /^Waiting for approval/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Refunds owed/ })).toBeVisible();
    for (const hidden of ['Pool health', 'Risk checks', 'Liquid Funds', 'Guarantees by status', 'Open alerts']) {
      await expect(page.getByRole('heading', { name: hidden, exact: true })).toHaveCount(0);
    }
    for (const hidden of [/^Claims waiting/, /^Refused Lipa payments/, /^Active guarantees/]) await expect(page.getByRole('link', { name: hidden })).toHaveCount(0);
  });

  test("shows a figure without its link when the role can't open the screen behind it", async ({ page }) => {
    const pool = await newAdmin(page, ['POOL.READ'], 'PoolOnly');
    await signIn(page, pool.email, pool.password);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('link', { name: /^Liquid Funds/ })).toBeVisible();
    // payments and guarantees need GUARANTEES.READ, backing needs MEMBERS.READ
    for (const label of ['Premiums this month', 'Outstanding guarantees', 'Total backing']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: new RegExp(`^${label}`) })).toHaveCount(0);
    }
  });
});

import { expect, test, type Page } from '@playwright/test';
import { newAdmin, signIn } from './helpers';

/** Makes every tab's last activity older than the idle time, then has this tab check, as its timer would. */
async function goIdle(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem('blockcoop-admin.activity', String(Date.now() - 6 * 60_000));
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

test.describe('session (D-001)', () => {
  test('locks every tab after the idle time, and signing in returns each tab to its page', async ({ page, context }) => {
    const user = await newAdmin(page, ['MEMBERS.READ', 'POOL.READ'], 'Idle');
    await signIn(page, user.email, user.password);
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/members');

    // a second tab shares the session without signing in
    const other = await context.newPage();
    await other.goto('/pool/health');
    await expect(other.getByRole('heading', { name: 'Pool health' })).toBeVisible();

    await goIdle(page);
    for (const p of [page, other]) await expect(p.getByRole('heading', { name: 'Your session was locked' })).toBeVisible();
    await expect(other).toHaveURL(/\/pool\/health$/);
    await expect(page.getByLabel('Email')).toHaveValue(user.email);
    expect(await page.evaluate(() => localStorage.getItem('blockcoop-admin.session'))).toBeNull();

    await signIn(page, user.email, user.password, { fromLockScreen: true });
    await expect(page.getByRole('heading', { name: 'All members' })).toBeVisible();
    await expect(page).toHaveURL(/\/members$/);
    await expect(other.getByRole('heading', { name: 'Pool health' })).toBeVisible();
  });

  test('a tab opened after the idle time starts locked', async ({ page }) => {
    const user = await newAdmin(page, ['REFUNDS.READ'], 'Late');
    await signIn(page, user.email, user.password);
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.evaluate(() => localStorage.setItem('blockcoop-admin.activity', String(Date.now() - 6 * 60_000)));
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Your session was locked' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign in as someone else' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByLabel('Email')).toHaveValue('');
  });

  test('another admin can sign in from the lock screen, which forgets the lock and its page in every tab', async ({ page, context }) => {
    const first = await newAdmin(page, ['MEMBERS.READ'], 'Locked');
    const second = await newAdmin(page, ['REFUNDS.READ'], 'Other');
    await signIn(page, first.email, first.password);
    await page.goto('/members');
    const other = await context.newPage();
    await other.goto('/members/unknown');
    await goIdle(page);
    for (const p of [page, other]) await expect(p.getByRole('heading', { name: 'Your session was locked' })).toBeVisible();

    const email = page.getByLabel('Email');
    await expect(email).toBeEditable();
    // a wrong password keeps the email editable
    await page.getByLabel('Password').fill('Wrong-password-1!');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(email).toBeEditable();

    await email.fill(second.email);
    await signIn(page, second.email, second.password, { fromLockScreen: true });
    await expect(page).toHaveURL(/\/dashboard$/);
    // the other tab kept the locked admin's record page; it goes to the new admin's first screen too
    await expect(other).toHaveURL(/\/dashboard$/);
    expect(await page.evaluate(() => localStorage.getItem('blockcoop-admin.locked'))).toBeNull();
  });

  test('two tabs refreshing an expired token together stay signed in', async ({ page, context }) => {
    const user = await newAdmin(page, ['ALERTS.READ'], 'Refresh');
    await signIn(page, user.email, user.password);
    await expect(page).toHaveURL(/\/dashboard$/);
    const other = await context.newPage();
    await other.goto('/account');
    await expect(other.getByText(user.email).first()).toBeVisible();

    // expire the access token everywhere, then have both tabs call the API at once
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('blockcoop-admin.session')!);
      localStorage.setItem('blockcoop-admin.session', JSON.stringify({ ...s, tokenExpiry: Date.now() - 1000 }));
    });
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('blockcoop-admin.session')!).refreshToken);
    await Promise.all([page.goto('/account'), other.reload()]);
    for (const p of [page, other]) await expect(p.getByRole('heading', { name: 'Your details' })).toBeVisible();
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('blockcoop-admin.session')!));
    expect(after.refreshToken).not.toBe(before);
    expect(after.tokenExpiry).toBeGreaterThan(Date.now());
  });
});

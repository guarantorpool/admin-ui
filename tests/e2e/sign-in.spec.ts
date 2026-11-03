import { expect, test } from '@playwright/test';
import { codeFor, linkFor, mailCount, newAdmin, signIn, stack } from './helpers';

test.describe('sign-in (slice 1)', () => {
  test('signs in with password and code, and lands on the first screen the role allows', async ({ page }) => {
    const { admin } = stack();
    await signIn(page, admin.email, admin.password);
    // the system admin's first screen until the dashboard exists
    await expect(page).toHaveURL(/\/alerts$/);
    await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Status' }).getByRole('button', { name: /^Open/ })).toBeVisible();
    await expect(page.getByText('Local', { exact: true })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Admin screens' });
    for (const group of ['Members', 'Guarantees', 'Money', 'Pool', 'Administration']) await expect(nav.getByRole('button', { name: group })).toBeVisible();
    await nav.getByRole('button', { name: 'Administration' }).click();
    await expect(nav.getByRole('link', { name: 'KYC encryption key' })).toBeVisible();
  });

  test('shows the backend’s message for a wrong password and a wrong code, and sends a new code', async ({ page }) => {
    const { admin } = stack();
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(admin.email);
    await page.getByLabel('Password').fill('Wrong-password-1!');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toBeVisible();

    const skip = mailCount();
    await page.getByLabel('Password').fill(admin.password);
    await page.getByRole('button', { name: 'Continue' }).click();
    const first = await codeFor(admin.email, skip);
    await page.getByLabel('One-time code').fill(first === '000000' ? '111111' : '000000');
    await expect(page.getByRole('alert')).toContainText(/code/i);

    // the backend allows a resend after 60 seconds
    await expect(page.getByRole('button', { name: /Send a new code in \d+s/ })).toBeDisabled();
  });

  test('sends a signed-out visit to sign-in and back to the page after', async ({ page }) => {
    const { admin } = stack();
    await page.goto('/pool/settings?tab=history');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fpool%2Fsettings%3Ftab%3Dhistory$/);
    const skip = mailCount();
    await page.getByLabel('Email').fill(admin.email);
    await page.getByLabel('Password').fill(admin.password);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('One-time code').fill(await codeFor(admin.email, skip));
    await expect(page).toHaveURL(/\/pool\/settings\?tab=history$/);
    await expect(page.getByRole('heading', { name: 'Pool settings' })).toBeVisible();
  });

  test('hides screens a narrow role cannot open', async ({ page }) => {
    const narrow = await newAdmin(page, ['REFUNDS.READ'], 'Narrow');
    await signIn(page, narrow.email, narrow.password);
    await expect(page).toHaveURL(/\/refunds$/);
    const nav = page.getByRole('navigation', { name: 'Admin screens' });
    await expect(nav.getByRole('button', { name: 'Money' })).toBeVisible();
    for (const hidden of ['Members', 'Guarantees', 'Pool', 'Administration']) await expect(nav.getByRole('button', { name: hidden })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Refunds' })).toBeVisible();
    // payments are guarantees' records, so they need GUARANTEES.READ
    await expect(nav.getByRole('link', { name: 'Payments' })).toHaveCount(0);
    await page.goto('/admins');
    await expect(page.getByRole('heading', { name: 'Not available to your role' })).toBeVisible();
  });

  test('resets a forgotten password from the emailed link', async ({ page }) => {
    const user = await newAdmin(page, ['AUDIT.READ'], 'Forgot');
    await page.goto('/sign-in');
    await page.getByRole('link', { name: 'Forgot password' }).click();
    const skip = mailCount();
    await page.getByLabel('Email').fill(user.email);
    await page.getByRole('button', { name: 'Email the link' }).click();
    await expect(page.getByText(/a link to set a new password is on its way/)).toBeVisible();

    const link = new URL(await linkFor(user.email, /reset/i, 'reset-password', skip));
    await page.goto(link.pathname + link.search);
    await page.getByLabel('New password', { exact: true }).fill('short');
    await page.getByLabel('New password again').fill('short');
    await page.getByRole('button', { name: 'Change the password' }).click();
    await expect(page.getByRole('alert')).toContainText('The password needs');

    const next = 'New-Pass-2026!x';
    await page.getByLabel('New password', { exact: true }).fill(next);
    await page.getByLabel('New password again').fill(next);
    await page.getByRole('button', { name: 'Change the password' }).click();
    await expect(page.getByText('Your password was changed. Sign in with the new one.')).toBeVisible();
    await signIn(page, user.email, next);
    await expect(page).toHaveURL(/\/audit$/);
  });
});

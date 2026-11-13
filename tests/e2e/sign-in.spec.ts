import { expect, test } from '@playwright/test';
import { codeFor, expireLoginCode, mailCount, newAdmin, resetCodeFor, signIn, stack } from './helpers';

test.describe('sign-in (slice 1)', () => {
  test('signs in with password and code, and lands on the dashboard', async ({ page }) => {
    const { admin } = stack();
    await signIn(page, admin.email, admin.password);
    // every admin lands on the dashboard
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
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

  test('replaces an expired code with a new one that works (#34)', async ({ page }) => {
    const user = await newAdmin(page, ['AUDIT.READ'], 'Expired');
    // the resend button's 60-second countdown runs on this clock
    await page.clock.install();
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(user.email);
    const skip = mailCount();
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Continue' }).click();
    const first = await codeFor(user.email, skip);

    expireLoginCode(user.email);
    await page.getByLabel('One-time code').fill(first);
    await expect(page.getByRole('alert')).toContainText('This code has expired');

    await page.clock.fastForward(61_000);
    const again = mailCount();
    await page.getByRole('button', { name: 'Send a new code' }).click();
    await expect(page.getByText('New code sent.')).toBeVisible();
    await page.getByLabel('One-time code').fill(await codeFor(user.email, again));
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('goes back to the password step, email kept, when the login cannot go on (#34)', async ({ page }) => {
    const user = await newAdmin(page, ['AUDIT.READ'], 'Ended');
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(user.email);
    const skip = mailCount();
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Continue' }).click();
    const code = await codeFor(user.email, skip);
    const wrong = code === '000000' ? '111111' : '000000';

    // 5 wrong codes in a row lock the account, which ends this login
    for (let i = 0; i < 4; i++) {
      await page.getByLabel('One-time code').fill(wrong);
      await expect(page.getByRole('alert')).toContainText('The code is incorrect');
      await expect(page.getByLabel('One-time code')).toHaveValue('');
    }
    await page.getByLabel('One-time code').fill(wrong);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Account locked');
    await expect(page.getByLabel('Email')).toHaveValue(user.email);
    await expect(page.getByLabel('Password')).toHaveValue('');
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
    await expect(page).toHaveURL(/\/dashboard$/);
    const nav = page.getByRole('navigation', { name: 'Admin screens' });
    await expect(nav.getByRole('button', { name: 'Money' })).toBeVisible();
    for (const hidden of ['Members', 'Guarantees', 'Pool', 'Administration']) await expect(nav.getByRole('button', { name: hidden })).toHaveCount(0);
    await nav.getByRole('button', { name: 'Money' }).click();
    await expect(nav.getByRole('link', { name: 'Refunds' })).toBeVisible();
    // payments are guarantees' records, so they need GUARANTEES.READ
    await expect(nav.getByRole('link', { name: 'Payments' })).toHaveCount(0);
    await page.goto('/admins');
    await expect(page.getByRole('heading', { name: 'Not available to your role' })).toBeVisible();
  });

  test('resets a forgotten password with the emailed code', async ({ page }) => {
    const user = await newAdmin(page, ['AUDIT.READ'], 'Forgot');
    await page.goto('/sign-in');
    await page.getByRole('link', { name: 'Forgot password' }).click();
    const skip = mailCount();
    await page.getByLabel('Email').fill(user.email);
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await expect(page).toHaveURL(/\/reset-password\?email=/);
    await expect(page.getByText(/a 6-digit code is on its way/)).toBeVisible();
    await expect(page.getByText(/link/i)).toHaveCount(0);
    // the backend allows a new code after 60 seconds
    await expect(page.getByRole('button', { name: /Send a new code in \d+s/ })).toBeDisabled();

    const code = await resetCodeFor(user.email, skip);
    await page.getByLabel('Reset code').fill(code === '000000' ? '111111' : '000000');
    await page.getByLabel('New password', { exact: true }).fill('short');
    await page.getByLabel('New password again').fill('short');
    await page.getByRole('button', { name: 'Change the password' }).click();
    await expect(page.getByRole('alert')).toContainText('The password needs');

    const next = 'New-Pass-2026!x';
    await page.getByLabel('New password', { exact: true }).fill(next);
    await page.getByLabel('New password again').fill(next);
    await page.getByRole('button', { name: 'Change the password' }).click();
    await expect(page.getByRole('alert')).toContainText('This code is invalid or has expired');

    // fill() into the full code boxes only replaces the last digit, so empty them first
    await page.getByLabel('Reset code').clear();
    await page.getByLabel('Reset code').fill(code);
    await page.getByRole('button', { name: 'Change the password' }).click();
    await expect(page.getByText('Your password was changed. Sign in with the new one.')).toBeVisible();
    await signIn(page, user.email, next);
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});

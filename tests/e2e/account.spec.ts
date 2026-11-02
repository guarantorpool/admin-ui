import { expect, test } from '@playwright/test';
import { newAdmin, signIn } from './helpers';

test.describe('your account (slice 1)', () => {
  test('updates your name and phone, shown in the top bar', async ({ page }) => {
    const user = await newAdmin(page, ['AUDIT.READ'], 'Profile');
    await signIn(page, user.email, user.password);
    await page.getByRole('button', { name: /Your account menu/ }).click();
    await page.getByRole('menuitem', { name: 'Your account' }).click();
    await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible();

    await page.getByRole('button', { name: 'Update' }).click();
    await page.getByLabel('First name').fill('Wanjiru');
    await page.getByLabel('Phone number').fill('not a phone');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Kenyan mobile number');
    await page.getByLabel('Phone number').fill('+254722000111');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Your details were saved.')).toBeVisible();
    await expect(page.getByText('Wanjiru Profile')).toBeVisible();
    await expect(page.getByText('+254722000111')).toBeVisible();
    await expect(page.getByRole('button', { name: /Your account menu, Wanjiru/ })).toBeVisible();
  });

  test('changing the password ends the session; the new one signs in', async ({ page }) => {
    const user = await newAdmin(page, ['AUDIT.READ'], 'Change');
    await signIn(page, user.email, user.password);
    await page.goto('/account?tab=security');
    await page.getByRole('button', { name: 'Change', exact: true }).click();
    await page.getByLabel('Current password').fill(user.password);
    const next = 'Changed-Pass-9!';
    await page.getByLabel('New password', { exact: true }).fill(next);
    await page.getByLabel('New password again').fill(next);
    await page.getByRole('button', { name: 'Change the password' }).click();
    await expect(page.getByText(/Your password was changed and every session ended/)).toBeVisible();
    await signIn(page, user.email, next);
    await expect(page).toHaveURL(/\/audit$/);
  });

  test('sign out everywhere signs out the other tabs too', async ({ page, context }) => {
    const user = await newAdmin(page, ['AUDIT.READ'], 'Everywhere');
    await signIn(page, user.email, user.password);
    const other = await context.newPage();
    await other.goto('/audit');
    await expect(other.getByRole('heading', { name: 'Audit log' })).toBeVisible();

    await page.goto('/account?tab=security');
    await page.getByRole('button', { name: 'Sign out of every session' }).click();
    await page.getByRole('button', { name: 'Sign out everywhere' }).click();
    await expect(page.getByText('You signed out of every session.')).toBeVisible();
    await expect(other).toHaveURL(/\/sign-in\?next=%2Faudit$/);
  });

  test('sign out from the account menu', async ({ page }) => {
    const user = await newAdmin(page, ['AUDIT.READ'], 'Out');
    await signIn(page, user.email, user.password);
    await page.getByRole('button', { name: /Your account menu/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page.getByText('You signed out.')).toBeVisible();
    await page.goto('/audit');
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('phone layout: the menu opens as a panel @phone', async ({ page }) => {
    const user = await newAdmin(page, ['MEMBERS.READ'], 'Phone');
    await signIn(page, user.email, user.password);
    const nav = page.getByRole('navigation', { name: 'Admin screens' });
    await expect(nav).toHaveCount(0);
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(nav).toBeVisible();
    await nav.getByRole('button', { name: 'Pool' }).click();
    await nav.getByRole('link', { name: 'Backing assets and prices' }).click();
    await expect(nav).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Backing assets and prices' })).toBeVisible();
    await page.getByRole('button', { name: /Your account menu/ }).click();
    await expect(page.getByRole('menuitem', { name: /Dark mode|Light mode/ })).toBeVisible();
  });
});

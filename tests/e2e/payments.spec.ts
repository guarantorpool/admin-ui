import { expect, test } from '@playwright/test';
import { newAdmin, newMember, seedGuarantee, seedPayment, signIn } from './helpers';

// Payments are seeded into the throwaway database (see seedGuarantee): a local run doesn't reach the Lipa API.

const surname = () => 'P' + Array.from({ length: 7 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

test.describe('Payments (B1)', () => {
  test('lists every payment, filters it, and opens one with links to its guarantee and member', async ({ page }) => {
    const member = await newMember('Wanja', surname());
    const g = seedGuarantee(member);
    seedPayment(g, { status: 'FAILED', hoursAgo: 80 });
    const admin = await newAdmin(page, ['GUARANTEES.READ', 'MEMBERS.READ'], 'Payments');
    await signIn(page, admin.email, admin.password);

    const nav = page.getByRole('navigation', { name: 'Admin screens' });
    await nav.getByRole('button', { name: 'Money' }).click();
    await nav.getByRole('link', { name: 'Payments' }).click();
    await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible();
    await expect(page.getByText(/Coming in/)).toHaveCount(0);

    // narrowed to the one guarantee, by part of its ID: its paid payment and the failed attempt before it
    await page.getByRole('textbox', { name: 'Guarantee ID' }).fill(g.guaranteeId.slice(4).toLowerCase());
    await expect(page).toHaveURL(/search=/);
    const rows = page.getByRole('table', { name: 'Payments' }).getByRole('link');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText(member.number);

    await page.getByRole('button', { name: 'Failed', exact: true }).click();
    await expect(page).toHaveURL(/status=failed/);
    await expect(rows).toHaveCount(1);
    await page.getByRole('button', { name: 'Refunded', exact: true }).click();
    await expect(page.getByText('No payments match.')).toBeVisible();
    await page.getByRole('button', { name: 'Paid', exact: true }).click();
    await expect(rows).toHaveCount(1);

    await rows.first().click();
    const panel = page.getByRole('dialog', { name: 'Payment details' });
    await expect(panel.getByRole('link', { name: g.guaranteeId })).toBeVisible();
    await expect(panel.getByRole('link', { name: new RegExp(member.name) })).toBeVisible();
    await expect(panel.getByText('Lipa API')).toBeVisible();
    await expect(panel.getByText(g.txHash)).toBeVisible();

    // the address opens the same payment, and closing keeps the filters
    await page.reload();
    await expect(panel.getByText(g.txHash)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/payments\?.*status=confirmed/);

    await expect(panel).toBeHidden();
    await page.getByRole('button', { name: 'Clear the filters' }).click();
    await expect(page).toHaveURL(/\/payments$/);
  });
});

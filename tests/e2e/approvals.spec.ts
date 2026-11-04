import { expect, test, type Page } from '@playwright/test';
import { apiToken, call, newAdmin, newMember, signIn, stack } from './helpers';

// The inbox gathers what waits on every screen; a backing change stands in for the rest, since every kind is listed
// and decided the same way. Other tests leave their own items waiting, so a test looks for its member's row.

const DECIDE = ['MEMBERS.READ', 'MEMBERS.UPDATE'];

const surname = () => 'A' + Array.from({ length: 7 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

const inbox = (page: Page) => page.getByRole('table', { name: 'Waiting for a second admin' });

test.describe('Approvals inbox (B3)', () => {
  test('one admin enters a change; it is blocked for them, and a second admin approves it from the inbox', async ({ page, browser }) => {
    const member = await newMember('Akinyi', surname());
    const first = await newAdmin(page, DECIDE, 'InboxEntry');
    // the change is entered straight against the API; the Backing screen's own flow is tested in backing.spec
    const token = await apiToken(first.email, first.password);
    await call('PUT', `${stack().apiBase}/members/${member.id}/asset-balances`, { kesDeposits: 2500.5, usdtVaultSavings: 12.25, note: 'From the SACCO ledger' }, token);

    // the admin who entered it sees it, marked as theirs, with no way to decide it
    await signIn(page, first.email, first.password);
    await page.goto('/approvals');
    await expect(page.getByRole('heading', { name: 'Approvals inbox', level: 1 })).toBeVisible();
    await expect(page.getByText(/Coming in/)).toHaveCount(0);
    const mine = inbox(page).getByRole('link', { name: new RegExp(member.number) });
    await expect(mine).toContainText('Entered by you');
    await mine.click();
    const sheet = page.getByRole('dialog', { name: 'Waiting item' });
    await expect(sheet.getByText('You entered this, so a different admin has to approve or reject it.')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await expect(sheet.getByText('From the SACCO ledger')).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Open it on its own screen' })).toHaveAttribute('href', `/backing/${member.id}`);
    // only what they can decide: not their own
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^For you to decide/ }).click();
    await expect(page).toHaveURL(/show=for-you/);
    await expect(inbox(page).getByRole('link', { name: new RegExp(member.number) })).toHaveCount(0);

    // a second admin: the menu badge and the bell count it, and the inbox decides it
    const context = await browser.newContext();
    const second = await context.newPage();
    const approver = await newAdmin(second, DECIDE, 'InboxDecide');
    await signIn(second, approver.email, approver.password);
    const nav = second.getByRole('navigation', { name: 'Admin screens' });
    await expect(nav.getByRole('link', { name: /^Approvals inbox, \d+ waiting for you to decide$/ })).toBeVisible();
    await second.getByRole('button', { name: /^Notifications, .*\d+ waiting for you to decide/ }).click();
    await second.getByRole('menuitem', { name: /Approvals inbox/ }).click();
    await expect(second).toHaveURL(/\/approvals\?show=for-you$/);

    await second.getByRole('combobox', { name: 'Type' }).selectOption('backing_change');
    await expect(second).toHaveURL(/kind=backing_change/);
    const row = inbox(second).getByRole('link', { name: new RegExp(member.number) });
    await expect(row).toContainText('You can decide');
    await expect(row).toContainText(first.email);
    await row.click();
    const panel = second.getByRole('dialog', { name: 'Waiting item' });
    await expect(panel.getByText('Backing change', { exact: true })).toBeVisible();
    // the address opens the same item
    await second.reload();
    await panel.getByRole('button', { name: 'Approve' }).click();
    const confirm = second.getByRole('dialog', { name: 'Approve this backing change?' });
    await confirm.getByLabel('Note (optional)').fill('Checked against the ledger');
    await confirm.getByRole('button', { name: 'Approve' }).click();
    await expect(second.getByText('Backing change approved.')).toBeVisible();
    await expect(panel).toBeHidden();
    await expect(second).toHaveURL(/\/approvals\?show=for-you&kind=backing_change$/);
    await expect(inbox(second).getByRole('link', { name: new RegExp(member.number) })).toHaveCount(0);

    // it took effect on the member
    await second.goto(`/backing/${member.id}`);
    await expect(second.getByRole('region', { name: "Member's backing" })).toContainText('2,500.5 KES');

    // a decided item opened from an old link says so
    await second.goto(`/approvals/backing_change/${member.id}`);
    await expect(second.getByText(/This item isn't waiting any more/)).toBeVisible();
    await context.close();
  });

  test("a role that can read an item but not decide it sees why", async ({ page }) => {
    const member = await newMember('Baraka', surname());
    const { admin } = stack();
    const token = await apiToken(admin.email, admin.password);
    await call('PUT', `${stack().apiBase}/members/${member.id}/asset-balances`, { kesDeposits: 10, usdtVaultSavings: 0 }, token);

    const reader = await newAdmin(page, ['MEMBERS.READ'], 'InboxReader');
    await signIn(page, reader.email, reader.password);
    await page.goto('/approvals');
    const row = inbox(page).getByRole('link', { name: new RegExp(member.number) });
    await expect(row).toContainText("Your role can't decide");
    await row.click();
    const sheet = page.getByRole('dialog', { name: 'Waiting item' });
    await expect(sheet.getByText("Your role can read this but can't approve or reject it.")).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    // nothing for them to decide, so no badge
    await page.keyboard.press('Escape');
    await expect(page.getByRole('navigation', { name: 'Admin screens' }).getByRole('link', { name: 'Approvals inbox', exact: true })).toBeVisible();
  });
});

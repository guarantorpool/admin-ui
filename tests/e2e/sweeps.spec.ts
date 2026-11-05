import { expect, test, type Page } from '@playwright/test';
import { chainBalances, chainSweep, currentWallet, newAdmin, newMember, seedLatePayment, seedQuote, seedRetiredWallet, signIn } from './helpers';

// A retired wallet, two Lipa payments that reached it after its watch ended, and a sweep that moves the older one's
// USDT: one admin records it, a different one approves it, and the older payment is then owed back as a refund.

const sheet = (page: Page) => page.getByRole('dialog', { name: 'Pool wallet details' });
const sweepSheet = (page: Page) => page.getByRole('dialog', { name: 'Sweep details' });

test.describe('Sweeps of retired wallets (E1)', () => {
  test('one admin records a sweep, a second approves it, and the late payment it moved is owed back', async ({ page, browser }) => {
    const current = currentWallet();
    const retired = seedRetiredWallet();
    const member = await newMember('Late', 'Payer');
    const older = seedQuote(member, { status: 'EXPIRED', quotedDaysAgo: 3 });
    const newer = seedQuote(member, { status: 'EXPIRED', quotedDaysAgo: 2 });
    seedLatePayment(retired.id, older, '40');
    seedLatePayment(retired.id, newer, '60');
    await chainBalances(retired.address, '100', '3.5');

    const sweeper = await newAdmin(page, ['POOL.READ', 'WALLETS.SWEEP'], 'Sweeper');
    await signIn(page, sweeper.email, sweeper.password);
    await page.goto(`/pool/wallets/${retired.id}`);
    const holds = sheet(page).getByRole('region', { name: 'What it holds' });
    await expect(holds).toContainText('100');
    await expect(holds).toContainText('3.5');
    const late = sheet(page).getByRole('list', { name: 'Late payments' }).getByRole('listitem');
    await expect(late).toHaveCount(2);
    await expect(late.filter({ hasText: older.quoteId })).toContainText('Waiting for a sweep');

    // what it moved is read from the transaction, not typed in
    await holds.getByRole('button', { name: 'Record a sweep' }).click();
    const dialog = page.getByRole('dialog', { name: 'Record a sweep' });
    await dialog.getByLabel('Transaction hash').fill('0x1234');
    await dialog.getByRole('button', { name: 'Record the sweep' }).click();
    await expect(dialog.getByText(/^Enter the transaction hash/)).toBeVisible();
    // 40 USDT covers the older payment only
    const tx = await chainSweep(retired.address, current, '40', '3.5');
    await dialog.getByLabel('Transaction hash').fill(tx);
    await dialog.getByLabel('Note (optional)').fill('Swept by the board');
    await dialog.getByRole('button', { name: 'Record the sweep' }).click();
    await expect(page.getByText('Sweep recorded. A second admin approves it.')).toBeVisible();
    await expect(holds.getByText('A sweep of this wallet is waiting for approval.')).toBeVisible();
    const mine = sheet(page).getByRole('list', { name: 'Sweeps of this wallet' }).getByRole('listitem');
    await expect(mine).toContainText('40.00 USDT and 3.5 BLOCKS');
    await expect(mine).toContainText('Waiting for approval');

    // the recorder can't approve it
    await mine.getByRole('link').click();
    await expect(page).toHaveURL(/\/pool\/sweeps\//);
    await expect(sweepSheet(page).getByText('Waiting for approval. Recorded by you')).toBeVisible();
    await expect(sweepSheet(page).getByRole('button', { name: 'Approve' })).toHaveCount(0);
    const sweepUrl = new URL(page.url()).pathname;

    const other = await browser.newPage();
    const approver = await newAdmin(other, ['POOL.READ', 'WALLETS.APPROVE', 'REFUNDS.READ'], 'SweepApprover');
    await signIn(other, approver.email, approver.password);
    // it waits in the inbox, which opens it on its own screen
    await other.goto('/approvals?kind=pool_wallet_sweep');
    await expect(other.getByRole('link').filter({ hasText: 'Sweep of a retired wallet' }).first()).toBeVisible();
    await other.goto(sweepUrl);
    // behind the drawer, hidden from assistive tech, the Sweeps tab is the one open
    await expect(other.locator('#wallets-tab-sweeps')).toHaveAttribute('aria-selected', 'true');
    await sweepSheet(other).getByRole('button', { name: 'Approve' }).click();
    const approve = other.getByRole('dialog', { name: 'Approve this sweep?' });
    await expect(approve).toContainText('40.00 USDT and 3.5 BLOCKS');
    await approve.getByRole('button', { name: 'Approve' }).click();
    await expect(other.getByText('Sweep approved.')).toBeVisible();
    await expect(sweepSheet(other)).toContainText(`Approved by${approver.email}`);

    // the older payment is owed back, with a link to its refund; the newer one waits for the next sweep
    await other.goto(`/pool/wallets/${retired.id}`);
    const after = sheet(other).getByRole('list', { name: 'Late payments' }).getByRole('listitem');
    await expect(after.filter({ hasText: older.quoteId })).toContainText('Refund owed');
    await expect(after.filter({ hasText: newer.quoteId })).toContainText('Waiting for a sweep');
    await after.filter({ hasText: older.quoteId }).getByRole('link', { name: 'Its refund' }).click();
    await expect(other).toHaveURL(/\/refunds\//);
    await expect(other.getByText(/went to a retired pool wallet after its watch ended/).first()).toBeVisible();
    await other.close();
  });

  test('a role without WALLETS.SWEEP sees a retired wallet but no way to record a sweep', async ({ page }) => {
    const retired = seedRetiredWallet();
    const reader = await newAdmin(page, ['POOL.READ'], 'WalletReader');
    await signIn(page, reader.email, reader.password);
    await page.goto(`/pool/wallets/${retired.id}`);
    const holds = sheet(page).getByRole('region', { name: 'What it holds' });
    // the stand-in chain holds nothing for it, so its holdings can't be read
    await expect(holds.getByText("The chain couldn't be read")).toBeVisible();
    await expect(holds.getByRole('button', { name: 'Record a sweep' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('tab', { name: /Sweeps/ }).click();
    await expect(page).toHaveURL(/view=sweeps/);
  });
});

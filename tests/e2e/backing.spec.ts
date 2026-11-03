import { expect, test, type Page } from '@playwright/test';
import { newAdmin, newMember, signIn } from './helpers';

const ENTER = ['MEMBERS.READ', 'MEMBERS.UPDATE', 'PARAMETERS.READ'];

/** A surname no other test's member has, so a search finds only this member (letters only, as names must be). */
const surname = () => 'B' + Array.from({ length: 7 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

const backing = (page: Page) => page.getByRole('region', { name: "Member's backing" });
const prices = (page: Page) => page.getByRole('region', { name: 'Prices and haircuts' });

test.describe('Backing assets and prices (slice 9)', () => {
  test('one admin enters KES deposits and vault savings, and a second admin approves them', async ({ page, browser }) => {
    const last = surname();
    const member = await newMember('Wanjiru', last);
    const first = await newAdmin(page, ENTER, 'BackingEntry');
    await signIn(page, first.email, first.password);
    await page.goto('/backing');
    await expect(page.getByRole('heading', { name: 'Backing assets and prices', level: 1 })).toBeVisible();
    // no member open: the haircuts from the pool settings, and the prices once a member is open
    await expect(prices(page).getByText('Locked BLOCKS count at')).toBeVisible();
    await expect(prices(page).getByText(/The BLOCKS price and KES rate show once a member is open/)).toBeVisible();
    await expect(page.getByText('Planned: one list of backing changes waiting for approval across all members.')).toBeVisible();

    await page.getByRole('searchbox', { name: 'Find a member' }).fill(last);
    await page.getByRole('list', { name: 'Matching members' }).getByRole('button', { name: new RegExp(`Wanjiru ${last}`) }).click();
    await expect(page).toHaveURL(new RegExp(`/backing/${member.id}$`));
    await expect(backing(page).getByRole('heading', { name: new RegExp(`Wanjiru ${last}`) })).toBeVisible();
    await expect(backing(page).getByText('Never set')).toBeVisible();
    await expect(prices(page).getByText('BLOCKS price', { exact: true })).toBeVisible();

    await backing(page).getByRole('button', { name: 'Enter new amounts' }).click();
    const dialog = page.getByRole('dialog', { name: 'Enter new KES deposits and vault savings' });
    // it opens with the amounts in force
    await expect(dialog.getByLabel('KES non-withdrawable deposits')).toHaveValue('0');
    const enter = dialog.getByRole('button', { name: 'Enter the amounts' });
    await enter.click();
    await expect(dialog.getByText('Both amounts are the ones in force now. Change at least one.')).toBeVisible();
    await dialog.getByLabel('KES non-withdrawable deposits').fill('12,500');
    await enter.click();
    await expect(dialog.getByText(/^KES deposits: Enter a number of 0 or more/)).toBeVisible();
    await dialog.getByLabel('KES non-withdrawable deposits').fill('12500.75');
    await dialog.getByLabel('USDT vault savings').fill('40.123456');
    await dialog.getByLabel('Note (optional)').fill('From the sacco statement');
    await enter.click();
    await expect(page.getByText('Amounts entered. A second admin approves them.')).toBeVisible();

    const waiting = backing(page).getByRole('region', { name: 'Waiting for approval' });
    await expect(waiting).toContainText('KES deposits 12,500.75 KES and vault savings 40.123456 USDT, entered by you');
    await expect(waiting).toContainText('Note: From the sacco statement');
    await expect(waiting.getByText('You entered it, so a different admin approves or rejects it.')).toBeVisible();
    await expect(waiting.getByRole('button', { name: 'Approve' })).toBeDisabled();
    await expect(backing(page).getByRole('button', { name: 'Enter new amounts' })).toBeDisabled();
    // nothing counts until it's approved
    await expect(backing(page).getByText('Never set')).toBeVisible();

    const other = await browser.newPage();
    const second = await newAdmin(other, ENTER, 'BackingApprover');
    await signIn(other, second.email, second.password);
    // the member's own Backing tab has the same actions
    await other.goto(`/members/${member.id}?tab=backing`);
    const panel = other.getByRole('dialog', { name: 'Member details' });
    await expect(panel.getByText(`entered by ${first.email}`)).toBeVisible();
    await panel.getByRole('button', { name: 'Approve' }).click();
    const approve = other.getByRole('dialog', { name: 'Approve this backing change?' });
    await expect(approve.getByText('0 KES → 12,500.75 KES')).toBeVisible();
    await expect(approve.getByText('From the sacco statement')).toBeVisible();
    await approve.getByRole('button', { name: 'Approve' }).click();
    await expect(other.getByText('The new KES deposits and vault savings count from now on.')).toBeVisible();
    await expect(panel.getByText(`entered by ${first.email}`)).toBeVisible();
    await expect(panel.getByText('12,500.75 KES →')).toBeVisible();
    await expect(panel.getByRole('region', { name: 'Waiting for approval' })).toHaveCount(0);

    // a second change, rejected
    await panel.getByRole('button', { name: 'Enter new amounts' }).click();
    const again = other.getByRole('dialog', { name: 'Enter new KES deposits and vault savings' });
    await expect(again.getByLabel('KES non-withdrawable deposits')).toHaveValue('12500.75');
    await again.getByLabel('USDT vault savings').fill('0');
    await again.getByRole('button', { name: 'Enter the amounts' }).click();
    await expect(other.getByText('Amounts entered. A second admin approves them.')).toBeVisible();
    await other.close();

    await page.reload();
    await waiting.getByRole('button', { name: 'Reject' }).click();
    const reject = page.getByRole('dialog', { name: 'Reject this backing change?' });
    await expect(reject.getByText('40.123456 USDT → 0.00 USDT')).toBeVisible();
    await reject.getByRole('button', { name: 'Reject' }).click();
    await expect(page.getByText('Backing change rejected.')).toBeVisible();
    await expect(waiting).toHaveCount(0);
    await expect(backing(page).getByText('40.123456 USDT →')).toBeVisible();
  });

  test('a read-only role sees the backing but not the actions', async ({ page }) => {
    const member = await newMember('Otieno', surname());
    const reader = await newAdmin(page, ['MEMBERS.READ'], 'BackingReader');
    await signIn(page, reader.email, reader.password);
    await page.goto(`/backing/${member.id}`);
    await expect(backing(page).getByText('Never set')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enter new amounts' })).toHaveCount(0);
    await expect(prices(page).getByRole('link', { name: 'Change the haircuts' })).toHaveCount(0);
    await expect(prices(page).getByText('Vault savings count at')).toBeVisible();
  });
});

import { expect, test, type Page } from '@playwright/test';
import { newAdmin, newMember, seedGuarantee, seedQuote, signIn } from './helpers';

// Guarantees and quotes are seeded into the throwaway database (see seedQuote): a local run reaches neither
// the Lipa API nor the chain that a real one goes through.

const surname = () => 'G' + Array.from({ length: 7 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
const MANAGER = ['GUARANTEES.READ', 'GUARANTEES.MANAGE', 'MEMBERS.READ'];

const details = (page: Page) => page.getByRole('dialog', { name: 'Guarantee details' });

/** Narrows the list to one member through the find box. */
async function chooseMember(page: Page, name: string) {
  await page.getByRole('searchbox', { name: /Find a member/ }).fill(name.split(' ')[1]!);
  await page.getByRole('list', { name: 'Matching members' }).getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByText(`Member: ${name}`)).toBeVisible();
}

test.describe('Guarantees and quotes (slice 4)', () => {
  test('shows a guarantee, its pricing and payments, and a manual close needs a second admin', async ({ page, browser }) => {
    const grace = await newMember('Grace', surname());
    const active = seedGuarantee(grace);
    const flagged = seedGuarantee(grace, { flagged: true });
    const first = await newAdmin(page, MANAGER, 'Closer');
    await signIn(page, first.email, first.password);

    await page.goto('/guarantees');
    await expect(page.getByRole('heading', { name: 'Guarantees and quotes' })).toBeVisible();
    await chooseMember(page, grace.name);
    const rows = page.getByRole('table', { name: 'Guarantees' }).getByRole('link');
    await expect(rows).toHaveCount(2);
    await page.getByRole('button', { name: 'Flagged', exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText(flagged.guaranteeId);
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(rows).toHaveCount(2);

    // part of an ID narrows the list (C1), the other kind's prefix searches nothing, and an exact ID opens it
    const find = page.getByRole('searchbox', { name: /Find a member/ });
    await find.fill('gpq-');
    await expect(page.getByText("That's a quote ID.", { exact: false })).toBeVisible();
    await expect(rows).toHaveCount(2);
    await find.fill(active.guaranteeId.slice(0, 14).toLowerCase());
    await expect(page.getByText(`Showing guarantees whose ID contains “${active.guaranteeId.slice(0, 14)}”.`)).toBeVisible();
    await expect(page).toHaveURL(/search=/);
    await expect(rows.filter({ hasText: active.guaranteeId })).toHaveCount(1);
    // a filter chosen while the search waits for a pause in typing stays chosen
    await find.fill(active.guaranteeId.slice(0, 13).toLowerCase());
    await page.getByRole('button', { name: 'Flagged', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe(active.guaranteeId.slice(0, 13));
    expect(new URL(page.url()).searchParams.get('status')).toBe('flagged');
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await find.fill(active.guaranteeId.toLowerCase());
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText(active.guaranteeId);
    await find.fill('GPG-0000-');
    await expect(page.getByText('No guarantee ID contains “GPG-0000-” with these filters.')).toBeVisible();
    await find.fill(active.guaranteeId.toLowerCase());
    await page.keyboard.press('Enter');
    const panel = details(page);
    await expect(panel.getByRole('heading', { name: active.guaranteeId })).toBeVisible();
    await expect(panel.getByRole('link', { name: new RegExp(grace.name) })).toBeVisible();
    await expect(panel.getByText('5,000.00 USDT')).toBeVisible();
    await expect(panel.getByText('6 months')).toBeVisible();
    await expect(panel.getByText('144.00 USDT')).toBeVisible();
    await expect(panel.getByText('14.40 USDT', { exact: true })).toBeVisible();
    await expect(panel.getByText('1 BLOCKS = 0.0412 USDT')).toBeVisible();

    await panel.getByRole('tab', { name: 'Pricing trail' }).click();
    await expect(page).toHaveURL(/tab=pricing/);
    await expect(panel.getByText('Expected loss (EL)')).toBeVisible();
    await expect(panel.getByText('192.00 USDT')).toBeVisible();
    await expect(panel.getByText('6.4%')).toBeVisible();

    await panel.getByRole('tab', { name: 'Payment attempts' }).click();
    const attempt = panel.getByRole('list', { name: 'Payment attempts' }).getByRole('listitem');
    await expect(attempt).toContainText('Lipa API');
    await expect(attempt).toContainText('Paid');
    await expect(attempt).toContainText(active.txHash);

    // the first admin enters the close, with a reason
    await panel.getByRole('tab', { name: 'Overview' }).click();
    await panel.getByRole('button', { name: 'Enter a manual close' }).click();
    const enter = page.getByRole('dialog', { name: 'Enter a manual close' });
    await enter.getByRole('button', { name: 'Enter the close' }).click();
    await expect(enter.getByText('Enter the reason for the close.')).toBeVisible();
    await enter.getByLabel('Reason').fill('The lender confirmed the loan was never drawn');
    await enter.getByRole('button', { name: 'Enter the close' }).click();
    await expect(page.getByText(`Close of ${active.guaranteeId} entered. A second admin approves it.`)).toBeVisible();
    await expect(panel.getByText(/Entered by you/)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Approve' })).toBeDisabled();
    await expect(panel.getByRole('button', { name: 'Enter a manual close' })).toHaveCount(0);

    // a second admin approves it
    const other = await browser.newPage();
    const second = await newAdmin(other, MANAGER, 'Approver');
    await signIn(other, second.email, second.password);
    await other.goto(`/guarantees/${active.guaranteeId}`);
    const theirs = details(other);
    await expect(theirs.getByText(`Entered by ${first.email}`, { exact: false })).toBeVisible();
    await theirs.getByRole('button', { name: 'Approve' }).click();
    await other.getByRole('dialog', { name: 'Approve this close?' }).getByRole('button', { name: 'Approve' }).click();
    await expect(other.getByText(`${active.guaranteeId} is closed.`)).toBeVisible();
    await expect(theirs.getByText('Why it closed')).toBeVisible();
    await expect(theirs.getByText('The lender confirmed the loan was never drawn')).toBeVisible();
    await other.close();
  });

  test('a second admin can reject a close, and the guarantee stays active', async ({ page, browser }) => {
    const sam = await newMember('Sam', surname());
    const g = seedGuarantee(sam);
    const first = await newAdmin(page, MANAGER, 'Enter');
    await signIn(page, first.email, first.password);
    // a search from the address is in the box, and the menu link clears both
    await page.goto(`/guarantees?search=${g.guaranteeId}`);
    const find = page.getByRole('searchbox', { name: /Find a member/ });
    await expect(find).toHaveValue(g.guaranteeId);
    await page.getByRole('navigation', { name: 'Admin screens' }).getByRole('link', { name: 'Guarantees and quotes' }).click();
    await expect(page).toHaveURL(/\/guarantees$/);
    await expect(find).toHaveValue('');
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/guarantees$/);
    await page.goto(`/guarantees/${g.guaranteeId}`);
    await details(page).getByRole('button', { name: 'Enter a manual close' }).click();
    const enter = page.getByRole('dialog', { name: 'Enter a manual close' });
    await enter.getByLabel('Reason').fill('Entered by mistake');
    await enter.getByRole('button', { name: 'Enter the close' }).click();
    await expect(details(page).getByText(/Entered by you/)).toBeVisible();

    const other = await browser.newPage();
    const second = await newAdmin(other, MANAGER, 'Reject');
    await signIn(other, second.email, second.password);
    await other.goto(`/guarantees/${g.guaranteeId}`);
    await details(other).getByRole('button', { name: 'Reject' }).click();
    const reject = other.getByRole('dialog', { name: 'Reject this close?' });
    await reject.getByLabel('Note (optional)').fill('The loan is still running');
    await reject.getByRole('button', { name: 'Reject' }).click();
    await expect(other.getByText(`Close of ${g.guaranteeId} rejected. It stays active.`)).toBeVisible();
    await expect(details(other).getByRole('button', { name: 'Enter a manual close' })).toBeVisible();
    await other.close();
  });

  test('lists quotes and shows one with its invoice, its Lipa payment and the guarantee it created', async ({ page }) => {
    const peter = await newMember('Peter', surname());
    const paid = seedGuarantee(peter);
    const failed = seedQuote(peter, { flagged: true, lipa: { status: 'FAILED', message: 'Payment failed, please try again.' } });
    seedQuote(peter, { status: 'EXPIRED', quotedDaysAgo: 5 });
    const user = await newAdmin(page, ['GUARANTEES.READ', 'MEMBERS.READ'], 'Quotes');
    await signIn(page, user.email, user.password);

    await page.goto(`/members/${peter.id}?tab=guarantees`);
    await page.getByRole('link', { name: 'See their quotes' }).click();
    await expect(page).toHaveURL(new RegExp(`/guarantees/quotes\\?member=${peter.id}$`));
    await expect(page.getByText(`Member: ${peter.name}`)).toBeVisible();
    const rows = page.getByRole('table', { name: 'Quotes' }).getByRole('link');
    await expect(rows).toHaveCount(3);
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText(failed.quoteId);
    await expect(rows).toContainText('95.04 USDT');
    await expect(rows).toContainText('Flagged');
    // a quote found by part of its ID
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.getByRole('searchbox', { name: /Find a member/ }).fill(failed.quoteId.slice(0, 8).toLowerCase());
    await expect(page).toHaveURL(/search=GPQ-/);
    await expect(rows.filter({ hasText: failed.quoteId })).toHaveCount(1);
    await page.getByRole('searchbox', { name: /Find a member/ }).fill('');
    await expect(rows).toHaveCount(3);
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(rows).toHaveCount(1);

    await rows.click();
    const panel = page.getByRole('dialog', { name: 'Quote details' });
    await expect(panel.getByRole('heading', { name: failed.quoteId })).toBeVisible();
    await expect(panel.getByText('Yes, premium below expected loss')).toBeVisible();
    await panel.getByRole('tab', { name: 'Latest Lipa API payment' }).click();
    await expect(panel.getByText('Failed', { exact: true })).toBeVisible();
    await expect(panel.getByText('Payment failed, please try again.')).toBeVisible();
    await panel.getByRole('tab', { name: 'Pricing trail and invoice' }).click();
    await expect(panel.getByText('95.04 USDT')).toBeVisible();
    await expect(panel.getByText('8.64 USDT')).toBeVisible();
    await expect(panel.getByText('0.9, below 1: flagged for review')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Paid', exact: true }).click();
    await expect(rows).toContainText(paid.quoteId);
    await rows.click();
    await expect(panel.getByText(paid.guaranteeId, { exact: true })).toBeVisible();
    await panel.getByRole('link', { name: 'Open the guarantee it created' }).click();
    await expect(page).toHaveURL(new RegExp(`/guarantees/${paid.guaranteeId}$`));
    // a role without GUARANTEES.MANAGE sees no close
    await expect(details(page).getByRole('heading', { name: paid.guaranteeId })).toBeVisible();
    await expect(details(page).getByRole('button', { name: 'Enter a manual close' })).toHaveCount(0);
  });

  test('is closed to a role without GUARANTEES.READ', async ({ page }) => {
    const user = await newAdmin(page, ['MEMBERS.READ'], 'NoGuarantees');
    await signIn(page, user.email, user.password);
    await expect(page.getByRole('link', { name: 'Guarantees and quotes' })).toHaveCount(0);
    await page.goto('/guarantees');
    await expect(page.getByRole('heading', { name: 'Not available to your role' })).toBeVisible();
  });
});

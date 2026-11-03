import { expect, test, type Page } from '@playwright/test';
import { newAdmin, newMember, seedGuarantee, seedQuote, seedRefund, signIn } from './helpers';

// Refunds are seeded into the throwaway database (see seedRefund): a local run never has the Lipa API pay the
// pool too much, too late or for nothing.

const surname = () => 'R' + Array.from({ length: 7 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
const MANAGER = ['REFUNDS.READ', 'REFUNDS.MANAGE', 'MEMBERS.READ', 'GUARANTEES.READ'];

const details = (page: Page) => page.getByRole('dialog', { name: 'Refund details' });
// the date paid is entered as a day in Nairobi
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** The first admin records a payout on the open refund. */
async function enterPayout(page: Page, reference: string) {
  await details(page).getByRole('button', { name: 'Record the payout' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record how the refund was paid' });
  await dialog.getByLabel('Reference').fill(reference);
  await dialog.getByLabel('Date paid').fill(today());
  await dialog.getByRole('button', { name: 'Enter the payout' }).click();
  await expect(page.getByText('Payout entered. A second admin approves it.')).toBeVisible();
}

test.describe('Refunds (slice 5)', () => {
  test('lists refunds by status and type, and a payout needs a second admin to approve it', async ({ page, browser }) => {
    const mary = await newMember('Mary', surname());
    const g = seedGuarantee(mary);
    const over = seedRefund({ paymentId: g.paymentId }, { type: 'overpayment', amount: '12.345678' });
    seedRefund({ paymentId: g.paymentId }, { type: 'stray_payment', status: 'PAID', daysAgo: 2 });
    const late = seedQuote(mary, { status: 'EXPIRED' });
    seedRefund({ quote: late }, { type: 'window_lapsed', amount: '158.4' });
    const first = await newAdmin(page, MANAGER, 'Payer');
    await signIn(page, first.email, first.password);

    // the refunds on one payment, as the guarantee's payment attempts link to them
    await page.goto(`/refunds?payment=${g.paymentId}`);
    await expect(page.getByRole('heading', { name: 'Refunds' })).toBeVisible();
    await expect(page.getByText('Nothing is refunded automatically.', { exact: false })).toBeVisible();
    const rows = page.getByRole('table', { name: 'Refunds' }).getByRole('link');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText(g.guaranteeId);
    await expect(rows.first()).toContainText('12.35 USDT');
    await expect(rows.first()).toContainText(`${mary.name}, ${mary.number}`);
    await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Paid', exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('stray_payment');
    await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'All', exact: true }).click();
    await page.getByLabel('Type').selectOption('overpayment');
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('Owed');

    // every payment, and a refund owed on a quote that never became a guarantee
    await page.getByRole('button', { name: 'Show refunds on every payment' }).click();
    await page.getByLabel('Type').selectOption('window_lapsed');
    await expect(rows.filter({ hasText: late.quoteId })).toHaveCount(1);
    await rows.filter({ hasText: late.quoteId }).click();
    await expect(details(page).getByRole('heading', { name: `Owed on ${late.quoteId}` })).toBeVisible();
    await expect(details(page).getByText('The USDT arrived after the quote ended.')).toBeVisible();
    await expect(details(page).getByRole('link', { name: late.quoteId })).toBeVisible();

    // the overpayment, at full precision
    await page.goto(`/refunds/${over}?payment=${g.paymentId}`);
    const panel = details(page);
    await expect(panel.getByRole('heading', { name: `Owed on ${g.guaranteeId}` })).toBeVisible();
    await expect(panel.getByText('More than the amount due arrived. The extra is owed back.')).toBeVisible();
    await expect(panel.getByRole('link', { name: `${mary.name}, ${mary.number}` })).toBeVisible();
    await expect(panel.getByText('12.345678 USDT')).toBeVisible();

    await panel.getByRole('button', { name: 'Record the payout' }).click();
    const dialog = page.getByRole('dialog', { name: 'Record how the refund was paid' });
    await expect(dialog.getByText('Refunds are paid back in USDT.', { exact: false })).toBeVisible();
    await expect(dialog.getByText('12.345678 USDT')).toBeVisible();
    await dialog.getByRole('button', { name: 'Enter the payout' }).click();
    await expect(dialog.getByText('Enter the reference and the date.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await enterPayout(page, '0xabc123refund');
    await expect(panel.getByText(/Payout entered by you/)).toBeVisible();
    await expect(panel.getByText('0xabc123refund')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Approve' })).toBeDisabled();
    await expect(panel.getByText('You entered it, so a different admin approves or rejects it.')).toBeVisible();

    // a second admin approves it
    const other = await browser.newPage();
    const second = await newAdmin(other, MANAGER, 'PayApprover');
    await signIn(other, second.email, second.password);
    await other.goto(`/refunds/${over}?payment=${g.paymentId}`);
    const theirs = details(other);
    await expect(theirs.getByText(`Payout entered by ${first.email}`, { exact: false })).toBeVisible();
    await theirs.getByRole('button', { name: 'Approve' }).click();
    const approve = other.getByRole('dialog', { name: 'Approve this payout?' });
    await expect(approve.getByText('0xabc123refund')).toBeVisible();
    await approve.getByRole('button', { name: 'Approve' }).click();
    await expect(other.getByText(`Refund on ${g.guaranteeId} is paid.`)).toBeVisible();
    await expect(theirs.getByText(`Paid. Approved by ${second.email}`, { exact: false })).toBeVisible();
    await expect(theirs.getByRole('button', { name: 'Record the payout' })).toHaveCount(0);
    await other.close();
  });

  test('a rejected payout leaves the refund owed, with why', async ({ page, browser }) => {
    const tom = await newMember('Tom', surname());
    const g = seedGuarantee(tom);
    const refund = seedRefund({ paymentId: g.paymentId }, { type: 'capacity_changed', amount: '158.4' });
    const first = await newAdmin(page, MANAGER, 'PayEnter');
    await signIn(page, first.email, first.password);
    // a link to a refund opens it, though it isn't on the list as filtered
    await page.goto(`/refunds/${refund}?status=paid`);
    await expect(details(page).getByText('The USDT arrived, but the pool had no capacity left for the guarantee.')).toBeVisible();
    await enterPayout(page, 'wrong-wallet-ref');

    const other = await browser.newPage();
    const second = await newAdmin(other, MANAGER, 'PayReject');
    await signIn(other, second.email, second.password);
    await other.goto(`/refunds/${refund}?payment=${g.paymentId}`);
    await details(other).getByRole('button', { name: 'Reject' }).click();
    const reject = other.getByRole('dialog', { name: 'Reject this payout?' });
    await reject.getByLabel('Note (optional)').fill('Sent to the wrong wallet');
    await reject.getByRole('button', { name: 'Reject' }).click();
    await expect(other.getByText(`Payout on ${g.guaranteeId} rejected. The refund is owed again.`)).toBeVisible();
    await expect(details(other).getByText('The last payout entered was rejected: Sent to the wrong wallet')).toBeVisible();
    await expect(details(other).getByRole('button', { name: 'Record the payout' })).toBeVisible();
    await other.close();
  });

  test('shows refunds without payouts to a read-only role, and is closed to a role without REFUNDS.READ', async ({ page, browser }) => {
    const ann = await newMember('Ann', surname());
    const g = seedGuarantee(ann);
    const refund = seedRefund({ paymentId: g.paymentId });
    const reader = await newAdmin(page, ['REFUNDS.READ'], 'RefundReader');
    await signIn(page, reader.email, reader.password);
    await page.goto(`/refunds/${refund}?payment=${g.paymentId}`);
    await expect(details(page).getByRole('heading', { name: `Owed on ${g.guaranteeId}` })).toBeVisible();
    // without MEMBERS.READ the member is named but isn't a link, and without GUARANTEES.READ nor is the guarantee
    await expect(details(page).getByText(`${ann.name}, ${ann.number}`)).toBeVisible();
    await expect(details(page).getByRole('link', { name: ann.name })).toHaveCount(0);
    await expect(details(page).getByRole('link', { name: g.guaranteeId })).toHaveCount(0);
    await expect(details(page).getByRole('button', { name: 'Record the payout' })).toHaveCount(0);
    await page.goto('/refunds/00000000-0000-4000-8000-000000000000');
    await expect(details(page).getByText("There's no such refund.")).toBeVisible();

    const other = await browser.newPage();
    const user = await newAdmin(other, ['MEMBERS.READ'], 'NoRefunds');
    await signIn(other, user.email, user.password);
    await expect(other.getByRole('link', { name: 'Refunds' })).toHaveCount(0);
    await other.goto('/refunds');
    await expect(other.getByRole('heading', { name: 'Not available to your role' })).toBeVisible();
    await other.close();
  });
});

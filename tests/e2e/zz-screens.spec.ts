import { test, type Page } from '@playwright/test';
import { apiToken, connect, newMember, post, randomIdNumber, seedDefault, seedGuarantee, seedLoanDocument, seedQuote, seedRefund, signIn, stack, submitAddress, submitKyc, type Member, type SeededGuarantee, type SeededQuote } from './helpers';

// Not a check: screenshots for review, only when SHOTS_DIR is set.
const dir = process.env.SHOTS_DIR;
test.skip(!dir, 'SHOTS_DIR not set');

/** A few connected members, made once for every screenshot run. */
let members: Member[] | null = null;
let guarantees: SeededGuarantee[] = [];
let quotes: SeededQuote[] = [];
let loans: string[] = [];

async function sampleMembers(): Promise<Member[]> {
  if (members) return members;
  const people = [['Amina', 'Wanjiru'], ['Brian', 'Otieno'], ['Grace', 'Achieng'], ['John', 'Kamau']] as const;
  const made: Member[] = [];
  for (const [first, last] of people) made.push(await newMember(first, last));
  const [a, b, c, d] = made as [Member, Member, Member, Member];
  await connect(a, b);
  await connect(c, a, 'MUTUAL_TRUST');
  await connect(a, d);
  await submitKyc(b, { idType: 'national_id', idNumber: randomIdNumber(), dateOfBirth: '1990-02-04', address: 'Kilimani, Nairobi' });
  await submitKyc(c, { idType: 'passport', idNumber: `AK${randomIdNumber()}`, dateOfBirth: '1985-07-19', address: 'Milimani, Kisumu' });
  await submitAddress(b, { latitude: -1.2921, longitude: 36.8219, comment: 'Behind the market, blue gate' });
  guarantees = [seedGuarantee(a), seedGuarantee(c, { flagged: true }), seedGuarantee(d)];
  quotes = [seedQuote(b, { flagged: true, lipa: { status: 'FAILED', message: 'Payment failed, please try again.' } }), seedQuote(d, { lipa: { status: 'PROCESSING' } }), seedQuote(c, { status: 'EXPIRED', quotedDaysAgo: 4 })];
  seedRefund({ paymentId: guarantees[1]!.paymentId }, { type: 'stray_payment', status: 'PAID', amount: '95.04', daysAgo: 3 });
  seedRefund({ quote: quotes[2]! }, { type: 'window_lapsed', amount: '158.4', daysAgo: 2 });
  seedRefund({ paymentId: guarantees[2]!.paymentId }, { type: 'capacity_changed', amount: '158.4' });
  // loans on each guarantee: one with a default waiting for a second admin, one whose claim waits, one open
  const { apiBase, admin } = stack();
  const token = await apiToken(admin.email, admin.password);
  const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
  const lenders = ['Kopa Lenders', 'Mavuno Credit', 'Jamii Finance'];
  loans = [];
  for (const [i, g] of guarantees.entries()) {
    const d = await post<{ loan: { loanId: string } }>(`${apiBase}/loans`, { guaranteeId: g.guaranteeId, lender: lenders[i], reference: `LN-${48210 + i}-${Date.now().toString(36)}`, amount: [5000, 4500, 3000][i], openedAt: days(-40 + i * 5), dueAt: days(140 - i * 10) }, token);
    loans.push(d.loan.loanId);
  }
  const [aminaLoan, graceLoan] = loans as [string, string, string];
  seedLoanDocument(aminaLoan, made[0]!.id, 'Default notice from Kopa Lenders');
  await post(`${apiBase}/loans/${aminaLoan}/default`, { claimOwed: 4200.5, note: 'Missed three payments; notice attached' }, token);
  seedLoanDocument(graceLoan, made[2]!.id, 'Default notice from Mavuno Credit');
  seedLoanDocument(graceLoan, made[2]!.id, 'Statement of account');
  seedDefault(graceLoan, guarantees[1]!.guaranteeId, { owed: '3875.25', daysAgo: 16, verified: true });
  members = made;
  return made;
}

const settle = (page: Page) => page.waitForLoadState('networkidle');

for (const scheme of ['light', 'dark'] as const) {
  test(`screens in ${scheme} @shots`, async ({ page }, info) => {
    const tag = `${info.project.name}-${scheme}`;
    const phone = info.project.name === 'phone';
    await page.emulateMedia({ colorScheme: scheme });
    const [amina, brian] = await sampleMembers();
    await page.goto('/sign-in');
    await page.screenshot({ path: `${dir}/${tag}-1-sign-in.png` });
    const { admin } = stack();
    await signIn(page, admin.email, admin.password);
    if (!phone) await page.getByRole('button', { name: 'Pool' }).click();
    await page.screenshot({ path: `${dir}/${tag}-2-first-screen.png` });
    await page.goto('/account');
    await page.getByRole('heading', { name: 'Your details' }).waitFor();
    await page.screenshot({ path: `${dir}/${tag}-3-account.png` });
    if (phone) {
      await page.getByRole('button', { name: 'Open menu' }).click();
      await page.screenshot({ path: `${dir}/${tag}-4-menu.png` });
    }

    await page.goto('/members');
    await page.getByRole('heading', { name: 'All members' }).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-5-members.png` });
    for (const [n, t] of [[6, 'overview'], [7, 'trust'], [8, 'connections'], [9, 'limit'], [10, 'backing']] as const) {
      await page.goto(`/members/${amina!.id}${t === 'overview' ? '' : `?tab=${t}`}`);
      await page.getByRole('dialog', { name: 'Member details' }).getByRole('heading', { name: amina!.name }).waitFor();
      await settle(page);
      await page.screenshot({ path: `${dir}/${tag}-${n}-member-${t}.png`, fullPage: t === 'trust' });
    }
    if (!phone) {
      await page.goto('/members');
      await page.getByRole('button', { name: 'List', exact: true }).click();
      await settle(page);
      await page.screenshot({ path: `${dir}/${tag}-11-members-list-view.png` });
      await page.getByRole('button', { name: 'Table', exact: true }).click();
      await page.getByRole('button', { name: `Options for ${amina!.name}` }).click();
      await page.screenshot({ path: `${dir}/${tag}-12-member-options.png` });
      await page.keyboard.press('Escape');
      await page.goto(`/members/${amina!.id}`);
      await page.getByRole('button', { name: 'Disable the member' }).click();
      await page.getByRole('dialog', { name: /Disable Amina/ }).waitFor();
      await page.screenshot({ path: `${dir}/${tag}-13-disable.png` });
    }

    await page.goto('/kyc');
    await page.getByRole('heading', { name: 'KYC and address review' }).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-14-kyc-queue.png` });
    await page.goto(`/kyc/${brian!.id}`);
    await page.getByRole('dialog', { name: 'Review' }).getByText('Kilimani, Nairobi').waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-15-kyc-review.png` });
    await page.getByRole('dialog', { name: 'Review' }).getByRole('button', { name: 'Reject' }).click();
    await page.getByRole('dialog', { name: 'Reject this KYC submission?' }).waitFor();
    await page.screenshot({ path: `${dir}/${tag}-16-kyc-reject.png` });
    await page.keyboard.press('Escape');
    await page.goto(`/kyc/address/${brian!.id}`);
    await page.getByRole('dialog', { name: 'Review' }).getByText('Behind the market, blue gate').waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-17-address-review.png` });
    await page.goto(`/kyc/address?q=${encodeURIComponent(brian!.name.split(' ')[1]!)}`);
    await page.getByRole('table', { name: 'Members' }).or(page.getByRole('list', { name: 'Members' })).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-18-address-find.png` });

    await page.goto('/guarantees');
    await page.getByRole('table', { name: 'Guarantees' }).or(page.getByRole('list', { name: 'Guarantees' })).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-19-guarantees.png` });
    const g = guarantees[0]!.guaranteeId;
    for (const [n, t] of [[20, 'overview'], [21, 'pricing'], [22, 'payments']] as const) {
      await page.goto(`/guarantees/${g}?tab=${t}`);
      await page.getByRole('dialog', { name: 'Guarantee details' }).getByRole('heading', { name: g }).waitFor();
      await settle(page);
      await page.screenshot({ path: `${dir}/${tag}-${n}-guarantee-${t}.png` });
    }
    await page.goto(`/guarantees/${g}`);
    await page.getByRole('dialog', { name: 'Guarantee details' }).getByRole('button', { name: 'Enter a manual close' }).click();
    await page.getByRole('dialog', { name: 'Enter a manual close' }).waitFor();
    await page.screenshot({ path: `${dir}/${tag}-23-manual-close.png` });
    await page.keyboard.press('Escape');
    await page.goto('/guarantees/quotes');
    await page.getByRole('table', { name: 'Quotes' }).or(page.getByRole('list', { name: 'Quotes' })).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-24-quotes.png` });
    const q = quotes[0]!.quoteId;
    await page.goto(`/guarantees/quotes/${q}?tab=lipa`);
    await page.getByRole('dialog', { name: 'Quote details' }).getByText('Payment failed, please try again.').waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-25-quote-lipa.png` });

    // a refund of its own for each run, since a payout is entered on it
    const refund = seedRefund({ paymentId: guarantees[0]!.paymentId }, { type: 'overpayment', amount: '12.345678', daysAgo: 0 });
    await page.goto('/refunds');
    await page.getByRole('table', { name: 'Refunds' }).or(page.getByRole('list', { name: 'Refunds' })).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-26-refunds.png` });
    await page.goto(`/refunds/${refund}`);
    const panel = page.getByRole('dialog', { name: 'Refund details' });
    await panel.getByText('12.345678 USDT').waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-27-refund.png` });
    await panel.getByRole('button', { name: 'Record the payout' }).click();
    const payout = page.getByRole('dialog', { name: 'Record how the refund was paid' });
    await payout.getByLabel('Reference').fill('0x5f2c9a41e7b3d8f06a1c4e92b7d35f8a0c6e1b49d27f3a85c0e64b1d9f72a3c8');
    await payout.getByLabel('Date paid').fill(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date()));
    await page.screenshot({ path: `${dir}/${tag}-28-record-payout.png` });
    await payout.getByRole('button', { name: 'Enter the payout' }).click();
    await panel.getByText(/Payout entered by you/).waitFor();
    await page.screenshot({ path: `${dir}/${tag}-29-payout-entered.png` });

    await page.goto('/loans');
    await page.getByRole('table', { name: 'Loans' }).or(page.getByRole('list', { name: 'Loans' })).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-30-loans.png` });
    await page.goto(`/loans/${loans[0]}`);
    const loan = page.getByRole('dialog', { name: 'Loan details' });
    await loan.getByText(/Waiting for approval: default reported/).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-31-loan-waiting.png` });
    await loan.getByRole('tab', { name: 'Lender reports' }).click();
    await page.screenshot({ path: `${dir}/${tag}-32-loan-reports.png` });
    await page.goto('/claims');
    await page.getByRole('heading', { name: 'Waiting claims against Liquid Funds' }).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-33-claims.png` });
    await page.goto(`/claims/${loans[1]}`);
    const claim = page.getByRole('dialog', { name: 'Claim details' });
    await claim.getByText(/up to the guarantee amount/).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-34-claim.png` });
    await claim.getByRole('button', { name: 'Enter the payout' }).click();
    const claimPayout = page.getByRole('dialog', { name: "Enter this claim's payout" });
    await claimPayout.getByLabel('Paid in').selectOption('KES');
    await claimPayout.getByLabel('Amount, in KES').fill('499908.25');
    await claimPayout.getByLabel('KES per USD that day').fill('129');
    await claimPayout.getByText(/Comes to/).waitFor();
    await page.screenshot({ path: `${dir}/${tag}-35-claim-payout.png` });
  });
}

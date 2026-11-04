import { expect, test, type Browser, type Page } from '@playwright/test';
import { apiToken, call, connect, loseKycKey, newAdmin, newMember, post, randomIdNumber, seedDefault, seedGuarantee, seedLoanDocument, seedAlert, seedPoolSamples, seedQuote, seedPayment, seedRefund, signIn, stack, submitAddress, submitKyc, type Member, type SeededGuarantee, type SeededQuote } from './helpers';

// Not a check: screenshots for review, only when SHOTS_DIR is set.
const dir = process.env.SHOTS_DIR;
test.skip(!dir, 'SHOTS_DIR not set');
// every screen in one run, well past the usual minute
test.setTimeout(600_000);

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
  seedPayment(guarantees[2]!, { status: 'FAILED', hoursAgo: 75 });
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

/**
 * Pool setting changes for screenshots, made once a run: one applied at once, one approved and one rejected for the
 * history, and a change and a change set waiting, proposed by a second admin so the first can be shown approving.
 */
async function seedSettingSamples(browser: Browser) {
  const { apiBase, admin } = stack();
  const token = await apiToken(admin.email, admin.password);
  const waiting = await call<{ totalResults: number }>('GET', `${apiBase}/parameter-changes?status=pending&key=operating_fee_rate`, undefined, token);
  if (waiting.totalResults) return;
  const page = await browser.newPage();
  const ops = await newAdmin(page, ['PARAMETERS.READ', 'PARAMETERS.PROPOSE', 'PARAMETERS.APPROVE'], 'Operations');
  await page.close();
  const theirs = await apiToken(ops.email, ops.password);
  const patch = <T>(path: string, body: unknown, as: string) => call<T>('PATCH', `${apiBase}${path}`, body, as);
  await patch('/pool-parameters/invite_max_unused', { value: 12, reason: 'Members asked for more invites' }, token);
  const grace = await patch<{ id: string }>('/pool-parameters/claim_grace_days', { value: 45, reason: 'Lenders report defaults late' }, token);
  await patch(`/parameter-changes/${grace.id}/approve`, { note: 'Agreed with the lenders' }, theirs);
  const alerts = await patch<{ id: string }>('/pool-parameters/alert_refund_count', { value: 5, reason: 'Alert on fewer refunds' }, token);
  await patch(`/parameter-changes/${alerts.id}/reject`, { note: 'Too noisy at five' }, theirs);
  await patch('/pool-parameters/operating_fee_rate', { value: 0.025, reason: 'Quarterly review of running costs' }, theirs);
  await post(`${apiBase}/parameter-change-sets`, { changes: [{ key: 'pillar_weight_identity', value: 0.2 }, { key: 'pillar_weight_activity', value: 0.2 }], reason: 'Identity counts for more once KYC is required' }, theirs);
}

/** Amina's backing for screenshots, made once a run: amounts set and approved, and a change waiting from a second admin. */
async function seedBackingSamples(browser: Browser, member: Member) {
  const { apiBase, admin } = stack();
  const token = await apiToken(admin.email, admin.password);
  const now = await call<{ pending?: unknown }>('GET', `${apiBase}/members/${member.id}/asset-balances`, undefined, token);
  if (now.pending) return;
  const page = await browser.newPage();
  const ops = await newAdmin(page, ['MEMBERS.READ', 'MEMBERS.UPDATE'], 'Backing');
  await page.close();
  const theirs = await apiToken(ops.email, ops.password);
  const at = `${apiBase}/members/${member.id}/asset-balances`;
  await call('PUT', at, { kesDeposits: 120000, usdtVaultSavings: 350.5, note: 'From the March sacco statement' }, token);
  await call('PATCH', `${at}/approve`, { note: 'Matches the statement' }, theirs);
  await call('PUT', at, { kesDeposits: 135250.75, usdtVaultSavings: 410.125, note: 'April statement: deposits and savings up' }, theirs);
}

/** A few alerts for each run, the newest a refused Lipa payment; returns its id. */
function seedAlertSamples(): string {
  const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
  seedAlert({ type: 'REFUND_HELD_TOO_LONG', severity: 'WARNING', summary: '2 refund(s) owed and not paid back for more than 36 hours', status: 'ACKNOWLEDGED', note: 'Paying both back today', count: 4, minutesAgo: 95, details: { refunds: 2, heldHours: 36, oldestSince: days(-2) } });
  seedAlert({ type: 'ONCHAIN_READER_FAILING', severity: 'WARNING', summary: 'The lp reader has failed 3 runs in a row (14 member(s) last run)', status: 'RESOLVED', count: 3, minutesAgo: 300, details: { reader: 'lp', failedMembers: 14, runsInARow: 3, threshold: 3 } });
  seedAlert({ type: 'KES_RATE_STALE', summary: 'The KES rate is out of date, so KES deposits count for nothing as backing', count: 12, minutesAgo: 20, details: { rateSource: 'manual', rateUpdatedAt: days(-3), maxAgeHours: 48 } });
  return seedAlert({ type: 'LIPA_PAYMENT_REFUSED', summary: 'A Lipa payment for quote GPQ-7KD2QX was refused: the amount sent was less than the amount due', minutesAgo: 0, details: { quoteId: 'GPQ-7KD2QX', paymentId: 'lipa-pay-81273', txHash: '0x5f2c9a41e7b3d8f06a1c4e92b7d35f8a0c6e1b49d27f3a85c0e64b1d9f72a3c8', reason: 'the amount sent was less than the amount due' } });
}

/** The roles and admins of a small team, made once per stack; a second run finds them there. */
async function seedAdminSamples() {
  const { apiBase, admin } = stack();
  const token = await apiToken(admin.email, admin.password);
  const roles = await call<{ id: string; name: string }[]>('GET', `${apiBase}/roles`, undefined, token);
  const role = async (name: string, permissions: string[]) =>
    roles.find((r) => r.name === name)?.id ?? (await post<{ id: string }>(`${apiBase}/roles`, { name, permissions }, token)).id;
  const operations = await role('ROLE_OPERATIONS', ['MEMBERS', 'GUARANTEES', 'REFUNDS', 'ALERTS', 'LEDGER', 'POOL.READ', 'PARAMETERS.READ', 'PARAMETERS.PROPOSE', 'ADMINS.READ']);
  const reader = await role('ROLE_READ_ONLY', ['MEMBERS.READ', 'GUARANTEES.READ', 'REFUNDS.READ', 'ALERTS.READ', 'POOL.READ', 'PARAMETERS.READ', 'LEDGER.READ']);
  await role('ROLE_AUDITOR', ['AUDIT.READ', 'MEMBERS.READ', 'GUARANTEES.READ']);
  const people = [
    ['Brian', 'Kamau', operations],
    ['Ruth', 'Njeri', reader],
    ['Kevin', 'Mwangi', operations]
  ] as const;
  for (const [first, last, roleId] of people) {
    const email = `${first.toLowerCase()}.${last.toLowerCase()}@blockcoop.test`;
    const phoneNumber = `07${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    await post(`${apiBase}/admins`, { firstName: first, lastName: last, email, phoneNumber, roleId }, token).catch((e: Error) => {
      if (!/409/.test(e.message)) throw e;
    });
  }
}

/** Service keys for screenshots, made once a run: two in use (one used), one rotated and one revoked. */
let keysSeeded = false;
async function seedKeySamples() {
  if (keysSeeded) return;
  const { apiBase, admin } = stack();
  const token = await apiToken(admin.email, admin.password);
  type Made = { key: string; details: { id: string } };
  const make = (name: string, scopes: string[]) => post<Made>(`${apiBase}/service-keys`, { name, scopes }, token);
  const ledger = await make('Ledger sync', ['facts:write']);
  await post(`${apiBase}/service-keys/${ledger.details.id}/rotate`, undefined, token);
  const reports = await make('Lender reports', ['facts:read']);
  for (let i = 0; i < 3; i++) await fetch(`${apiBase}/facts?page=1&size=1`, { headers: { 'X-API-Key': reports.key } });
  const old = await make('Old importer', ['facts:write', 'facts:read']);
  await call('PATCH', `${apiBase}/service-keys/${old.details.id}/revoke`, undefined, token);
  keysSeeded = true;
}

const settle = (page: Page) => page.waitForLoadState('networkidle');

for (const scheme of ['light', 'dark'] as const) {
  test(`screens in ${scheme} @shots`, async ({ page, browser }, info) => {
    const tag = `${info.project.name}-${scheme}`;
    const phone = info.project.name === 'phone';
    await page.emulateMedia({ colorScheme: scheme });
    // most screens are opened by their address, which isn't activity; the run takes longer than the idle lock
    await page.addInitScript(() => localStorage.setItem('blockcoop-admin.activity', String(Date.now())));
    const [amina, brian] = await sampleMembers();
    await seedSettingSamples(browser);
    await seedBackingSamples(browser, amina!);
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
      // by her number: a run that starts again after a failure makes another Amina
      await page.getByRole('row').filter({ hasText: amina!.number }).getByRole('button', { name: `Options for ${amina!.name}` }).click();
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
    await page.keyboard.press('Escape');

    seedPoolSamples();
    await page.goto('/pool/health');
    await page.getByText('Base default rate').waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-36-pool-health.png`, fullPage: true });
    await page.goto('/pool/health?view=liquidity');
    const waiting = page.getByRole('list', { name: 'Movements' }).getByRole('listitem').filter({ hasText: 'Top-up before paying a claim' });
    await waiting.waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-37-extra-liquidity.png` });
    await waiting.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('dialog', { name: 'Approve this movement?' }).waitFor();
    await page.screenshot({ path: `${dir}/${tag}-38-movement-approve.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Enter a movement' }).click();
    const movement = page.getByRole('dialog', { name: 'Enter a movement of extra liquidity' });
    await movement.getByLabel('Amount, in USDT').fill('10000');
    await movement.getByLabel('Reason').fill('Top-up before paying the Mavuno Credit claim');
    await page.screenshot({ path: `${dir}/${tag}-39-enter-movement.png` });
    await page.keyboard.press('Escape');
    await page.goto('/pool/wallets');
    await page.getByRole('table', { name: 'Pool wallets' }).or(page.getByRole('list', { name: 'Pool wallets' })).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-40-pool-wallets.png` });
    await page.getByRole('table', { name: 'Pool wallets' }).or(page.getByRole('list', { name: 'Pool wallets' })).getByRole('link').filter({ hasText: 'Waiting for approval' }).click();
    const proposed = page.getByRole('dialog', { name: 'Pool wallet details' });
    await proposed.getByText(/Proposed by earlier-admin/).waitFor();
    await page.screenshot({ path: `${dir}/${tag}-41-wallet-waiting.png`, fullPage: true });
    await proposed.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('dialog', { name: 'Approve this pool wallet?' }).waitFor();
    await page.screenshot({ path: `${dir}/${tag}-42-wallet-approve.png` });
    await page.keyboard.press('Escape');

    await page.goto('/pool/settings');
    await page.getByRole('region', { name: 'Haircuts' }).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-43-pool-settings.png`, fullPage: true });
    await page.goto('/pool/settings/claim_grace_days');
    const setting = page.getByRole('dialog', { name: 'Pool setting' });
    await setting.getByRole('list', { name: 'Changes to this setting' }).waitFor();
    await page.screenshot({ path: `${dir}/${tag}-44-setting.png` });
    await setting.getByRole('button', { name: 'Change this setting' }).click();
    const change = page.getByRole('dialog', { name: 'Change claim_grace_days' });
    await change.getByLabel('New value').fill('60');
    await change.getByLabel('Reason (optional)').fill('Lenders still report late');
    await page.screenshot({ path: `${dir}/${tag}-45-change-setting.png` });
    await page.keyboard.press('Escape');
    await page.goto('/pool/settings');
    await page.getByRole('button', { name: 'Propose a change set' }).click();
    const changeSet = page.getByRole('dialog', { name: 'Propose a change set' });
    // opened before the settings loaded, it still leaves out the two weights with a change waiting
    await expect(changeSet.getByLabel('Setting 1', { exact: true })).toHaveValue('pillar_weight_relationship');
    await changeSet.getByLabel('New value for pillar_weight_relationship').fill('0.3');
    await changeSet.getByLabel('New value for pillar_weight_financial').fill('0.3');
    await page.screenshot({ path: `${dir}/${tag}-46-change-set.png` });
    await page.keyboard.press('Escape');
    await page.goto('/pool/settings?view=waiting');
    const waitingSet = page.getByRole('list', { name: 'Waiting changes' }).getByRole('listitem').filter({ hasText: 'Change set of 2' });
    await waitingSet.waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-47-settings-waiting.png` });
    await waitingSet.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('dialog', { name: 'Approve this change set?' }).waitFor();
    await page.screenshot({ path: `${dir}/${tag}-48-change-set-approve.png` });
    await page.keyboard.press('Escape');
    await page.goto('/pool/settings?view=history');
    await page.getByRole('list', { name: 'Setting changes' }).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-49-settings-history.png` });

    await page.goto('/backing');
    await page.getByRole('region', { name: 'Prices and haircuts' }).getByText('Locked BLOCKS count at').waitFor();
    // Amina's change waits in the list across members
    await page.getByRole('region', { name: 'Changes waiting for approval' }).getByRole('link').first().waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-50-backing.png`, fullPage: true });
    await page.goto(`/backing/${amina!.id}`);
    const backing = page.getByRole('region', { name: "Member's backing" });
    await backing.getByRole('region', { name: 'Waiting for approval' }).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-51-backing-waiting.png`, fullPage: true });
    await backing.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('dialog', { name: 'Approve this backing change?' }).waitFor();
    await page.screenshot({ path: `${dir}/${tag}-52-backing-approve.png` });
    await page.keyboard.press('Escape');
    await page.goto(`/backing/${brian!.id}`);
    await backing.getByRole('button', { name: 'Enter new amounts' }).click();
    const enter = page.getByRole('dialog', { name: 'Enter new KES deposits and vault savings' });
    await enter.getByLabel('KES non-withdrawable deposits').fill('48000');
    await enter.getByLabel('Note (optional)').fill('From the sacco statement');
    await page.screenshot({ path: `${dir}/${tag}-53-backing-enter.png` });
    await page.keyboard.press('Escape');

    const refused = seedAlertSamples();
    await page.goto('/alerts');
    await page.getByRole('table', { name: 'Alerts' }).or(page.getByRole('list', { name: 'Alerts' })).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-54-alerts.png` });
    await page.goto(`/alerts/${refused}`);
    const alert = page.getByRole('dialog', { name: 'Alert details' });
    await alert.getByRole('region', { name: 'What triggered it' }).waitFor();
    await alert.getByLabel('What was done').fill('Asked the member to pay the rest; Lipa refunds the short payment');
    await page.screenshot({ path: `${dir}/${tag}-55-alert.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await page.getByRole('menu').getByRole('menuitem').first().waitFor();
    await page.screenshot({ path: `${dir}/${tag}-56-bell.png` });
    await page.keyboard.press('Escape');

    // the same file each run: the first run adds its records, the second finds them already in
    await page.goto('/activity');
    await page.getByRole('button', { name: 'Import a CSV file' }).click();
    const importing = page.getByRole('dialog', { name: 'Import activity records' });
    const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 19) + 'Z';
    const rows = [
      [amina!, 'DEPOSIT', '12000', 1], [brian!, 'LOAN_REPAYMENT', '4500', 1], [amina!, 'BLOCKS_STAKED', '2000', 2],
      [brian!, 'WITHDRAWAL', '3000', 3], [amina!, 'LOAN_DISBURSED', '20000', 5]
    ] as const;
    const lines = rows.map(([m, type, amount, days], i) => `sacco-ledger,SHOT-${i},${m.number},${type},${amount},${at(days)}`);
    const csv = ['source,externalId,memberNumber,type,amount,occurredAt', ...lines].join('\n') + '\n';
    await importing.getByLabel('CSV file').setInputFiles({ name: 'october-deposits.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.screenshot({ path: `${dir}/${tag}-57-activity-import.png` });
    await importing.getByRole('button', { name: 'Import' }).click();
    await page.getByText(/^october-deposits\.csv: /).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-58-activity.png`, fullPage: true });

    await seedAdminSamples();
    await page.goto('/admins');
    await page.getByRole('heading', { name: 'Admins and roles' }).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-59-admins.png` });
    const brianAdmin = page.getByRole(phone ? 'listitem' : 'row').filter({ hasText: 'brian.kamau@blockcoop.test' });
    await brianAdmin.getByRole('button', { name: 'Options for Brian Kamau' }).click();
    await page.getByRole('menu').waitFor();
    await page.screenshot({ path: `${dir}/${tag}-60-admin-options.png` });
    await page.getByRole('menuitem', { name: 'Disable' }).click();
    await page.getByRole('dialog', { name: 'Disable Brian Kamau?' }).getByLabel('Reason (optional)').fill('On leave until December');
    await page.screenshot({ path: `${dir}/${tag}-61-admin-disable.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Invite an admin' }).click();
    const invite = page.getByRole('dialog', { name: 'Invite an admin' });
    await invite.getByLabel('First name').fill('Lydia');
    await invite.getByLabel('Last name').fill('Achieng');
    await invite.getByLabel('Email').fill('lydia.achieng@blockcoop.test');
    await invite.getByLabel('Phone number').fill('0712345678');
    await invite.getByLabel('Role').selectOption({ label: 'Operations' });
    await page.screenshot({ path: `${dir}/${tag}-62-admin-invite.png` });
    await page.keyboard.press('Escape');

    await page.getByRole('tab', { name: 'Roles' }).click();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-63-roles.png` });
    await page.getByRole(phone ? 'listitem' : 'row').filter({ hasText: /^Operations/ }).getByRole('link').click();
    await page.getByRole('dialog', { name: 'Role details' }).getByRole('heading', { name: 'Operations' }).waitFor();
    await page.screenshot({ path: `${dir}/${tag}-64-role.png` });
    await page.getByRole('button', { name: 'Rename or change permissions' }).click();
    await page.getByRole('dialog', { name: 'Change Operations' }).waitFor();
    await page.screenshot({ path: `${dir}/${tag}-65-role-change.png` });
    await page.keyboard.press('Escape');

    await seedKeySamples();
    await page.goto('/service-keys?show=all');
    await page.getByRole('heading', { name: 'Service keys' }).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-66-service-keys.png` });
    await page.getByRole('button', { name: 'Create a key' }).click();
    const create = page.getByRole('dialog', { name: 'Create a key' });
    await create.getByLabel('Name').fill('Partner sync');
    await create.getByLabel('Send activity records').check();
    await page.screenshot({ path: `${dir}/${tag}-67-key-create.png` });
    await create.getByRole('button', { name: 'Create the key' }).click();
    const secret = page.getByRole('dialog', { name: 'The key for Partner sync' });
    await secret.waitFor();
    await page.screenshot({ path: `${dir}/${tag}-68-key-secret.png` });
    await secret.getByRole('button', { name: 'Done' }).click();
    // the next run makes its own, so revoke this one
    const partner = page.getByRole(phone ? 'listitem' : 'row').filter({ hasText: 'Partner sync' }).filter({ hasText: /In use/ });
    await partner.getByRole('button', { name: 'Options for Partner sync' }).click();
    await page.getByRole('menuitem', { name: 'Revoke' }).click();
    await page.getByRole('dialog', { name: 'Revoke Partner sync?' }).getByRole('button', { name: 'Revoke' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });

    // Grace's details on a lost key, put back once the screens are taken
    const restore = loseKycKey((await sampleMembers())[2]!);
    try {
      await page.goto('/kyc-key');
      await page.getByRole('heading', { name: 'KYC encryption key' }).waitFor();
      await settle(page);
      await page.screenshot({ path: `${dir}/${tag}-69-kyc-key.png`, fullPage: true });
      await page.getByRole('button', { name: 'Preview the reset' }).click();
      await page.getByRole('list', { name: 'Members the reset would affect' }).waitFor();
      await page.screenshot({ path: `${dir}/${tag}-70-key-loss-preview.png`, fullPage: true });
      await page.getByRole('button', { name: 'Run the reset' }).click();
      await page.getByRole('dialog', { name: 'Run the key-loss reset?' }).getByLabel(/^Type/).fill('reset 1 member');
      await page.screenshot({ path: `${dir}/${tag}-71-key-loss-confirm.png` });
      await page.keyboard.press('Escape');
    } finally {
      restore();
    }

    await page.goto('/audit');
    await page.getByRole('heading', { name: 'Audit log' }).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-72-audit.png` });
    await page.goto('/audit?action=SERVICE_KEY_CREATED');
    await settle(page);
    await page.getByRole(phone ? 'listitem' : 'row').filter({ hasText: 'Service key created' }).first().getByRole('button', { name: stack().admin.email }).click();
    await page.waitForURL(/admin=/);
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-73-audit-filtered.png` });

    await page.goto('/payments');
    await page.getByRole('table', { name: 'Payments' }).or(page.getByRole('list', { name: 'Payments' })).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-74-payments.png` });
    const paid = guarantees[1]!;
    await page.goto(`/payments/${paid.guaranteeId}/${paid.paymentId}`);
    await page.getByRole('dialog', { name: 'Payment details' }).getByText(paid.txHash).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-75-payment-details.png` });

    await page.goto('/kyc/address');
    await page.getByRole('table', { name: 'Documents' }).or(page.getByRole('list', { name: 'Documents' })).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-76-address-queue.png` });

    // the inbox: Amina's backing change (from seedBackingSamples) and whatever else waits
    await page.goto('/approvals');
    const inbox = page.getByRole('table', { name: 'Waiting for a second admin' }).or(page.getByRole('list', { name: 'Waiting for a second admin' }));
    await inbox.getByRole('link', { name: new RegExp(amina!.number) }).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-77-approvals.png`, fullPage: true });
    await inbox.getByRole('link', { name: new RegExp(amina!.number) }).click();
    const item = page.getByRole('dialog', { name: 'Waiting item' });
    await item.getByRole('button', { name: 'Approve' }).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-78-approval-item.png` });
    await item.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('dialog', { name: 'Approve this backing change?' }).waitFor();
    await page.screenshot({ path: `${dir}/${tag}-79-approval-approve.png` });
    await page.keyboard.press('Escape');
  });
}

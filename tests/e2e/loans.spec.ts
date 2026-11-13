import { expect, test, type Page } from '@playwright/test';
import { apiToken, backdateDefault, call, newAdmin, newMember, post, seedGuarantee, seedLoanDocument, signIn, stack, type Member, type SeededGuarantee } from './helpers';

// Loans are recorded and their defaults paid through the backend's own endpoints. Only the lender's documents are
// seeded (see seedLoanDocument), and a default is moved back in time so its claim's waiting period is over.

const surname = () => 'L' + Array.from({ length: 7 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
const MANAGER = ['GUARANTEES.READ', 'GUARANTEES.MANAGE', 'MEMBERS.READ'];

const details = (page: Page, name = 'Loan details') => page.getByRole('dialog', { name });
// days are entered as days in Nairobi
const day = (offset = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offset * 86_400_000));
const reference = () => `KL-${Date.now().toString(36)}`;

interface Detail {
  loan: { loanId: string };
}

/** A loan on an active guarantee, recorded by the system admin, defaulted on 4,000 USDT, approved and verified by `second`. */
async function defaultedLoan(member: Member, g: SeededGuarantee, secondToken: string) {
  const { apiBase, admin } = stack();
  const token = await apiToken(admin.email, admin.password);
  const lent = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const due = new Date(Date.now() + 150 * 86_400_000).toISOString();
  const d = await post<Detail>(`${apiBase}/loans`, { guaranteeId: g.guaranteeId, lender: 'Kopa Lenders', reference: reference(), amount: 5000, openedAt: lent, dueAt: due }, token);
  const id = d.loan.loanId;
  seedLoanDocument(id, member.id, 'Default notice');
  await post(`${apiBase}/loans/${id}/default`, { claimOwed: 4000, note: 'Missed three payments' }, token);
  await call('PATCH', `${apiBase}/loans/${id}/pending/approve`, {}, secondToken);
  await post(`${apiBase}/loans/${id}/default/verification`, undefined, secondToken);
  return { id, token };
}

/** Adds to or takes from Liquid Funds, entered by the system admin and approved by a second admin. */
async function adjustLiquidity(token: string, secondToken: string, type: 'top_up' | 'withdrawal', amount: number) {
  const { apiBase } = stack();
  const a = await post<{ adjustmentId: string }>(`${apiBase}/pool/liquidity-adjustments`, { type, amount, note: 'e2e' }, token);
  await call('PATCH', `${apiBase}/pool/liquidity-adjustments/${a.adjustmentId}/approve`, {}, secondToken);
}

test.describe('Loans and claims (slice 6)', () => {
  test('records a loan and its default, which a second admin approves and a different admin verifies', async ({ page, browser }) => {
    const mary = await newMember('Mary', surname());
    const g = seedGuarantee(mary);
    const first = await newAdmin(page, MANAGER, 'LoanEnter');
    await signIn(page, first.email, first.password);

    await page.goto('/loans');
    await expect(page.getByRole('heading', { name: 'Loans and lender reports' })).toBeVisible();
    await page.getByRole('button', { name: 'Record a loan' }).click();
    const record = page.getByRole('dialog', { name: 'Record the loan a guarantee backs' });
    await record.getByRole('button', { name: 'Record the loan' }).click();
    await expect(record.getByText('Fill in every field.')).toBeVisible();
    await record.getByLabel('Active guarantee ID').fill(g.guaranteeId);
    await record.getByLabel('Lender', { exact: true }).fill('Kopa Lenders');
    await record.getByLabel("Lender's loan reference").fill(reference());
    await record.getByLabel('Amount lent, in USDT').fill('5000');
    await record.getByLabel('Lent on').fill(day(-10));
    await record.getByLabel('Final due date').fill(day(120));
    await record.getByRole('button', { name: 'Record the loan' }).click();
    await expect(page.getByText('Loan recorded.')).toBeVisible();

    const panel = details(page);
    await expect(panel.getByRole('heading', { name: `Loan on ${g.guaranteeId}` })).toBeVisible();
    await expect(panel.getByText('Open', { exact: true })).toBeVisible();
    await expect(panel.getByRole('link', { name: `${mary.name}, ${mary.number}` })).toBeVisible();
    await expect(panel.getByText('5,000.00 USDT')).toBeVisible();
    const loanId = new URL(page.url()).pathname.split('/').pop()!;

    // a default needs the lender's documents first
    await expect(panel.getByRole('button', { name: 'Enter a default' })).toBeDisabled();
    await expect(panel.getByText("Attach the lender's default documents before entering a default.")).toBeVisible();
    await panel.getByRole('button', { name: "Attach a lender's document" }).click();
    const attach = page.getByRole('dialog', { name: "Attach a lender's document" });
    await attach.getByRole('button', { name: 'Attach' }).click();
    await expect(attach.getByText('Choose the file.')).toBeVisible();
    await attach.getByRole('button', { name: 'Cancel' }).click();
    seedLoanDocument(loanId, mary.id, 'Default notice');
    await page.reload();
    await panel.getByRole('tab', { name: 'Documents' }).click();
    await expect(panel.getByText('Default notice')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Open the file' })).toBeVisible();

    await panel.getByRole('button', { name: 'Enter a default' }).click();
    const enter = page.getByRole('dialog', { name: 'Enter a default' });
    await enter.getByLabel('Still owed, in USDT').fill('4200.5');
    await enter.getByLabel('Note (optional)').fill('Missed three payments');
    await enter.getByRole('button', { name: 'Enter the default' }).click();
    await expect(page.getByText('Default entered. A second admin approves it.')).toBeVisible();
    await expect(panel.getByText(/Waiting for approval: default reported, entered by you/)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Approve' })).toBeDisabled();

    // a second admin finds it waiting, and approves it
    const other = await browser.newPage();
    const second = await newAdmin(other, MANAGER, 'LoanApprove');
    await signIn(other, second.email, second.password);
    await other.goto('/loans?status=pending');
    const rows = other.getByRole('table', { name: 'Loans' }).getByRole('link');
    await expect(rows.filter({ hasText: g.guaranteeId })).toContainText('Default reported: waiting');
    await rows.filter({ hasText: g.guaranteeId }).click();
    const theirs = details(other);
    await theirs.getByRole('button', { name: 'Approve' }).click();
    const approve = other.getByRole('dialog', { name: 'Approve: Default reported?' });
    await expect(approve.getByText('Missed three payments')).toBeVisible();
    await approve.getByRole('button', { name: 'Approve' }).click();
    await expect(other.getByText(`Default reported on ${g.guaranteeId} approved.`)).toBeVisible();
    await expect(theirs.getByText('Default, not verified', { exact: true })).toBeVisible();
    await expect(theirs.getByText('4,200.50 USDT', { exact: true })).toBeVisible();

    // who entered the default can't verify it
    await page.reload();
    await expect(panel.getByText('You entered this default, so a different admin verifies it.')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Mark verified' })).toBeDisabled();

    await theirs.getByRole('button', { name: 'Mark verified' }).click();
    await other.getByRole('dialog', { name: 'Mark this default verified?' }).getByRole('button', { name: 'Mark verified' }).click();
    await expect(other.getByText(`Default on ${g.guaranteeId} verified.`)).toBeVisible();
    await expect(theirs.getByText('Claim waiting', { exact: true })).toBeVisible();
    await theirs.getByRole('tab', { name: 'Claim steps' }).click();
    await expect(theirs.getByText('Default verified against its documents')).toBeVisible();
    await theirs.getByRole('tab', { name: 'Lender reports' }).click();
    await expect(theirs.getByRole('list', { name: 'Lender reports' }).getByText('Default reported')).toBeVisible();

    // it waits on Claims until claim_waiting_days have passed
    await other.goto('/claims');
    await expect(other.getByRole('heading', { name: 'Waiting claims against Liquid Funds' })).toBeVisible();
    const claim = other.getByRole('table', { name: 'Waiting claims' }).getByRole('link').filter({ hasText: g.guaranteeId });
    await expect(claim).toContainText('4,200.50 USDT');
    await expect(claim).toContainText('In waiting period');
    await other.close();
  });

  test('pays a claim once Liquid Funds cover it, then records a recovery and writes off the rest', async ({ page, browser }) => {
    const tom = await newMember('Tom', surname());
    const g = seedGuarantee(tom);
    const people = [...MANAGER, 'POOL.MANAGE'];
    const first = await newAdmin(page, people, 'ClaimPayer');
    const other = await browser.newPage();
    const second = await newAdmin(other, people, 'ClaimApprover');
    const secondToken = await apiToken(second.email, second.password);
    const { id, token } = await defaultedLoan(tom, g, secondToken);
    backdateDefault(id, 20);

    // Liquid Funds made short of the 4,000 USDT claim, whatever earlier tests left in them
    const { apiBase } = stack();
    const lf = Number((await call<{ liquidFunds: string }>('GET', `${apiBase}/claims/liquidity`, undefined, token)).liquidFunds);
    if (lf >= 4000) await adjustLiquidity(token, secondToken, 'withdrawal', Math.ceil(lf - 3990));

    await signIn(page, first.email, first.password);
    await page.goto('/claims');
    const claim = page.getByRole('table', { name: 'Waiting claims' }).getByRole('link').filter({ hasText: g.guaranteeId });
    await expect(claim).toContainText('Ready to pay');
    await claim.click();
    const panel = details(page, 'Claim details');
    await expect(panel.getByText('4,000.00 USDT, up to the guarantee amount of 5,000.00 USDT')).toBeVisible();
    await panel.getByRole('button', { name: 'Enter the payout' }).click();
    const payout = page.getByRole('dialog', { name: "Enter this claim's payout" });
    await payout.getByLabel('Amount, in USDT').fill('4000');
    await payout.getByLabel('Reference').fill('0xclaim4000');
    await payout.getByLabel('Date paid').fill(day());
    await payout.getByRole('button', { name: 'Enter the payout' }).click();
    await expect(payout.getByText(/don't cover the claim/)).toBeVisible();

    await adjustLiquidity(token, secondToken, 'top_up', 5000);
    await payout.getByRole('button', { name: 'Enter the payout' }).click();
    await expect(page.getByText('Payout entered. A second admin approves it.')).toBeVisible();

    await signIn(other, second.email, second.password);
    await other.goto(`/claims/${id}`);
    const theirs = details(other, 'Claim details');
    await theirs.getByRole('button', { name: 'Approve' }).click();
    await other.getByRole('dialog', { name: 'Approve: Claim paid?' }).getByRole('button', { name: 'Approve' }).click();
    await expect(theirs.getByText('Claim paid, recovering', { exact: true })).toBeVisible();
    await expect(theirs.getByText('0xclaim4000')).toBeVisible();

    // a recovery in KES, at that day's rate
    await page.reload();
    await panel.getByRole('button', { name: 'Enter a recovery' }).click();
    const recovery = page.getByRole('dialog', { name: 'Enter an amount recovered' });
    await recovery.getByLabel('Paid in').selectOption('KES');
    await recovery.getByLabel('Amount, in KES').fill('129000');
    await recovery.getByLabel('KES per USD that day').fill('129');
    await expect(recovery.getByText('Comes to 1,000.00 USDT.')).toBeVisible();
    await recovery.getByRole('button', { name: 'Enter the recovery' }).click();
    await expect(page.getByText('Recovery entered. A second admin approves it.')).toBeVisible();

    await other.reload();
    await theirs.getByRole('tab', { name: 'Recoveries' }).click();
    await theirs.getByRole('button', { name: 'Approve' }).click();
    await other.getByRole('dialog', { name: 'Approve this recovery?' }).getByRole('button', { name: 'Approve' }).click();
    await expect(theirs.getByText('Approved', { exact: true })).toBeVisible();
    await theirs.getByRole('tab', { name: 'Overview' }).click();
    await expect(theirs.getByText('1,000.00 USDT', { exact: true })).toBeVisible();

    // what wasn't recovered is written off
    await page.reload();
    await panel.getByRole('button', { name: 'Enter a write-off' }).click();
    const writeOff = page.getByRole('dialog', { name: 'Enter a write-off?' });
    await writeOff.getByRole('button', { name: 'Enter the write-off' }).click();
    await expect(writeOff.getByText('Write the reason.')).toBeVisible();
    await writeOff.getByLabel('Reason').fill('Borrower unreachable');
    await writeOff.getByRole('button', { name: 'Enter the write-off' }).click();
    await expect(page.getByText('Write-off entered. A second admin approves it.')).toBeVisible();
    await other.reload();
    await theirs.getByRole('button', { name: 'Approve' }).click();
    await other.getByRole('dialog', { name: 'Approve: Written off?' }).getByRole('button', { name: 'Approve' }).click();
    await expect(theirs.getByText('Written off', { exact: true }).first()).toBeVisible();

    await other.goto('/claims?view=defaults');
    await expect(other.getByRole('table', { name: 'Defaults' }).getByRole('link').filter({ hasText: g.guaranteeId })).toContainText('4,000.00 USDT');
    await other.close();
  });

  test('shows loans without actions to a read-only role, and is closed to a role without GUARANTEES.READ', async ({ page, browser }) => {
    const ann = await newMember('Ann', surname());
    const g = seedGuarantee(ann);
    const { apiBase, admin } = stack();
    const token = await apiToken(admin.email, admin.password);
    const d = await post<Detail>(`${apiBase}/loans`, { guaranteeId: g.guaranteeId, lender: 'Kopa Lenders', reference: reference(), amount: 2500, openedAt: new Date(Date.now() - 86_400_000).toISOString(), dueAt: new Date(Date.now() + 90 * 86_400_000).toISOString() }, token);

    const reader = await newAdmin(page, ['GUARANTEES.READ'], 'LoanReader');
    await signIn(page, reader.email, reader.password);
    await page.goto('/loans');
    await expect(page.getByRole('button', { name: 'Record a loan' })).toHaveCount(0);
    await page.goto(`/loans/${d.loan.loanId}`);
    const panel = details(page);
    await expect(panel.getByRole('heading', { name: `Loan on ${g.guaranteeId}` })).toBeVisible();
    // without MEMBERS.READ the member is shown by ID
    await expect(panel.getByText(ann.id)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Enter a repayment in full' })).toHaveCount(0);
    await page.goto('/loans/00000000-0000-4000-8000-000000000000');
    await expect(panel.getByText("There's no such loan.")).toBeVisible();

    const other = await browser.newPage();
    const user = await newAdmin(other, ['MEMBERS.READ'], 'NoLoans');
    await signIn(other, user.email, user.password);
    await expect(other.getByRole('link', { name: 'Claims' })).toHaveCount(0);
    await other.goto('/claims');
    await expect(other.getByRole('heading', { name: 'Not available to your role' })).toBeVisible();
    await other.close();
  });

  test("shows a loan the lender's system sent with its own key", async ({ page }) => {
    const { apiBase, admin } = stack();
    const token = await apiToken(admin.email, admin.password);
    const lender = `Umoja Credit ${Date.now().toString(36)}`;
    const key = await post<{ key: string }>(`${apiBase}/service-keys`, { name: lender, scopes: ['loans:write'] }, token);
    const sam = await newMember('Sam', surname());
    const g = seedGuarantee(sam);
    const res = await fetch(`${apiBase}/lender/loans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key.key },
      body: JSON.stringify({ guaranteeNumber: g.guaranteeId, memberNumber: sam.number, reference: reference(), amount: 2500, openedAt: new Date(Date.now() - 86_400_000).toISOString(), dueAt: new Date(Date.now() + 120 * 86_400_000).toISOString() })
    });
    expect(res.status).toBe(201);

    const reader = await newAdmin(page, ['GUARANTEES.READ', 'MEMBERS.READ'], 'LoanRead');
    await signIn(page, reader.email, reader.password);
    await page.goto('/loans?source=guaranteed');
    const row = page.getByRole('table', { name: 'Loans' }).getByRole('row').filter({ hasText: g.guaranteeId });
    await expect(row).toContainText('From lender');
    await expect(row).toContainText(lender);
    await row.getByRole('link').first().click();
    const panel = details(page);
    await expect(panel.getByText("Sent by the lender's system")).toBeVisible();
    await expect(panel.getByText('2,500.00 USDT')).toBeVisible();
  });
});

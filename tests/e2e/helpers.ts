import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { Wallet } from 'ethers';
import { randomUUID } from 'node:crypto';
import { docker, linkIn, loginCode, readMails, waitForMail, type Mail } from '../../scripts/local-stack.mjs';

interface StackState {
  apiBase: string;
  admin: { email: string; password: string };
  logPath: string;
  dbContainer: string;
  chainUrl: string;
}

export function stack(): StackState {
  return JSON.parse(readFileSync('.e2e/stack.json', 'utf8')) as StackState;
}

export const mailCount = () => readMails(stack().logPath).length;

export function nextMail(to: string, subject: RegExp, skip: number): Promise<Mail> {
  return waitForMail(stack().logPath, to, subject, { skip });
}

export async function codeFor(email: string, skip: number): Promise<string> {
  const code = loginCode(await nextMail(email, /login code/i, skip));
  if (!code) throw new Error(`No code in the email to ${email}`);
  return code;
}

export async function linkFor(email: string, subject: RegExp, route: string, skip: number): Promise<string> {
  const link = linkIn(await nextMail(email, subject, skip), route);
  if (!link) throw new Error(`No ${route} link in the email to ${email}`);
  return link;
}

/** Signs in through the screens: password, then the code from the backend's log. */
export async function signIn(page: Page, email: string, password: string, { fromLockScreen = false } = {}) {
  if (!fromLockScreen) {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
  }
  const skip = mailCount();
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Enter your one-time code' })).toBeVisible();
  await page.getByLabel('One-time code').fill(await codeFor(email, skip));
  // the code is checked once all six digits are in; wait until that's done
  await expect(page.getByRole('heading', { name: 'Enter your one-time code' })).toBeHidden();
}

/** Signs in straight against the API, for setting up admins and roles a flow needs. */
export async function apiToken(email: string, password: string): Promise<string> {
  const { apiBase } = stack();
  const skip = mailCount();
  const login = await post<{ challengeId: string }>(`${apiBase}/auth/admin-login`, { identifier: email, password });
  const code = await codeFor(email, skip);
  const res = await post<{ profile: { token: string } }>(`${apiBase}/auth/verify-otp`, { challengeId: login.challengeId, code });
  return res.profile.token;
}

export async function call<T>(method: string, url: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`${method} ${url} answered ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const post = <T>(url: string, body: unknown, token?: string) => call<T>('POST', url, body, token);

const randomPhone = () => `07${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

export interface Member {
  id: string;
  number: string;
  token: string;
  name: string;
  email: string;
  phone: string;
}

/**
 * Signs a new member up the way the member app does: a throwaway wallet signs the ERC-4361 message for a
 * nonce (BlockCoop D-016), and the registration ticket that returns makes the account.
 */
export async function newMember(firstName: string, lastName: string): Promise<Member> {
  const { apiBase } = stack();
  const wallet = Wallet.createRandom();
  const nonce = await post<{ nonce: string; chainId: number; domains: string[] }>(`${apiBase}/auth/wallet/nonce`, { address: wallet.address });
  const domain = nonce.domains[0];
  const message = [
    `${domain} wants you to sign in with your Ethereum account:`,
    wallet.address,
    '',
    'Sign in to BlockCoop',
    '',
    `URI: https://${domain}`,
    'Version: 1',
    `Chain ID: ${nonce.chainId}`,
    `Nonce: ${nonce.nonce}`,
    `Issued At: ${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}`
  ].join('\n');
  const signature = await wallet.signMessage(message);
  const signIn = await post<{ registrationTicket: string }>(`${apiBase}/auth/wallet/verify`, { message, signature });
  seq += 1;
  const email = `member-${Date.now().toString(36)}${seq}@test.local`;
  const phone = randomPhone();
  const skip = mailCount();
  const res = await post<{ profile: { accountId: string; memberNumber: string; token: string } }>(`${apiBase}/auth/wallet/register`, {
    registrationTicket: signIn.registrationTicket,
    firstName,
    lastName,
    email,
    phoneNumber: phone
  });
  // connecting needs a confirmed email: follow the link from the verification email
  const link = await linkFor(email, /verify your email/i, 'verify-email', skip);
  await post(`${apiBase}/auth/verify-email`, { token: new URL(link).searchParams.get('token') });
  return {
    id: res.profile.accountId,
    number: res.profile.memberNumber,
    token: res.profile.token,
    name: `${firstName} ${lastName}`,
    email,
    // as the backend stores it
    phone: `+254${phone.slice(1)}`
  };
}

/** `from` asks `to` to connect, naming them by member number, and `to` accepts. */
export async function connect(from: Member, to: Member, relationshipType = 'TRUST') {
  const { apiBase } = stack();
  const r = await post<{ relationshipId: string }>(`${apiBase}/members/${from.id}/relationships`, { identifier: to.number, relationshipType }, from.token);
  await call('PATCH', `${apiBase}/members/${to.id}/relationships/${r.relationshipId}/accept`, undefined, to.token);
}

let seq = 0;

/**
 * Stands in for a member's file upload. The backend stores files in Cloudflare R2, which a local run doesn't
 * reach, so the upload's record goes straight into the throwaway database instead. Returns its id.
 */
export function seedUpload(owner: Member, category: 'kyc-document' | 'proof-of-address', label: string): string {
  const id = randomUUID();
  const sql = `INSERT INTO uploads (id, owner_id, category, label, type, visibility, content_type, size_bytes, storage_key, created_by_id, created_at)
    VALUES ('${id}', '${owner.id}', '${category}', '${label}', 'DOCUMENT', 'PRIVATE', 'application/pdf', 48213, 'e2e/${id}.pdf', '${owner.id}', now())`;
  docker('exec', stack().dbContainer, 'psql', '-U', 'postgres', '-d', 'blockcoop', '-v', 'ON_ERROR_STOP=1', '-c', sql);
  return id;
}

/** The member puts forward their KYC details, as the member app does once the ID document is uploaded. */
export async function submitKyc(member: Member, details: { idType: string; idNumber: string; dateOfBirth: string; address: string }) {
  seedUpload(member, 'kyc-document', 'National ID, both sides');
  await post(`${stack().apiBase}/members/me/kyc`, details, member.token);
}

/** The member saves a map pin and puts forward a utility bill issued `daysAgo` days ago. */
export async function submitAddress(member: Member, pin: { latitude: number; longitude: number; comment: string }, daysAgo = 10) {
  const { apiBase } = stack();
  await call('PUT', `${apiBase}/members/me/address-pin`, pin, member.token);
  const uploadId = seedUpload(member, 'proof-of-address', 'Power bill');
  const issueDate = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  await post(`${apiBase}/members/me/address-documents`, { uploadId, documentType: 'utility_bill', issueDate }, member.token);
}

/** Leaves the member's KYC details on a key the server doesn't have, as if that key were lost. Returns how to undo it. */
export function loseKycKey(member: Member): () => void {
  const where = `WHERE member_id = '${member.id}'`;
  const before = sql(`SELECT id_number FROM member_kyc ${where}`).trim();
  sql(`UPDATE member_kyc SET id_number = 'k0:' || substring(id_number from position(':' in id_number) + 1) ${where}`);
  return () => sql(`UPDATE member_kyc SET id_number = '${before}' ${where}`);
}

const sql = (statement: string) => docker('exec', stack().dbContainer, 'psql', '-U', 'postgres', '-d', 'blockcoop', '-v', 'ON_ERROR_STOP=1', '-At', '-c', statement);

const randomOf = (chars: string, n: number) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
export const randomHash = () => `0x${randomOf('0123456789abcdef', 64)}`;

// One priced quote: 5,000 USDT for 6 months at a Trust Score of 72, worked through the backend's formulas
// (SM = 2 − TS/100, PD = BDR × SM, EL = GA × PD × LGD, BM = max(floor, 2 + CON − LR), P = (EL + BL) × TR).
// A flagged one has its premium below its expected loss over the tenure (COV under 1).
const PRICING = `trust_score_at_underwriting, strength_multiplier, base_default_rate, probability_of_default, recovery_rate,
  loss_given_default, expected_loss, pool_size, available_capacity, concentration_ratio, liquidity_ratio, buffer_floor,
  buffer_multiplier, buffer_loading, tenure_ratio, premium_amount, premium_rate, coverage_ratio, member_backing_usdt,
  guarantee_to_savings_ratio, quote_usdt_per_blocks, flagged`;
const pricing = (flagged: boolean) =>
  `72, 1.28, 0.05, 0.064, 0.4, 0.6, 192, 200000, 150000, 0.0333, 0.8, 1.5, 1.5, 96, 0.5, ${flagged ? '86.4, 0.03456, 0.9' : '144, 0.0576, 1.5'},
  2500, 2, 0.0412, ${flagged}`;

export interface SeededQuote {
  quoteId: string;
  amountDue: string;
  /** its database ID, which a refund owed on it points at */
  id: string;
}

/**
 * Stands in for a member asking for a quote, and for its payment through the Lipa API. A local run reaches
 * neither Lipa nor the chain, and a quote needs the member's backing and network for headroom, so the
 * records go straight into the throwaway database, as the backend would write them.
 */
export function seedQuote(member: Member, opts: { status?: 'OPEN' | 'PAID' | 'REPLACED' | 'EXPIRED'; flagged?: boolean; lipa?: { status: 'PROCESSING' | 'SUCCESS' | 'FAILED'; message?: string }; guaranteeId?: string; quotedDaysAgo?: number; replacedBy?: string } = {}): SeededQuote {
  const quoteId = `GPQ-${randomOf('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6)}`;
  const flagged = opts.flagged ?? false;
  const fee = flagged ? '8.64' : '14.4';
  const amountDue = flagged ? '95.04' : '158.4';
  // an open quote lasts 30 minutes, so it's made 5 minutes ago to be still open
  const quotedAt = `now() - interval '${opts.quotedDaysAgo ?? 0} days' - interval '${(opts.status ?? 'OPEN') === 'OPEN' ? 5 : 60} minutes'`;
  const lipa = opts.lipa;
  const id = randomUUID();
  sql(`INSERT INTO guarantee_quotes (id, quote_number, member_id, amount_requested, tenure_months, status, quoted_at, valid_until,
    guarantee_number, ${PRICING}, base_default_rate_calculated, recovery_rate_calculated, liquidity_ratio_calculated,
    operating_fee, amount_due, operating_fee_rate, operating_fee_min_usd, operating_fee_max_usd, lipa_payment_id,
    payment_status, failure_reason, failure_message, check_anchor_at, replaced_by)
    VALUES ('${id}', '${quoteId}', '${member.id}', 5000, 6, '${opts.status ?? 'OPEN'}', ${quotedAt}, ${quotedAt} + interval '30 minutes',
    ${opts.guaranteeId ? `'${opts.guaranteeId}'` : 'NULL'}, ${pricing(flagged)}, false, false, false,
    ${fee}, ${amountDue}, 0.1, 1, 50, ${lipa ? `'lipa-${randomOf('0123456789abcdef', 12)}'` : 'NULL'},
    ${lipa ? `'${lipa.status}'` : 'NULL'}, ${lipa?.status === 'FAILED' ? "'INSUFFICIENT_FUNDS'" : 'NULL'},
    ${lipa?.message ? `'${lipa.message}'` : 'NULL'}, ${quotedAt}, ${opts.replacedBy ? `'${opts.replacedBy}'` : 'NULL'})`);
  return { quoteId, amountDue, id };
}

export interface SeededGuarantee {
  guaranteeId: string;
  quoteId: string;
  txHash: string;
  /** the database ID of its confirmed payment, which a refund owed on it points at */
  paymentId: string;
  /** the guarantee's database ID */
  id: string;
  amountDue: string;
}

/** A quote paid through the Lipa API, the active guarantee it created and its confirmed payment (see seedQuote). */
export function seedGuarantee(member: Member, opts: { flagged?: boolean; status?: 'ACTIVE' | 'IN_CLAIM' | 'CLOSED' } = {}): SeededGuarantee {
  const flagged = opts.flagged ?? false;
  const guaranteeId = `GPG-${new Date().getFullYear()}-${randomOf('0123456789', 6)}`;
  const txHash = randomHash();
  const { quoteId, amountDue } = seedQuote(member, { status: 'PAID', flagged, guaranteeId, lipa: { status: 'SUCCESS' }, quotedDaysAgo: 3 });
  const id = randomUUID();
  const quotedAt = "now() - interval '3 days' - interval '1 hour'";
  const activatedAt = "now() - interval '3 days' - interval '40 minutes'";
  sql(`INSERT INTO guarantees (id, guarantee_number, member_id, amount_requested, tenure_months, status, quoted_at, valid_until,
    activated_at, ends_at, ${PRICING}, base_default_rate_calculated, recovery_rate_calculated, liquidity_ratio_calculated,
    activation_usdt_per_blocks)
    VALUES ('${id}', '${guaranteeId}', '${member.id}', 5000, 6, '${opts.status ?? 'ACTIVE'}', ${quotedAt}, ${quotedAt} + interval '30 minutes',
    ${activatedAt}, ${activatedAt} + interval '6 months', ${pricing(flagged)}, false, false, false, 0.0409)`);
  const fee = flagged ? '8.64' : '14.4';
  const paymentId = randomUUID();
  sql(`INSERT INTO premium_payments (id, guarantee_id, method, amount_due, amount_received, amount_refunded, status, provider_reference,
    initiated_at, confirm_by, confirmed_at, currency, premium_usdt, provider, amount_asked, operating_fee, operating_fee_currency,
    operating_fee_rate, operating_fee_min_usd, operating_fee_max_usd, operating_fee_usdt)
    VALUES ('${paymentId}', '${id}', 'LIPA', ${amountDue}, ${amountDue}, 0, 'CONFIRMED', '${txHash}', ${activatedAt}, ${activatedAt},
    ${activatedAt}, 'USDT', ${flagged ? '86.4' : '144'}, 'lipa', ${amountDue}, ${fee}, 'USDT', 0.1, 1, 50, ${fee})`);
  return { guaranteeId, quoteId, txHash, paymentId, id, amountDue: String(amountDue) };
}

/** Another attempt to pay a seeded guarantee, one that failed or is still pending, started some hours ago. Returns its id. */
export function seedPayment(g: SeededGuarantee, opts: { status: 'FAILED' | 'PENDING'; hoursAgo?: number }): string {
  const id = randomUUID();
  const at = `now() - interval '${opts.hoursAgo ?? 2} hours'`;
  sql(`INSERT INTO premium_payments (id, guarantee_id, method, amount_due, amount_received, amount_refunded, status, provider_reference,
    initiated_at, confirm_by, confirmed_at, currency, premium_usdt, provider, amount_asked, operating_fee, operating_fee_currency,
    operating_fee_rate, operating_fee_min_usd, operating_fee_max_usd, operating_fee_usdt)
    VALUES ('${id}', '${g.id}', 'LIPA', ${g.amountDue}, 0, 0, '${opts.status}', NULL, ${at}, ${at} + interval '30 minutes', NULL, 'USDT', 144,
    'lipa', ${g.amountDue}, 14.4, 'USDT', 0.1, 1, 50, 14.4)`);
  return id;
}

/**
 * Money owed back, as the backend records it when the Lipa API pays the pool more than is due, too late or for
 * nothing: on a guarantee's payment, or on a quote when no guarantee was created. Returns its id.
 */
export function seedRefund(on: { paymentId: string } | { quote: SeededQuote }, opts: { type?: string; amount?: string; status?: 'OWED' | 'PAID'; daysAgo?: number } = {}): string {
  const id = randomUUID();
  const type = (opts.type ?? 'overpayment').toUpperCase();
  const at = `now() - interval '${opts.daysAgo ?? 1} days'`;
  const paid = opts.status === 'PAID';
  sql(`INSERT INTO payment_refunds (id, payment_id, quote_id, amount, reason, refunded_at, idempotency_key, refund_type, status,
    method, reference, paid_at, approved_by_email, approved_at)
    VALUES ('${id}', ${'paymentId' in on ? `'${on.paymentId}'` : 'NULL'}, ${'quote' in on ? `'${on.quote.id}'` : 'NULL'}, ${opts.amount ?? '12.5'},
    '${type.toLowerCase()}', ${at}, 'e2e-${id}', '${type}', '${opts.status ?? 'OWED'}',
    ${paid ? `'TRANSFER', '${randomHash()}', ${at}, 'earlier-admin@test.local', ${at}` : 'NULL, NULL, NULL, NULL, NULL'})`);
  return id;
}

export interface SeededAlert {
  type: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  summary: string;
  details?: Record<string, unknown>;
  status?: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  count?: number;
  /** when it was last seen; first seen a day before that */
  minutesAgo?: number;
  note?: string;
}

/**
 * A pool alert as the backend raises one. Most need a failure the local stack can't make happen (a refused Lipa
 * payment, a stale KES rate), so it goes straight into the throwaway database, under a condition no other has.
 * Returns its id.
 */
export function seedAlert(a: SeededAlert): string {
  const id = randomUUID();
  const text = (v: string) => `'${v.replace(/'/g, "''")}'`;
  const status = a.status ?? 'OPEN';
  const key = `e2e-${id}`;
  const last = `now() - interval '${a.minutesAgo ?? 1} minutes'`;
  const acknowledged = status === 'ACKNOWLEDGED' || (status === 'RESOLVED' && a.note);
  sql(`INSERT INTO pool_alerts (id, type, severity, dedupe_key, open_key, summary, details, first_seen_at, last_seen_at, seen_count, status,
    acknowledged_by_email, acknowledged_at, acknowledge_note, resolved_at)
    VALUES ('${id}', '${a.type}', '${a.severity ?? 'CRITICAL'}', '${key}', ${status === 'RESOLVED' ? 'NULL' : text(`${a.type}:${key}`)}, ${text(a.summary)},
    ${a.details ? text(JSON.stringify(a.details)) : 'NULL'}, ${last} - interval '1 day', ${last}, ${a.count ?? 1}, '${status}',
    ${acknowledged ? `'earlier-admin@test.local', ${last}, ${text(a.note ?? 'Looked into it')}` : 'NULL, NULL, NULL'}, ${status === 'RESOLVED' ? 'now()' : 'NULL'})`);
  return id;
}

/** The backend seeing an alert's condition clear. */
export const resolveAlert = (id: string) => sql(`UPDATE pool_alerts SET status = 'RESOLVED', open_key = NULL, resolved_at = now() WHERE id = '${id}'`);

/**
 * A lender's document on a loan. Attaching one stores the file in Cloudflare R2, which a local run doesn't reach,
 * so its record goes straight into the throwaway database, as seedUpload's does. Returns its id.
 */
export function seedLoanDocument(loanId: string, memberId: string, label: string): string {
  const id = randomUUID();
  const by = `(SELECT id FROM accounts WHERE lower(email) = lower('${stack().admin.email}'))`;
  sql(`INSERT INTO uploads (id, owner_id, category, label, type, visibility, content_type, size_bytes, storage_key, created_by_id, created_at)
    VALUES ('${id}', '${memberId}', 'claim-document', '${label}', 'DOCUMENT', 'PRIVATE', 'application/pdf', 52114, 'e2e/${id}.pdf', ${by}, now())`);
  sql(`INSERT INTO loan_documents (loan_record_id, upload_id, added_by, added_at) VALUES ('${loanId}', '${id}', ${by}, now())`);
  return id;
}

/** Moves a loan's default back `days` days, so its claim's waiting period (claim_waiting_days, 14 by default) is over. */
export function backdateDefault(loanId: string, days: number) {
  sql(`UPDATE loan_records SET defaulted_at = defaulted_at - interval '${days} days' WHERE id = '${loanId}'`);
}

/**
 * Makes a recorded loan's default approved, for screenshots: its guarantee goes into claim, with the claim owed and,
 * if `verified`, checked against its documents by an earlier admin. Two admins do this through the API in the tests.
 */
export function seedDefault(loanId: string, guaranteeId: string, opts: { owed: string; daysAgo: number; verified?: boolean }) {
  sql(`UPDATE loan_records SET status = 'DEFAULTED', defaulted_at = now() - interval '${opts.daysAgo} days', claim_owed = ${opts.owed},
    default_note = 'Missed three payments'${opts.verified ? `, default_verified_at = now() - interval '${opts.daysAgo - 1} days', default_verified_by_email = 'earlier-admin@test.local'` : ''}
    WHERE id = '${loanId}'`);
  sql(`UPDATE guarantees SET status = 'IN_CLAIM' WHERE guarantee_number = '${guaranteeId}'`);
}

/**
 * A new Safe on the chain stand-in (scripts/local-stack.mjs), with `owners` new signers of whom `threshold` must
 * sign. Returns its address, which can then be proposed as a pool wallet.
 */
export async function newSafe(owners: number, threshold: number): Promise<{ address: string; owners: string[] }> {
  const address = Wallet.createRandom().address.toLowerCase();
  const signers = Array.from({ length: owners }, () => Wallet.createRandom().address.toLowerCase());
  await post(`${stack().chainUrl}/safes`, { address, owners: signers, threshold });
  return { address, owners: signers };
}

/**
 * Extra liquidity and pool wallets for screenshots, made once: approved and rejected movements and one waiting, and
 * a current and a retired wallet with a new one waiting. What's waiting is entered as an earlier admin, so the first
 * admin can be shown approving it; two admins do this through the screens in the tests.
 */
export function seedPoolSamples() {
  const by = `(SELECT id FROM accounts WHERE lower(email) = lower('${stack().admin.email}'))`;
  const earlier = "'earlier-admin@test.local'";
  if (sql("SELECT count(*) FROM liquidity_adjustments WHERE note = 'Sacco contribution'") === '0') {
    const row = (type: string, amount: string, note: string, status: string, days: number) => {
      const at = `now() - interval '${days} days'`;
      const decided = status === 'APPROVED' ? `${by}, ${earlier}, ${at} + interval '3 hours', NULL, NULL, NULL` : status === 'REJECTED' ? `NULL, NULL, NULL, ${by}, ${earlier}, ${at} + interval '3 hours'` : 'NULL, NULL, NULL, NULL, NULL, NULL';
      return `('${randomUUID()}', '${type}', ${amount}, '${note}', '${status}', ${by}, ${status === 'PENDING' ? earlier : `'${stack().admin.email}'`}, ${at}, ${decided}, ${status === 'REJECTED' ? "'Not agreed with the sacco'" : 'NULL'})`;
    };
    sql(`INSERT INTO liquidity_adjustments (id, type, amount, note, status, created_by, created_by_email, created_at, approved_by, approved_by_email, approved_at, rejected_by, rejected_by_email, rejected_at, decision_note) VALUES
      ${row('TOP_UP', '25000', 'Sacco contribution', 'APPROVED', 58)},
      ${row('WITHDRAWAL', '5000', 'Contribution returned to the sacco', 'APPROVED', 30)},
      ${row('WITHDRAWAL', '1200', 'Operating costs', 'REJECTED', 9)},
      ${row('TOP_UP', '10000.5', 'Top-up before paying a claim', 'PENDING', 0)}`);
  }
  const signers = (n: number) => Array.from({ length: n }, () => Wallet.createRandom().address.toLowerCase()).join(',');
  const wallet = (status: string, slot: string, n: number, threshold: number, from: string, until: string, watch: string, proposed: string, note: string, proposer: string) =>
    `('${randomUUID()}', '${Wallet.createRandom().address.toLowerCase()}', '${status}', ${slot}, '${signers(n)}', ${threshold}, ${from}, ${until}, ${watch}, ${by}, ${proposer}, ${proposed}, '${note}',
      ${status === 'PROPOSED' ? 'NULL, NULL, NULL' : `${by}, ${earlier}, ${proposed} + interval '3 hours'`}, NULL)`;
  const cols = 'id, address, status, slot, signers, threshold, current_from, current_until, watch_until, proposed_by, proposed_by_email, proposed_at, proposal_note, decided_by, decided_by_email, decided_at, decision_note';
  if (sql("SELECT count(*) FROM pool_wallets WHERE status = 'CURRENT'") === '0') {
    sql(`INSERT INTO pool_wallets (${cols}) VALUES
      ${wallet('RETIRED', 'NULL', 3, 2, "now() - interval '260 days'", "now() - interval '9 days'", "now() + interval '21 days'", "now() - interval '262 days'", 'First pool wallet', `'${stack().admin.email}'`)},
      ${wallet('CURRENT', "'CURRENT'", 5, 3, "now() - interval '9 days'", 'NULL', 'NULL', "now() - interval '10 days'", 'Scheduled replacement', `'${stack().admin.email}'`)}`);
  }
  if (sql("SELECT count(*) FROM pool_wallets WHERE status = 'PROPOSED'") === '0') {
    sql(`INSERT INTO pool_wallets (${cols}) VALUES ${wallet('PROPOSED', "'PROPOSED'", 5, 3, 'NULL', 'NULL', 'NULL', "now() - interval '2 hours'", 'One signer replaced: Grace leaves the board', earlier)}`);
  }
}

export const randomIdNumber = () =>String(10_000_000 + Math.floor(Math.random() * 89_999_999));

/** A role of this run's own, made by the system admin. Returns its id and stored name (ROLE_TEST_…). */
export async function newRole(permissions: string[], label: string, token?: string) {
  const { apiBase, admin } = stack();
  seq += 1;
  const tag = `${label}${Date.now().toString(36)}${seq}`;
  return post<{ id: string; name: string }>(`${apiBase}/roles`, { name: `Test ${tag}`, permissions }, token ?? (await apiToken(admin.email, admin.password)));
}

/**
 * Invites an admin with a new role holding `permissions`, and sets their password through the portal's
 * /set-password page from the invitation email. Returns their email, password and role.
 */
export async function newAdmin(page: Page, permissions: string[], label: string) {
  const { apiBase, admin } = stack();
  const token = await apiToken(admin.email, admin.password);
  const role = await newRole(permissions, label, token);
  const tag = role.name.replace(/^ROLE_TEST_/, '');
  const email = `admin-${tag.toLowerCase()}@test.local`;
  const skip = mailCount();
  await post(`${apiBase}/admins`, { firstName: 'Test', lastName: label, email, phoneNumber: randomPhone(), roleId: role.id }, token);
  const link = await linkFor(email, /.*/, 'set-password', skip);
  const password = `Pw-${tag}-a1A!`;
  await page.goto(new URL(link).pathname + new URL(link).search);
  await expect(page.getByRole('heading', { name: 'Set your first password' })).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill(password);
  await page.getByLabel('New password again').fill(password);
  await page.getByRole('button', { name: 'Set the password' }).click();
  await expect(page.getByText('Your password is set. Sign in to finish.')).toBeVisible();
  return { email, password, roleId: role.id };
}

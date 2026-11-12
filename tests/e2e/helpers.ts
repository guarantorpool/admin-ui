import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { Wallet } from 'ethers';
import { randomUUID } from 'node:crypto';
import { docker, linkIn, loginCode, readMails, resetCode, waitForMail, type Mail } from '../../scripts/local-stack.mjs';

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

/** The 6-digit code from the next password reset email to `email`. */
export async function resetCodeFor(email: string, skip: number): Promise<string> {
  const code = resetCode(await nextMail(email, /password reset code/i, skip));
  if (!code) throw new Error(`No password reset code in the email to ${email}`);
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

/**
 * One status the Lipa API reported for an attempt to pay a quote, as its callback or our status check stored it (C3,
 * C6); a local run never reaches the Lipa API.
 */
export function seedLipaEvent(quoteId: string, opts: { paymentId: string; status: 'PROCESSING' | 'SUCCESS' | 'FAILED'; source?: 'CALLBACK' | 'STATUS_CHECK'; amount?: string; reason?: string; message?: string; txHash?: string; minutesAgo?: number }) {
  const at = `now() - interval '${opts.minutesAgo ?? 0} minutes'`;
  const text = (v: string | undefined) => (v ? `'${v.replace(/'/g, "''")}'` : 'NULL');
  sql(`INSERT INTO lipa_payment_events (id, quote_number, payment_id, status, amount, tx_hash, failure_reason, failure_message, completed_at, source, received_at)
    VALUES ('${randomUUID()}', '${quoteId}', '${opts.paymentId}', '${opts.status}', ${opts.amount ?? 'NULL'}, ${text(opts.txHash)}, ${text(opts.reason)},
    ${text(opts.message)}, ${opts.status === 'PROCESSING' ? 'NULL' : at}, '${opts.source ?? 'CALLBACK'}', ${at})`);
}

/**
 * One M-Pesa deposit or payment as if read from the Lipa API's feed for a member's wallet (C4); a local run never
 * reaches the Lipa API. Returns its Lipa ID.
 */
export function seedKesActivity(member: Member, opts: { wallet: string; type?: 'DEPOSIT' | 'PAYMENT'; status?: 'COMPLETED' | 'REVERSED' | 'FAILED'; amountKes?: number; receipt?: string; onChain?: boolean; hoursAgo?: number }): string {
  const id = `lipa-act-${randomOf('0123456789abcdef', 12)}`;
  const kes = opts.amountKes ?? 1290;
  const at = `now() - interval '${opts.hoursAgo ?? 1} hours'`;
  const completed = (opts.status ?? 'COMPLETED') === 'FAILED' ? 'NULL' : at;
  const payment = opts.type === 'PAYMENT';
  sql(`INSERT INTO kes_activities (id, member_id, wallet_address, activity_type, channel, recipient_type, recipient_reference, amount_kes,
    kes_per_usd, amount_usd, amount_blocks, kes_per_block, mpesa_receipt, tx_hash, status, completed_at, lipa_updated_at, read_at)
    VALUES ('${id}', '${member.id}', '${opts.wallet}', '${opts.type ?? 'DEPOSIT'}', 'MPESA', ${payment ? "'PAYBILL'" : 'NULL'},
    ${payment ? "'888880'" : 'NULL'}, ${kes}, 129, ${kes / 129}, ${kes / 5.16}, 5.16, ${opts.receipt ? `'${opts.receipt}'` : 'NULL'},
    ${opts.onChain === false ? 'NULL' : `'${randomHash()}'`}, '${opts.status ?? 'COMPLETED'}', ${completed}, ${at}, ${at})`);
  return id;
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

const USDT_TOKEN = '0x55d398326f99059ff775485246999027b3197955';
const BLOCKS_TOKEN = '0xfd3f86d951bcddd209241884c021636c2a60e195';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const topic = (address: string) => '0x' + '0'.repeat(24) + address.slice(2).toLowerCase();
// an amount in a token's 18 decimals, as a hex word
const raw = (amount: string) => {
  const [whole, frac = ''] = amount.split('.');
  return (BigInt(whole!) * 10n ** 18n + BigInt((frac + '0'.repeat(18)).slice(0, 18))).toString(16);
};

/** The current pool wallet's address, made if there is none (the pool tests leave one). */
export function currentWallet(): string {
  if (sql("SELECT count(*) FROM pool_wallets WHERE status = 'CURRENT'") === '0') seedPoolSamples();
  return sql("SELECT address FROM pool_wallets WHERE status = 'CURRENT'");
}

/** A wallet retired 9 days ago whose watch has ended, so what reaches it now is a late payment. */
export function seedRetiredWallet(): { id: string; address: string } {
  const id = randomUUID();
  const address = Wallet.createRandom().address.toLowerCase();
  const by = `(SELECT id FROM accounts WHERE lower(email) = lower('${stack().admin.email}'))`;
  sql(`INSERT INTO pool_wallets (id, address, status, slot, signers, threshold, current_from, current_until, watch_until, proposed_by, proposed_by_email, proposed_at, proposal_note, decided_by, decided_by_email, decided_at)
    VALUES ('${id}', '${address}', 'RETIRED', NULL, '${Wallet.createRandom().address.toLowerCase()}', 1, now() - interval '200 days', now() - interval '9 days', now() - interval '2 days',
    ${by}, '${stack().admin.email}', now() - interval '201 days', 'Sweep test wallet', ${by}, 'earlier-admin@test.local', now() - interval '200 days')`);
  return { id, address };
}

/** USDT a Lipa payment sent to a retired wallet after its watch ended, as the backend records it: waiting for a sweep. */
export function seedLatePayment(walletId: string, quote: SeededQuote, amount: string): string {
  const id = randomUUID();
  sql(`INSERT INTO late_wallet_payments (id, wallet_id, quote_id, payment_id, tx_hash, amount, arrived_at, block_number, log_index, status, recorded_at)
    VALUES ('${id}', '${walletId}', '${quote.id}', 'lp_${randomOf('0123456789abcdef', 8)}', '0x${randomOf('0123456789abcdef', 64)}', ${amount},
    now() - interval '1 day', 64, 0, 'WAITING', now() - interval '1 day')`);
  return id;
}

/** What a wallet holds on the chain stand-in. */
export async function chainBalances(holder: string, usdt: string, blocks: string) {
  await post(`${stack().chainUrl}/balances`, { token: USDT_TOKEN, holder, raw: raw(usdt) });
  await post(`${stack().chainUrl}/balances`, { token: BLOCKS_TOKEN, holder, raw: raw(blocks) });
}

/**
 * A sweep the wallet's signers made on the chain stand-in: a transaction moving `usdt` and `blocks` (either may be
 * '0') from one wallet to another, mined now in block 128. Returns its hash.
 */
export async function chainSweep(from: string, to: string, usdt: string, blocks: string): Promise<string> {
  const hash = '0x' + randomOf('0123456789abcdef', 64);
  const logs = [
    ...(usdt !== '0' ? [{ address: USDT_TOKEN, topics: [TRANSFER, topic(from), topic(to)], data: '0x' + raw(usdt).padStart(64, '0'), logIndex: 3 }] : []),
    ...(blocks !== '0' ? [{ address: BLOCKS_TOKEN, topics: [TRANSFER, topic(from), topic(to)], data: '0x' + raw(blocks).padStart(64, '0'), logIndex: 4 }] : [])
  ];
  await post(`${stack().chainUrl}/receipts`, { hash, block: 128, time: Math.floor(Date.now() / 1000), logs });
  return hash;
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

/**
 * A few months of the dashboard's chart history for screenshots, made once: a nightly Liquid Funds figure for 120
 * nights and a pool calculation with backing split by asset for 60 days, both ending three days ago, before the stack's
 * own calculations. Only the screenshot run seeds it, after every flow has run.
 */
export function seedChartHistory() {
  if (sql("SELECT count(*) FROM underwriting_inputs WHERE calculated_at < now() - interval '2 days'") === '0') {
    sql(`INSERT INTO underwriting_inputs (base_default_rate, base_default_rate_fallback, loans_defaulted, loans_repaid_on_time,
      average_strength_tenure, recovery_rate, recovery_rate_fallback, recovered_closed, claims_paid_closed, liquidity_ratio,
      liquidity_ratio_fallback, pool_size, liquid_funds, premiums_received, refunds_paid, claims_paid, recovered, extra_liquidity, calculated_at)
      SELECT 0.04, true, 0, 0, NULL, 0.35, true, 0, 0, 0.3, true, 120000,
        round((18000 + (120 - d) * 230 + 1800 * sin(d / 6.0) - CASE WHEN d < 40 THEN 4200 ELSE 0 END)::numeric, 2), 0, 0, 0, 0, 0,
        date_trunc('day', now() - make_interval(days => d)) + interval '3 hours 5 minutes'
      FROM generate_series(3, 120) AS d`);
  }
  if (sql("SELECT count(*) FROM pool_snapshots WHERE backing_blocks_usdt IS NOT NULL AND calculated_at < now() - interval '2 days'") === '0') {
    sql(`INSERT INTO pool_snapshots (total_backing_usdt, total_outstanding, total_network_value, utilization_threshold, expected_utilization,
      correction_factor, members_counted, trigger_reason, calculated_at, backing_blocks_usdt, backing_kes_usdt, backing_vault_usdt)
      SELECT b + k + v, 9000, b + k + v - 9000, 0.75, 0.5, 1, 4, 'SCHEDULED', now() - make_interval(days => d), b, k, v
      FROM (SELECT d, round((52000 + (60 - d) * 310 + 900 * sin(d / 4.0))::numeric, 2) AS b,
              round((14000 + (60 - d) * 95)::numeric, 2) AS k, round((8000 + CASE WHEN d < 25 THEN 6000 ELSE 0 END)::numeric, 2) AS v
            FROM generate_series(3, 60) AS d) s`);
  }
  // the backend reads the latest calculation by id, so the newest by time is copied to the top again
  for (const table of ['underwriting_inputs', 'pool_snapshots']) {
    const cols = sql(`SELECT string_agg(column_name, ', ') FROM information_schema.columns WHERE table_name = '${table}' AND column_name <> 'id'`);
    sql(`INSERT INTO ${table} (${cols}) SELECT ${cols} FROM ${table} WHERE id = (SELECT id FROM ${table} ORDER BY calculated_at DESC, id DESC LIMIT 1)
      AND id <> (SELECT max(id) FROM ${table})`);
  }
}

export interface SeededMonth {
  /** a late payment whose transfer was read */
  matched: SeededQuote;
  /** a late payment whose transaction moved nothing read */
  missing: SeededQuote;
  /** the sender of USDT no record names */
  stranger: string;
}

/**
 * A month for the reconciliation (E2), in the past so nothing else writes to it: a retired wallet, two late payments to
 * it on the 10th and 12th, the first one's transfer read on-chain and the second one's not, and 7 USDT arriving on
 * the 14th that no record names. Every pool wallet's transfers are marked read to now, so the month is complete; a
 * local run reads no chain, so the transfers go straight in, as the reader would store them.
 */
export async function seedReconciliationMonth(month: string): Promise<SeededMonth> {
  const wallet = seedRetiredWallet();
  const member = await newMember('Month', 'Payer');
  const matched = seedQuote(member, { status: 'EXPIRED', quotedDaysAgo: 3 });
  const missing = seedQuote(member, { status: 'EXPIRED', quotedDaysAgo: 2 });
  const stranger = Wallet.createRandom().address.toLowerCase();
  const payer = Wallet.createRandom().address.toLowerCase();
  const at = (day: number) => `timestamptz '${month}-${String(day).padStart(2, '0')} 10:00:00+03'`;
  const late = (q: SeededQuote, tx: string, amount: string, day: number) =>
    sql(`INSERT INTO late_wallet_payments (id, wallet_id, quote_id, payment_id, tx_hash, amount, arrived_at, block_number, log_index, status, recorded_at)
      VALUES ('${randomUUID()}', '${wallet.id}', '${q.id}', 'lp_${randomOf('0123456789abcdef', 8)}', '${tx}', ${amount}, ${at(day)}, ${day}, 0, 'WAITING', ${at(day)})`);
  const transfer = (tx: string, from: string, amount: string, day: number) =>
    sql(`INSERT INTO pool_wallet_transfers (id, wallet_id, token, direction, counterparty, tx_hash, log_index, amount, block_number, mined_at, read_at)
      VALUES ('${randomUUID()}', '${wallet.id}', 'USDT', 'IN', '${from}', '${tx}', 0, ${amount}, ${day}, ${at(day)}, now())`);
  const paid = randomHash();
  late(matched, paid, '40', 10);
  transfer(paid, payer, '40', 10);
  late(missing, randomHash(), '25', 12);
  transfer(randomHash(), stranger, '7', 14);
  sql(`INSERT INTO pool_wallet_transfer_reads (wallet_id, read_to_block, read_to_time, read_at)
    SELECT id, 1000, now(), now() FROM pool_wallets WHERE status IN ('CURRENT', 'RETIRED')
    ON CONFLICT (wallet_id) DO UPDATE SET read_to_time = now(), read_at = now()`);
  return { matched, missing, stranger };
}

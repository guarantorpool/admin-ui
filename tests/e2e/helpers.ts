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
export function seedQuote(member: Member, opts: { status?: 'OPEN' | 'PAID' | 'REPLACED' | 'EXPIRED'; flagged?: boolean; lipa?: { status: 'PROCESSING' | 'SUCCESS' | 'FAILED'; message?: string }; guaranteeId?: string; quotedDaysAgo?: number } = {}): SeededQuote {
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
    payment_status, failure_reason, failure_message, check_anchor_at)
    VALUES ('${id}', '${quoteId}', '${member.id}', 5000, 6, '${opts.status ?? 'OPEN'}', ${quotedAt}, ${quotedAt} + interval '30 minutes',
    ${opts.guaranteeId ? `'${opts.guaranteeId}'` : 'NULL'}, ${pricing(flagged)}, false, false, false,
    ${fee}, ${amountDue}, 0.1, 1, 50, ${lipa ? `'lipa-${randomOf('0123456789abcdef', 12)}'` : 'NULL'},
    ${lipa ? `'${lipa.status}'` : 'NULL'}, ${lipa?.status === 'FAILED' ? "'INSUFFICIENT_FUNDS'" : 'NULL'},
    ${lipa?.message ? `'${lipa.message}'` : 'NULL'}, ${quotedAt})`);
  return { quoteId, amountDue, id };
}

export interface SeededGuarantee {
  guaranteeId: string;
  quoteId: string;
  txHash: string;
  /** the database ID of its confirmed payment, which a refund owed on it points at */
  paymentId: string;
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
  return { guaranteeId, quoteId, txHash, paymentId };
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

export const randomIdNumber = () =>String(10_000_000 + Math.floor(Math.random() * 89_999_999));

/**
 * Invites an admin with a new role holding `permissions`, and sets their password through the portal's
 * /set-password page from the invitation email. Returns their email and password.
 */
export async function newAdmin(page: Page, permissions: string[], label: string) {
  const { apiBase, admin } = stack();
  const token = await apiToken(admin.email, admin.password);
  seq += 1;
  const tag = `${label}${Date.now().toString(36)}${seq}`;
  const role = await post<{ id: string }>(`${apiBase}/roles`, { name: `Test ${tag}`, permissions }, token);
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
  return { email, password };
}

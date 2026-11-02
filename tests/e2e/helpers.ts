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

export const randomIdNumber = () => String(10_000_000 + Math.floor(Math.random() * 89_999_999));

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

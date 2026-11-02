import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { linkIn, loginCode, readMails, waitForMail, type Mail } from '../../scripts/local-stack.mjs';

interface StackState {
  apiBase: string;
  admin: { email: string; password: string };
  logPath: string;
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

export async function post<T>(url: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`${url} answered ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

let seq = 0;

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
  await post(`${apiBase}/admins`, { firstName: 'Test', lastName: label, email, phoneNumber: `07${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, roleId: role.id }, token);
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

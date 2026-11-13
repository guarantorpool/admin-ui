// The admin session (D-001). Tokens live in localStorage, so every tab shares one session; storage events
// keep the tabs in step. After the idle time with no activity in any tab, every tab locks: the session is
// ended on the backend and the tokens cleared, but the email is kept and each tab stays on its page.
// The backend has the same idle limit: an admin's refresh token stops working 30 minutes after it was issued, so
// while the admin is active the portal refreshes ahead of that (keepAlive), and an idle session ends on both sides.

import { env } from '@/lib/env';
import type { LoginProfile } from '@/api/types';

export const SESSION_KEY = 'blockcoop-admin.session';
export const ACTIVITY_KEY = 'blockcoop-admin.activity';
export const LOCKED_KEY = 'blockcoop-admin.locked';
const REFRESH_LOCK = 'blockcoop-admin.refresh';

/** Refresh this long before the access token expires, so a request never goes out with a dying token. */
export const EXPIRY_SKEW_MS = 30_000;
/** Activity is written at most this often, so typing doesn't write to storage on every key. */
const ACTIVITY_WRITE_MS = 10_000;
/**
 * keepAlive refreshes once the refresh token is this old and there was activity since it was issued, so the
 * backend's idle limit is always at least the idle time after the last activity, and at most this much more.
 */
export const KEEP_ALIVE_AFTER_MS = 5 * 60_000;

export interface Session {
  accountId: string;
  firstName: string;
  lastName: string;
  email: string;
  picUrl: string | null;
  role: string | null;
  permissions: string[];
  token: string;
  /** epoch ms */
  tokenExpiry: number;
  refreshToken: string;
  /** epoch ms */
  refreshTokenExpiry: number;
  /** epoch ms, when this browser got the current refresh token; missing in a session stored before #34 */
  issuedAt?: number;
}

export interface Locked {
  email: string;
  /** epoch ms */
  at: number;
}

export type SessionState =
  | { status: 'signedOut'; session: null; locked: null }
  | { status: 'locked'; session: null; locked: Locked }
  /** `switched`: this tab showed the lock screen for another admin, so the page it kept is not this admin's. */
  | { status: 'signedIn'; session: Session; locked: null; switched?: boolean };

// ------------------------------------------------------------------ storage

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked: the session lasts as long as this tab's memory
  }
}

function isSession(v: unknown): v is Session {
  const s = v as Session | null;
  return !!s && typeof s.token === 'string' && typeof s.refreshToken === 'string' && typeof s.tokenExpiry === 'number'
    && typeof s.refreshTokenExpiry === 'number' && typeof s.email === 'string' && Array.isArray(s.permissions);
}

export function readSession(): Session | null {
  const s = read<unknown>(SESSION_KEY);
  return isSession(s) ? s : null;
}

export function readLocked(): Locked | null {
  const l = read<Locked>(LOCKED_KEY);
  return l && typeof l.email === 'string' ? l : null;
}

export function lastActivity(): number {
  const n = read<number>(ACTIVITY_KEY);
  return typeof n === 'number' ? n : 0;
}

export function fromLogin(p: LoginProfile, now = Date.now()): Session {
  return {
    accountId: p.accountId ?? '',
    firstName: p.firstName ?? '',
    lastName: p.lastName ?? '',
    email: p.email ?? '',
    picUrl: p.picUrl ?? null,
    role: p.role ?? null,
    permissions: p.permissions ?? [],
    token: p.token ?? '',
    tokenExpiry: p.tokenExpiry ?? 0,
    refreshToken: p.refreshToken ?? '',
    refreshTokenExpiry: p.refreshTokenExpiry ?? 0,
    issuedAt: now
  };
}

// ------------------------------------------------------------------ state for React

const listeners = new Set<() => void>();
let snapshot: SessionState = compute();
/**
 * The admin this tab last showed the lock screen for, until someone signs in. It outlasts a forgotten lock
 * ("Sign in as someone else"), so a tab that kept the locked admin's page still learns the admin changed.
 */
let lockedFor: string | null = snapshot.locked?.email ?? null;

function compute(): SessionState {
  const session = readSession();
  if (session) return { status: 'signedIn', session, locked: null };
  const locked = readLocked();
  if (locked) return { status: 'locked', session: null, locked };
  return { status: 'signedOut', session: null, locked: null };
}

function emit(): void {
  const next = compute();
  const same = next.status === snapshot.status
    && JSON.stringify(next.session) === JSON.stringify(snapshot.session)
    && JSON.stringify(next.locked) === JSON.stringify(snapshot.locked);
  if (!same) {
    if (next.status === 'locked') lockedFor = next.locked.email;
    if (next.status === 'signedIn') {
      if (lockedFor !== null && isOtherAdmin({ email: lockedFor, at: 0 }, next.session.email)) next.switched = true;
      lockedFor = null;
    }
    snapshot = next;
  }
  listeners.forEach((l) => l());
}

export function getState(): SessionState {
  return snapshot;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Another tab changed the session, the lock or the activity time. */
export function onStorage(e: StorageEvent): void {
  if (e.key === null || e.key === SESSION_KEY || e.key === LOCKED_KEY) emit();
}

// ------------------------------------------------------------------ changes

export function signedIn(profile: LoginProfile, now = Date.now()): Session {
  const session = fromLogin(profile, now);
  // activity first: another tab that sees the new session before the new activity time would find
  // every tab idle and lock them all again
  write(ACTIVITY_KEY, now);
  // the session before clearing the lock, so another tab goes straight from locked to signed in, never
  // through signed out (which would send it to the sign-in page)
  write(SESSION_KEY, session);
  write(LOCKED_KEY, null);
  notice = null;
  emit();
  return session;
}

/** Updates the cached name or picture after the admin edits their profile. */
export function updateProfile(changes: Partial<Pick<Session, 'firstName' | 'lastName' | 'picUrl'>>): void {
  const s = readSession();
  if (!s) return;
  write(SESSION_KEY, { ...s, ...changes });
  emit();
}

let notice: string | null = null;

/** Why this tab was signed out, shown on the sign-in page until the next sign-in. */
export function signOutNotice(): string | null {
  return notice;
}

/**
 * Clears the tokens without a backend call: the session already ended there. `reason` is shown on the
 * sign-in page this tab is sent to.
 */
export function clearSession(reason?: string): void {
  notice = reason ?? null;
  lockedFor = null;
  write(SESSION_KEY, null);
  write(LOCKED_KEY, null);
  emit();
}

let lastActivityWrite = 0;

/** Records activity in this tab; every tab reads it before locking. */
export function markActivity(now = Date.now()): void {
  if (now - lastActivityWrite < ACTIVITY_WRITE_MS) return;
  lastActivityWrite = now;
  write(ACTIVITY_KEY, now);
}

export function idleMs(): number {
  return env.idleLockMinutes * 60_000;
}

/** True when no tab has had activity for the idle time. */
export function isIdle(now = Date.now()): boolean {
  return now - lastActivity() >= idleMs();
}

/**
 * True when the session should be refreshed to keep it alive on the backend: there was activity since the refresh
 * token was issued, and it is at least KEEP_ALIVE_AFTER_MS old.
 */
export function needsKeepAlive(session: Session, now = Date.now()): boolean {
  const issuedAt = session.issuedAt ?? 0;
  return now - issuedAt >= KEEP_ALIVE_AFTER_MS && lastActivity() > issuedAt;
}

/**
 * Refreshes the session while the admin is active, before the backend's idle limit ends it (admin-ui#34). Any tab
 * may call it; the refresh lock means only one refreshes, and the others find the new tokens.
 */
export async function keepAlive(now = Date.now()): Promise<void> {
  const session = readSession();
  if (!session || isIdle(now) || !needsKeepAlive(session, now)) return;
  try {
    await refresh(session.token, true);
  } catch {
    // offline or the backend failed: the next check tries again, and a request refreshes on its own
  }
}

// ------------------------------------------------------------------ backend calls

function url(path: string): string {
  return env.apiBaseUrl + path;
}

async function postJson(path: string, body: unknown, token?: string): Promise<Response> {
  return fetch(url(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
}

/** Ends this session on the backend. Best effort: the tokens are cleared here whatever it answers. */
async function endOnBackend(session: Session): Promise<void> {
  try {
    await postJson('/auth/logout', { refreshToken: session.refreshToken });
  } catch {
    // offline: the refresh token expires on its own (30 idle minutes for admins, #34)
  }
}

/** Locks every tab (D-001). The email is kept so unlocking only asks for the password and code. */
export async function lock(now = Date.now()): Promise<void> {
  const session = readSession();
  if (!session) return;
  write(LOCKED_KEY, { email: session.email, at: now } satisfies Locked);
  write(SESSION_KEY, null);
  emit();
  await endOnBackend(session);
}

/** Signs out of this session in every tab, and forgets the email. */
export async function signOut(reason?: string): Promise<void> {
  const session = readSession();
  clearSession(reason);
  if (session) await endOnBackend(session);
}

/** Forgets a locked session's email, for "Sign in as someone else". */
export function forgetLocked(): void {
  write(LOCKED_KEY, null);
  emit();
}

/** The route guards have sent this tab to the new admin's first screen after a `switched` sign-in. */
export function ackAdminSwitch(): void {
  if (snapshot.status !== 'signedIn' || !snapshot.switched) return;
  snapshot = { ...snapshot, switched: false };
  listeners.forEach((l) => l());
}

/**
 * True when the lock screen is being used to sign in as a different admin than the one it locked, so the
 * lock (and the page it kept) belongs to someone else and is forgotten.
 */
export function isOtherAdmin(locked: Locked | null | undefined, email: string): boolean {
  if (!locked) return false;
  return locked.email.trim().toLowerCase() !== email.trim().toLowerCase();
}

let inTabRefresh: Promise<Session | null> | null = null;

/**
 * Exchanges the refresh token for new tokens, one tab at a time: each refresh token works once and the
 * backend answers a second use with 401, so two tabs refreshing together would sign one of them out.
 * Whoever gets the lock second finds the new tokens already stored and uses them.
 *
 * @param staleToken the access token the caller found expired or had refused
 * @param keepingAlive true for keepAlive: the access token is still good, and the refresh is only to keep the
 *   session alive, so a tab that waited and finds any newer session stored skips its own refresh
 * @returns the session to use, or null when it has ended (the tokens are then cleared)
 */
export function refresh(staleToken: string, keepingAlive = false): Promise<Session | null> {
  const run = async (): Promise<Session | null> => {
    const current = readSession();
    if (!current) return null;
    if (current.token !== staleToken && (keepingAlive || current.tokenExpiry - Date.now() > EXPIRY_SKEW_MS)) return current;
    if (current.refreshTokenExpiry <= Date.now()) {
      clearSession();
      return null;
    }
    const res = await postJson('/auth/refresh-token', { refreshToken: current.refreshToken });
    if (res.status === 401 || res.status === 403) {
      clearSession();
      return null;
    }
    if (!res.ok) throw new Error(`Refreshing the session failed (${res.status})`);
    const body = (await res.json()) as { profile?: LoginProfile };
    if (!body.profile) throw new Error('Refreshing the session returned no tokens');
    const next = fromLogin(body.profile);
    write(SESSION_KEY, next);
    emit();
    return next;
  };

  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  // the callback's promise is awaited by the lock; its typings wrap it once more
  if (locks?.request) return locks.request(REFRESH_LOCK, run) as unknown as Promise<Session | null>;
  // no Web Locks (very old browser): at least one refresh at a time within this tab
  inTabRefresh ??= run().finally(() => {
    inTabRefresh = null;
  });
  return inTabRefresh;
}

/** For tests: re-reads storage after it was changed directly. */
export function reload(): void {
  lastActivityWrite = 0;
  lockedFor = null;
  emit();
}

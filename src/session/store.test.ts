import type { LoginProfile } from '@/api/types';
import * as store from './store';

const NOW = Date.UTC(2026, 10, 2, 9, 0);

function profile(n: number, over: Partial<LoginProfile> = {}): LoginProfile {
  return {
    accountId: 'a1',
    accountType: 'admin',
    firstName: 'Ada',
    lastName: 'Admin',
    email: 'admin-a@test.local',
    role: 'ROLE_SYSTEM_ADMIN',
    permissions: ['MEMBERS.READ'],
    token: `access-${n}`,
    tokenExpiry: NOW + 30 * 60_000,
    refreshToken: `refresh-${n}`,
    refreshTokenExpiry: NOW + 12 * 3_600_000,
    ...over
  };
}

function reply(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  localStorage.clear();
  store.reload();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('signing in', () => {
  it('stores the session for every tab and clears any lock', () => {
    localStorage.setItem(store.LOCKED_KEY, JSON.stringify({ email: 'x', at: 1 }));
    store.signedIn(profile(1));
    expect(store.getState().status).toBe('signedIn');
    expect(store.readSession()?.token).toBe('access-1');
    expect(store.readLocked()).toBeNull();
    expect(store.lastActivity()).toBe(NOW);
  });

  it('writes the activity time before the session, so another tab never sees the new session as idle', () => {
    const order: string[] = [];
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string) {
      order.push(k);
    });
    store.signedIn(profile(1));
    set.mockRestore();
    expect(order.indexOf(store.ACTIVITY_KEY)).toBeLessThan(order.indexOf(store.SESSION_KEY));
  });

  it('keeps why this tab was signed out until the next sign-in', () => {
    store.signedIn(profile(1));
    store.clearSession('You signed out of every session.');
    expect(store.signOutNotice()).toBe('You signed out of every session.');
    store.signedIn(profile(2));
    expect(store.signOutNotice()).toBeNull();
  });

  it('ignores a malformed stored session', () => {
    localStorage.setItem(store.SESSION_KEY, JSON.stringify({ token: 1 }));
    store.reload();
    expect(store.getState().status).toBe('signedOut');
  });
});

describe('idle lock (D-001)', () => {
  it('is idle only after the idle time with no activity in any tab', () => {
    store.signedIn(profile(1));
    expect(store.isIdle(NOW + 4 * 60_000)).toBe(false);
    expect(store.isIdle(NOW + 5 * 60_000)).toBe(true);
    store.markActivity(NOW + 4 * 60_000);
    expect(store.isIdle(NOW + 8 * 60_000)).toBe(false);
  });

  it('writes activity at most every 10 seconds', () => {
    store.markActivity(NOW + 20_000);
    store.markActivity(NOW + 25_000);
    expect(store.lastActivity()).toBe(NOW + 20_000);
    store.markActivity(NOW + 31_000);
    expect(store.lastActivity()).toBe(NOW + 31_000);
  });

  it('ends the session on the backend, clears the tokens and keeps the email', async () => {
    fetchMock.mockResolvedValue(reply(200));
    store.signedIn(profile(1));
    await store.lock();
    expect(store.getState()).toMatchObject({ status: 'locked', locked: { email: 'admin-a@test.local' } });
    expect(store.readSession()).toBeNull();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://api.test/api/auth/logout');
    expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: 'refresh-1' });
  });

  it('still locks when the backend cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    store.signedIn(profile(1));
    await store.lock();
    expect(store.getState().status).toBe('locked');
  });

  it('follows another tab locking', () => {
    store.signedIn(profile(1));
    localStorage.removeItem(store.SESSION_KEY);
    localStorage.setItem(store.LOCKED_KEY, JSON.stringify({ email: 'admin-a@test.local', at: NOW }));
    store.onStorage(new StorageEvent('storage', { key: store.SESSION_KEY }));
    expect(store.getState().status).toBe('locked');
  });

  it('forgets the email for someone else to sign in', async () => {
    fetchMock.mockResolvedValue(reply(200));
    store.signedIn(profile(1));
    await store.lock();
    store.forgetLocked();
    expect(store.getState().status).toBe('signedOut');
  });

  it('tells another admin signing in from the lock screen apart from the one it locked', () => {
    const locked = { email: 'admin-a@test.local', at: NOW };
    expect(store.isOtherAdmin(locked, ' Admin-A@test.local ')).toBe(false);
    expect(store.isOtherAdmin(locked, 'admin-b@test.local')).toBe(true);
    expect(store.isOtherAdmin(null, 'admin-b@test.local')).toBe(false);
  });

  it('marks the session switched when another admin signs in after the lock, in this tab or another', async () => {
    fetchMock.mockResolvedValue(reply(200));
    store.signedIn(profile(1));
    await store.lock();
    store.signedIn(profile(2, { email: 'admin-b@test.local' }));
    const state = store.getState();
    expect(state.status === 'signedIn' && state.switched).toBe(true);
    store.ackAdminSwitch();
    const after = store.getState();
    expect(after.status === 'signedIn' && after.switched).toBe(false);

    // another tab: the lock and then the new session arrive through storage events
    localStorage.removeItem(store.SESSION_KEY);
    localStorage.setItem(store.LOCKED_KEY, JSON.stringify({ email: 'admin-b@test.local', at: NOW }));
    store.onStorage(new StorageEvent('storage', { key: store.LOCKED_KEY }));
    localStorage.setItem(store.SESSION_KEY, JSON.stringify(store.fromLogin(profile(3))));
    localStorage.removeItem(store.LOCKED_KEY);
    store.onStorage(new StorageEvent('storage', { key: store.SESSION_KEY }));
    const other = store.getState();
    expect(other.status === 'signedIn' && other.switched).toBe(true);
  });

  it('does not mark the session switched when the locked admin signs back in', async () => {
    fetchMock.mockResolvedValue(reply(200));
    store.signedIn(profile(1));
    await store.lock();
    store.signedIn(profile(2, { email: 'Admin-A@test.local' }));
    const state = store.getState();
    expect(state.status === 'signedIn' && state.switched).toBeFalsy();
  });

  it('stores the new session before clearing the lock, so another tab never passes through signed out', () => {
    const order: string[] = [];
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string) {
      order.push(`set:${k}`);
    });
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, k: string) {
      order.push(`remove:${k}`);
    });
    store.signedIn(profile(1));
    set.mockRestore();
    remove.mockRestore();
    expect(order.indexOf(`set:${store.SESSION_KEY}`)).toBeLessThan(order.indexOf(`remove:${store.LOCKED_KEY}`));
  });
});

describe('refresh', () => {
  it('swaps the refresh token for new tokens', async () => {
    store.signedIn(profile(1));
    fetchMock.mockResolvedValueOnce(reply(200, { profile: profile(2) }));
    const next = await store.refresh('access-1');
    expect(next?.token).toBe('access-2');
    expect(store.readSession()?.refreshToken).toBe('refresh-2');
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({ refreshToken: 'refresh-1' });
  });

  it('uses tokens another tab already refreshed instead of spending the refresh token again', async () => {
    store.signedIn(profile(1));
    localStorage.setItem(store.SESSION_KEY, JSON.stringify(store.fromLogin(profile(2))));
    const next = await store.refresh('access-1');
    expect(next?.token).toBe('access-2');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes once when several requests find the token expired together', async () => {
    store.signedIn(profile(1, { tokenExpiry: NOW + 1000 }));
    let calls = 0;
    fetchMock.mockImplementation(async () => {
      calls++;
      return reply(200, { profile: profile(2) });
    });
    const results = await Promise.all([store.refresh('access-1'), store.refresh('access-1'), store.refresh('access-1')]);
    expect(results.map((r) => r?.token)).toEqual(['access-2', 'access-2', 'access-2']);
    expect(calls).toBe(1);
  });

  it('signs out when the backend refuses the refresh token', async () => {
    store.signedIn(profile(1));
    fetchMock.mockResolvedValueOnce(reply(401, { title: 'Unauthorized', message: 'Invalid or expired refresh token', code: 401 }));
    expect(await store.refresh('access-1')).toBeNull();
    expect(store.getState().status).toBe('signedOut');
  });

  it('signs out without a call when the refresh token has expired', async () => {
    store.signedIn(profile(1, { refreshTokenExpiry: NOW - 1 }));
    expect(await store.refresh('access-1')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the session when the backend is unreachable or failing', async () => {
    store.signedIn(profile(1));
    fetchMock.mockResolvedValueOnce(reply(503));
    await expect(store.refresh('access-1')).rejects.toThrow('503');
    expect(store.getState().status).toBe('signedIn');
  });
});

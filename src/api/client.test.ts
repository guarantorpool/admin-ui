import type { LoginProfile } from './types';
import * as store from '@/session/store';
import { api } from './client';
import { ApiError, errorMessage } from './errors';

const NOW = Date.UTC(2026, 10, 2, 9, 0);

function profile(n: number, expiresIn = 30 * 60_000): LoginProfile {
  return {
    accountId: 'a1', firstName: 'Ada', lastName: 'Admin', email: 'a@test.local', role: 'r', permissions: [],
    token: `access-${n}`, tokenExpiry: NOW + expiresIn, refreshToken: `refresh-${n}`, refreshTokenExpiry: NOW + 3_600_000
  };
}

const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchMock = vi.fn<typeof fetch>();
const authOf = (i: number) => (fetchMock.mock.calls[i]![1]?.headers as Record<string, string>).Authorization;

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

describe('api client', () => {
  it('calls the backend directly with the access token and query', async () => {
    store.signedIn(profile(1));
    fetchMock.mockResolvedValueOnce(reply(200, { id: 'x' }));
    expect(await api.get('/members', { query: { page: 0, q: '', status: undefined } })).toEqual({ id: 'x' });
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.test/api/members?page=0');
    expect(authOf(0)).toBe('Bearer access-1');
  });

  it('counts a change as activity, but not a read such as a background refetch (#34)', async () => {
    store.signedIn(profile(1));
    vi.setSystemTime(NOW + 60_000);
    fetchMock.mockResolvedValueOnce(reply(200, [])).mockResolvedValueOnce(reply(200, {}));
    await api.get('/alerts');
    expect(store.lastActivity()).toBe(NOW);
    await api.post('/approvals/x/approve', {});
    expect(store.lastActivity()).toBe(NOW + 60_000);
  });

  it('sends sign-in calls without a token', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, {}));
    await api.post('/auth/admin-login', { identifier: 'a', password: 'b' }, { auth: false });
    expect(authOf(0)).toBeUndefined();
  });

  it('refreshes first when the access token is about to expire', async () => {
    store.signedIn(profile(1, 10_000));
    fetchMock.mockResolvedValueOnce(reply(200, { profile: profile(2) })).mockResolvedValueOnce(reply(200, []));
    await api.get('/alerts');
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.test/api/auth/refresh-token');
    expect(authOf(1)).toBe('Bearer access-2');
  });

  it('refreshes and retries once when the token is refused', async () => {
    store.signedIn(profile(1));
    fetchMock
      .mockResolvedValueOnce(reply(401, { title: 'Unauthorized', message: 'Token expired', code: 401 }))
      .mockResolvedValueOnce(reply(200, { profile: profile(2) }))
      .mockResolvedValueOnce(reply(200, { ok: true }));
    expect(await api.get('/alerts')).toEqual({ ok: true });
    expect(authOf(2)).toBe('Bearer access-2');
  });

  it("uses the backend's own error wording", async () => {
    store.signedIn(profile(1));
    fetchMock.mockResolvedValueOnce(reply(403, { title: 'Forbidden', message: 'You do not have permission to do this', code: 403 }));
    const err = await api.get('/admins').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, title: 'Forbidden', message: 'You do not have permission to do this' });
  });

  it('falls back to a plain message when the error has no body', async () => {
    store.signedIn(profile(1));
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 502 }));
    const err = await api.get('/admins').catch((e: unknown) => e);
    expect(errorMessage(err)).toBe('The GP API answered 502. Try again.');
  });

  it('reports an unreachable backend, including a CORS refusal, as status 0', async () => {
    store.signedIn(profile(1));
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const err = await api.get('/admins').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0, isNetwork: true });
  });

  it('refuses without a call when signed out', async () => {
    const err = await api.get('/admins').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends uploads as form data, letting the browser set the boundary', async () => {
    store.signedIn(profile(1));
    fetchMock.mockResolvedValueOnce(reply(201, {}));
    const form = new FormData();
    form.append('file', new Blob(['x']), 'a.png');
    await api.post('/uploads/profile-image', form);
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.body).toBe(form);
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });
});

// Calls the GP API directly (no proxy), so CORS is exercised locally the same way it is when hosted.
// Adds the access token, refreshes it once when it is about to expire or is refused, and turns every
// failure into one ApiError.

import { env } from '@/lib/env';
import * as store from '@/session/store';
import { ApiError, networkError, toApiError } from './errors';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  query?: Query;
  /** JSON body, or FormData for an upload */
  body?: unknown;
  /** false for the sign-in calls, which take no token */
  auth?: boolean;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: Query): string {
  const u = new URL(env.apiBaseUrl + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== null && v !== undefined && v !== '') u.searchParams.set(k, String(v));
  }
  return u.toString();
}

/** The access token to send, refreshed first when it is about to expire. Throws 401 when signed out. */
async function currentToken(): Promise<string> {
  const session = store.readSession();
  if (!session) throw new ApiError(401, 'Not signed in', 'Your session has ended. Sign in again.');
  if (session.tokenExpiry - Date.now() > store.EXPIRY_SKEW_MS) return session.token;
  const next = await store.refresh(session.token);
  if (!next) throw new ApiError(401, 'Not signed in', 'Your session has ended. Sign in again.');
  return next.token;
}

async function send(method: Method, path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    return await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
      signal: opts.signal
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw networkError();
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

/** Sends a call with the token, refreshing it once if refused; a failure is thrown as an ApiError. */
async function authed(method: Method, path: string, opts: RequestOptions): Promise<Response> {
  const auth = opts.auth !== false;
  let token = auth ? await currentToken() : null;
  let res = await send(method, path, opts, token);

  // refused token (revoked, or the clock is off): refresh once and try again
  if (auth && res.status === 401 && token) {
    const next = await store.refresh(token);
    if (!next) throw await toApiError(res);
    token = next.token;
    res = await send(method, path, opts, token);
  }

  if (!res.ok) throw await toApiError(res);
  return res;
}

export async function request<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<T> {
  return parse<T>(await authed(method, path, opts));
}

/** A file the GP API sends, saved by the browser under the name it gives (or `fallback`). */
export async function download(path: string, fallback: string, opts: RequestOptions = {}): Promise<void> {
  const res = await authed('GET', path, opts);
  const named = /filename="?([^";]+)"?/i.exec(res.headers.get('Content-Disposition') ?? '');
  const url = URL.createObjectURL(await res.blob());
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = named?.[1] ?? fallback;
    document.body.append(a);
    a.click();
    a.remove();
  } finally {
    // after the click has started the save
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, { ...opts, body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PUT', path, { ...opts, body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PATCH', path, { ...opts, body }),
  delete: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, opts)
};

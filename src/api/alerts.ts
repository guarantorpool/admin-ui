import { api } from './client';
import type { Page } from './members';
import type { Schemas } from './types';

export type Alert = Schemas['AlertResponse'];

export interface AlertQuery {
  page: number;
  size: number;
  /** open, acknowledged or resolved; every status when left out */
  status?: string;
  type?: string;
  severity?: string;
}

/** Most recently seen first. */
export const listAlerts = (q: AlertQuery) => api.get<Page<Alert>>('/alerts', { query: { ...q } });

/** The GP API has no read of one alert, so it's looked for in the list, every status, newest first. */
export async function findAlert(id: string): Promise<Alert | null> {
  for (let page = 1; ; page++) {
    const found = await listAlerts({ page, size: 100 });
    const alert = found.results?.find((a) => a.id === id);
    if (alert) return alert;
    if (page >= (found.totalPages ?? 0)) return null;
  }
}

const changedAt = (a: Alert) => Math.max(...[a.lastSeenAt, a.acknowledgedAt, a.resolvedAt].map((t) => (t ? Date.parse(t) : 0)));

/** The later of two reads of one alert: whichever saw it last seen, acknowledged or resolved most recently. */
export function newerAlert(a?: Alert | null, b?: Alert | null): Alert | undefined {
  if (!a || !b) return a ?? b ?? undefined;
  return changedAt(a) > changedAt(b) ? a : b;
}

/** Marks an open alert seen, with what was done about it. It stays acknowledged until its condition clears. */
export const acknowledgeAlert = (id: string, note: string) =>
  api.post<Alert>(`/alerts/${encodeURIComponent(id)}/acknowledge`, { note } satisfies Schemas['AcknowledgeAlertRequest']);

/**
 * The figures behind an alert; none when there are none or they don't read. The GP API sends them as raw JSON,
 * an object, though its schema calls them a string.
 */
export function alertDetails(a: Alert): Record<string, unknown> {
  let parsed: unknown = a.details;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {};
    }
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

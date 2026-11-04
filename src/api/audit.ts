import { api } from './client';
import type { Page } from './members';
import type { Schemas } from './types';

export type AuditEntry = Schemas['AuditLogResponse'];

export interface AuditQuery {
  page: number;
  size: number;
  /** the exact action code */
  action?: string;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  /** first and last day, inclusive, as "2026-11-03" in Nairobi time */
  from?: string;
  to?: string;
}

/** Newest first. */
export const listAuditLog = (q: AuditQuery) => api.get<Page<AuditEntry>>('/audit-logs', { query: { ...q } });

export type LipaEvent = Schemas['LipaPaymentEventResponse'];

export interface LipaEventQuery {
  page: number;
  size: number;
  /** callback or status_check */
  source?: string;
  /** PROCESSING, SUCCESS or FAILED */
  status?: string;
  quoteId?: string;
  paymentId?: string;
  /** first and last day received, inclusive */
  from?: string;
  to?: string;
}

/**
 * Every Lipa API callback and status check that was stored, newest first (C6). A repeat of a status already stored for
 * an attempt isn't stored again. They're kept beside the audit log, not in it.
 */
export const listLipaEvents = (q: LipaEventQuery) => api.get<Page<LipaEvent>>('/audit-logs/lipa-events', { query: { ...q } });

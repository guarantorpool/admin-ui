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

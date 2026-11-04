import { api } from './client';
import type { Page } from './members';
import type { Schemas } from './types';

export type Approval = Schemas['ApprovalResponse'];
export type ApprovalKind = NonNullable<Approval['kind']>;
export type ApprovalCount = Schemas['ApprovalCountResponse'];

export interface ApprovalQuery {
  page: number;
  size: number;
  kind?: string;
  /** only what you can decide */
  forYou?: boolean;
}

export const approvalsKey = ['approvals'];
export const approvalCountKey = ['approvals', 'count'];

/** Everything waiting for a second admin, of the kinds you can read, longest waiting first. */
export const listApprovals = (q: ApprovalQuery) => api.get<Page<Approval>>('/approvals', { query: { ...q, forYou: q.forYou || undefined } });

/** How many items wait: all of them, the ones you can decide (for the menu badge), and per kind. */
export const getApprovalCount = () => api.get<ApprovalCount>('/approvals/count');

/**
 * Approves or rejects an item on the route the inbox gives for it, which still refuses the admin who entered it. Only
 * PATCH routes are decided here; a default to verify (POST) is verified on its loan, against its documents.
 */
export function decideApproval(item: Approval, approval: 'approve' | 'reject', note?: string) {
  const route = approval === 'approve' ? item.approve : item.reject;
  if (!route?.path || route.method !== 'PATCH') throw new Error(`This item can't be ${approval === 'approve' ? 'approved' : 'rejected'} here.`);
  return api.patch<unknown>(route.path, (note ? { note } : {}) satisfies Schemas['DecisionRequest']);
}

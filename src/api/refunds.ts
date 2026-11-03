import { api } from './client';
import type { Page } from './members';
import type { Schemas } from './types';
import { fullName } from '@/lib/names';

export type Refund = Schemas['RefundResponse'];
export type RefundStatus = NonNullable<Refund['status']>;
export type RefundType = NonNullable<Refund['type']>;

export interface RefundQuery {
  page: number;
  size: number;
  status?: string;
  type?: string;
  /** the refunds owed on one payment */
  paymentId?: string;
}

// A refund has no business ID; it's named by the guarantee (GPG-…) or quote (GPQ-…) it's owed on.

/** What a refund is owed on: its guarantee, or the quote when no guarantee was created. */
export const owedOn = (r: Refund) => r.guaranteeId ?? r.quoteId ?? '—';

/** Its member's name and number, as the refund carries them. */
export const refundMember = (r: Refund) => `${fullName(r) || 'Unnamed member'}, ${r.memberNumber ?? '—'}`;

export const listRefunds = (q: RefundQuery) => api.get<Page<Refund>>('/refunds', { query: { ...q } });

export const getRefund = (id: string) => api.get<Refund>(`/refunds/${encodeURIComponent(id)}`);

/** Records how an owed refund was paid back, by USDT transfer, for a second admin to approve. */
export const enterPayout = (id: string, payout: { reference: string; paidAt: string; note?: string }) =>
  api.post<Refund>(`/refunds/${encodeURIComponent(id)}/payout`, payout satisfies Schemas['RefundPayoutRequest']);

/** Approves or rejects a recorded payout; only an admin who didn't enter it can. */
export const decidePayout = (id: string, approval: 'approve' | 'reject', note?: string) =>
  api.patch<Refund>(`/refunds/${encodeURIComponent(id)}/payout/${approval}`, (note ? { note } : {}) satisfies Schemas['DecisionRequest']);

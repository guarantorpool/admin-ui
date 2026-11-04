import { api } from './client';
import type { Page } from './members';
import type { Payment } from './guarantees';
import type { Schemas } from './types';

export type MemberPayment = Schemas['MemberPaymentResponse'];

export interface PaymentQuery {
  page: number;
  size: number;
  status?: string;
  method?: string;
  memberId?: string;
  /** part of the guarantee ID, ignoring case */
  search?: string;
  /** the first and last days it started, both included (yyyy-mm-dd, Nairobi time) */
  from?: string;
  to?: string;
}

/** Every premium payment across guarantees, newest first. */
export const listPayments = (q: PaymentQuery) => api.get<Page<MemberPayment>>('/guarantees/payments', { query: { ...q } });

/** One payment on a guarantee. */
export const getPayment = (guaranteeId: string, paymentId: string) =>
  api.get<Payment>(`/guarantees/${encodeURIComponent(guaranteeId)}/payments/${encodeURIComponent(paymentId)}`);

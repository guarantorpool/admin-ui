import { api } from './client';
import type { Page } from './members';
import type { Schemas } from './types';

export type Guarantee = Schemas['GuaranteeResponse'];
export type GuaranteeStatus = NonNullable<Guarantee['status']>;
export type Quote = Schemas['QuoteResponse'];
export type QuoteStatus = NonNullable<Quote['status']>;
export type Underwriting = Schemas['Underwriting'];
export type Payment = Schemas['PaymentResponse'];

export interface GuaranteeQuery {
  page: number;
  size: number;
  memberId?: string;
  status?: string;
  /** only those whose premium is below their expected loss (COV under 1) */
  flagged?: boolean;
  /** part of the GPG-… or GPQ-… ID, ignoring case */
  search?: string;
}

// Guarantees and quotes are named by their business IDs (GPG-…, GPQ-…); the database ID is never shown.

export const listGuarantees = (q: GuaranteeQuery) => api.get<Page<Guarantee>>('/guarantees', { query: { ...q } });

export const getGuarantee = (id: string) => api.get<Guarantee>(`/guarantees/${encodeURIComponent(id)}`);

/** Every attempt to pay the guarantee, oldest first. */
export const getPayments = (id: string) => api.get<Payment[]>(`/guarantees/${encodeURIComponent(id)}/payments`);

export const listQuotes = (q: GuaranteeQuery) => api.get<Page<Quote>>('/guarantees/quotes', { query: { ...q } });

export const getQuote = (id: string) => api.get<Quote>(`/guarantees/quotes/${encodeURIComponent(id)}`);

/** Enters a manual close of an active guarantee, for a second admin to approve. */
export const enterClose = (id: string, reason: string) =>
  api.patch<Guarantee>(`/guarantees/${encodeURIComponent(id)}/close`, { reason } satisfies Schemas['ReasonRequest']);

/** Approves or rejects a manual close; only an admin who didn't enter it can. */
export const decideClose = (id: string, approval: 'approve' | 'reject', note?: string) =>
  api.patch<Guarantee>(`/guarantees/${encodeURIComponent(id)}/close/${approval}`, (note ? { note } : {}) satisfies Schemas['DecisionRequest']);

export const GUARANTEE_ID = /^GPG-\d{4}-\d{6}$/;
export const QUOTE_ID = /^GPQ-[A-Z0-9]{6}$/;

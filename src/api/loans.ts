import { api } from './client';
import type { Page } from './members';
import type { Schemas } from './types';

export type Loan = Schemas['LoanRecordResponse'];
export type LoanDetail = Schemas['LoanDetailResponse'];
export type LoanAction = Schemas['LoanActionResponse'];
export type Recovery = Schemas['LoanRecoveryResponse'];
export type Claim = Schemas['ClaimResponse'];
export type ClaimLiquidity = Schemas['ClaimLiquidityResponse'];
export type StepType = NonNullable<LoanAction['type']>;

/** How a claim's payout or a recovery was paid: USDT, or KES or BLOCKS at that day's rate. */
export type PaidIn = 'USDT' | 'KES' | 'BLOCKS';

export interface LoanQuery {
  page: number;
  size: number;
  status?: string;
  source?: string;
  /** loans with a lender report or claim step waiting for a second admin */
  pending?: boolean;
}

// A loan has no business ID: a guaranteed loan is named by its guarantee (GPG-…), and a Lipa loan by the Lipa API's
// reference for it.

/** What a loan is called on screen. */
export const loanName = (l: Loan) => l.guaranteeId ?? (l.externalId ? `Lipa loan ${l.externalId}` : 'Lipa loan');

export const listLoans = (q: LoanQuery) => api.get<Page<Loan>>('/loans', { query: { ...q } });

export const getLoan = (id: string) => api.get<LoanDetail>(`/loans/${encodeURIComponent(id)}`);

/** Records the loan an active guarantee backs, from the lender's report. */
export const recordLoan = (loan: Schemas['RecordLoanRequest']) => api.post<LoanDetail>('/loans', loan);

/** Attaches a lender's document: a PDF or an image. */
export const attachDocument = (id: string, file: File, label?: string) => {
  const form = new FormData();
  form.append('file', file);
  return api.post<LoanDetail>(`/loans/${encodeURIComponent(id)}/documents`, form, { query: { label } });
};

const step = <T>(id: string, path: string, body?: T) => api.post<LoanDetail>(`/loans/${encodeURIComponent(id)}/${path}`, body);

// Each of these is entered by one admin for a second admin to approve, except marking a default verified.
export const enterRepayment = (id: string, r: Schemas['RepaymentRequest']) => step(id, 'repayment', r);
export const enterDefault = (id: string, d: Schemas['DefaultRequest']) => step(id, 'default', d);
export const verifyDefault = (id: string) => step(id, 'default/verification');
export const enterReversal = (id: string, reason: string) => step(id, 'default/reversal', { reason } satisfies Schemas['ReasonRequest']);
export const enterPayout = (id: string, p: Schemas['PayoutRequest']) => step(id, 'payout', p);
export const enterWriteOff = (id: string, reason: string) => step(id, 'write-off', { reason } satisfies Schemas['ReasonRequest']);

/** Approves or rejects the report or claim step waiting on a loan; only an admin who didn't enter it can. */
export const decideStep = (id: string, approval: 'approve' | 'reject', note?: string) =>
  api.patch<LoanDetail>(`/loans/${encodeURIComponent(id)}/pending/${approval}`, (note ? { note } : {}) satisfies Schemas['DecisionRequest']);

export const enterRecovery = (id: string, r: Schemas['RecoveryRequest']) => api.post<Recovery>(`/loans/${encodeURIComponent(id)}/recoveries`, r);

export const decideRecovery = (recoveryId: string, approval: 'approve' | 'reject', note?: string) =>
  api.patch<Recovery>(`/loans/recoveries/${encodeURIComponent(recoveryId)}/${approval}`, (note ? { note } : {}) satisfies Schemas['DecisionRequest']);

/** Every claim waiting for payout, oldest default first. */
export const listClaims = () => api.get<Claim[]>('/claims');

export const getClaimLiquidity = () => api.get<ClaimLiquidity>('/claims/liquidity');

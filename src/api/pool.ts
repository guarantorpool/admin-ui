import { api } from './client';
import type { Page } from './members';
import type { Schemas } from './types';

export type UnderwritingInputs = Schemas['UnderwritingInputsResponse'];
export type Figure = Schemas['Figure'];
export type BookRatio = Schemas['BookRatioResponse'];
export type Utilization = Schemas['PoolUtilizationResponse'];
export type Movement = Schemas['LiquidityAdjustmentResponse'];
export type MovementType = NonNullable<Movement['type']>;
export type PoolWallet = Schemas['PoolWalletResponse'];
export type Prices = Schemas['Prices'];
export type PoolCharts = Schemas['PoolChartsResponse'];

export interface MovementQuery {
  page: number;
  size: number;
  status?: string;
}

/** BDR, RR and LR, each calculated value beside its setting, and the Liquid Funds behind LR. */
export const getUnderwritingInputs = () => api.get<UnderwritingInputs>('/pool/underwriting-inputs');

/** The prices and haircuts every member's backing is valued at: the latest stored valuation, or before one, the haircuts in force. */
export const getPoolPrices = () => api.get<Prices>('/pool/prices');
export const poolPricesKey = ['pool', 'prices'];

/** The book-wide solvency check. */
export const getBookRatio = () => api.get<BookRatio>('/pool/book-ratio');

/** The latest Correction Factor and the pool totals behind it. */
export const getUtilization = () => api.get<Utilization>('/pool/utilization');

/** Extra liquidity: every movement into or out of Liquid Funds, newest first. */
export const listMovements = (q: MovementQuery) => api.get<Page<Movement>>('/pool/liquidity-adjustments', { query: { ...q } });

/** Enters a movement of extra liquidity, in USDT, for a second admin to approve. */
export const enterMovement = (type: MovementType, amount: number, note: string) =>
  api.post<Movement>('/pool/liquidity-adjustments', { type, amount, note } satisfies Schemas['LiquidityAdjustmentRequest']);

/** Approves or rejects a movement; only an admin who didn't enter it can. */
export const decideMovement = (id: string, approval: 'approve' | 'reject', note?: string) =>
  api.patch<Movement>(`/pool/liquidity-adjustments/${encodeURIComponent(id)}/${approval}`, (note ? { note } : {}) satisfies Schemas['DecisionRequest']);

/** Every pool wallet, newest proposal first. */
export const listWallets = () => api.get<PoolWallet[]>('/pool/wallets');

/** Proposes a Safe as the next pool wallet; the backend reads its signers and threshold from the chain. */
export const proposeWallet = (address: string, note?: string) =>
  api.post<PoolWallet>('/pool/wallets', { address, ...(note ? { note } : {}) } satisfies Schemas['ProposePoolWalletRequest']);

/** Approves or rejects a proposed wallet; only an admin who didn't propose it can. */
export const decideWallet = (id: string, approval: 'approve' | 'reject', note?: string) =>
  api.patch<PoolWallet>(`/pool/wallets/${encodeURIComponent(id)}/${approval}`, (note ? { note } : {}) satisfies Schemas['DecisionRequest']);

/** The dashboard's charts over the last 12 months, in Nairobi days and months, oldest first. */
export const getPoolCharts = () => api.get<PoolCharts>('/pool/charts');

import { api } from './client';
import type { Page } from './members';
import type { Schemas } from './types';

export type Fact = Schemas['FactResponse'];
export type FactType = NonNullable<Fact['type']>;
export type ImportResult = Schemas['FactIngestResponse'];

export interface FactQuery {
  page: number;
  size: number;
  /** each filter matches exactly; the member number in any case */
  memberNumber?: string;
  type?: string;
  source?: string;
  sortBy?: string;
}

/** Activity records, the latest to happen first unless `sortBy` says otherwise. */
export const listFacts = (q: FactQuery) => api.get<Page<Fact>>('/facts', { query: { ...q } });

/** Imports a CSV file of records, all of them or none; a record already in (same source and ID) is skipped. */
export const importFacts = (file: File) => {
  const form = new FormData();
  form.append('file', file);
  return api.post<ImportResult>('/facts/import', form);
};

export type KesActivity = Schemas['KesActivityResponse'];

export interface KesActivityQuery {
  page: number;
  size: number;
  memberNumber?: string;
  walletAddress?: string;
  /** DEPOSIT or PAYMENT */
  type?: string;
  /** COMPLETED, REVERSED or FAILED */
  status?: string;
}

/**
 * M-Pesa deposits and payments as last read from the Lipa API's feed, the latest change first (C4). Nothing calls the
 * Lipa API here: a member's feed is read when they sign in and before each quote.
 */
export const listKesActivities = (q: KesActivityQuery) => api.get<Page<KesActivity>>('/facts/kes-activities', { query: { ...q } });

import { api } from './client';
import type { Page } from './members';
import type { Schemas } from './types';

export type Parameter = Schemas['ParameterResponse'];
export type ParameterChange = Schemas['ParameterChangeResponse'];
export type ChangeSet = Schemas['ChangeSetResponse'];
export type ChangeStatus = NonNullable<ParameterChange['status']>;

export interface ChangeQuery {
  page: number;
  size: number;
  key?: string;
  status?: ChangeStatus;
}

/** Every pool setting, with its value, whether it applies at once, and whether a change to it is waiting. */
export const listParameters = () => api.get<Parameter[]>('/pool-parameters');

export const getParameter = (key: string) => api.get<Parameter>(`/pool-parameters/${encodeURIComponent(key)}`);

/**
 * Changes one setting. One that applies at once comes back applied; any other comes back waiting for a second
 * admin.
 */
export const changeParameter = (key: string, value: number, reason?: string) =>
  api.patch<ParameterChange>(`/pool-parameters/${encodeURIComponent(key)}`, { value, ...(reason ? { reason } : {}) } satisfies Schemas['ParameterChangeRequest']);

/** Proposes several settings as one change set: every value waits, then they apply together or not at all. */
export const proposeChangeSet = (changes: { key: string; value: number }[], reason?: string) =>
  api.post<ChangeSet>('/parameter-change-sets', { changes, ...(reason ? { reason } : {}) } satisfies Schemas['ParameterChangeSetRequest']);

export const getChangeSet = (id: string) => api.get<ChangeSet>(`/parameter-change-sets/${encodeURIComponent(id)}`);

/** The history of changes, newest proposal first, and what is waiting for approval. */
export const listChanges = (q: ChangeQuery) => api.get<Page<ParameterChange>>('/parameter-changes', { query: { ...q } });

/** Approves or rejects one change; only an admin who didn't propose it can. */
export const decideChange = (id: string, approval: 'approve' | 'reject', note?: string) =>
  api.patch<ParameterChange>(`/parameter-changes/${encodeURIComponent(id)}/${approval}`, (note ? { note } : {}) satisfies Schemas['DecisionRequest']);

/** Approves or rejects a whole change set; only an admin who didn't propose it can. */
export const decideChangeSet = (id: string, approval: 'approve' | 'reject', note?: string) =>
  api.patch<ChangeSet>(`/parameter-change-sets/${encodeURIComponent(id)}/${approval}`, (note ? { note } : {}) satisfies Schemas['DecisionRequest']);

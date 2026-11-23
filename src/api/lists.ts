import { api } from './client';
import type { Page } from './members';
import type { Schemas } from './types';

// The lists members pick their location and background from, and their requests for missing entries
// (BlockCoop D-043). Counties and sub-counties are the official ones and fixed; admins keep the rest.

export type ListEntry = Schemas['ListEntryResponse'];
export type ListRequest = Schemas['ListRequestResponse'];
export type NewListEntry = Schemas['ListEntryRequest'];
export type ListEntryChange = Schemas['ListEntryChangeRequest'];

export interface PickList {
  /** the name in the URL */
  path: string;
  label: string;
  /** one entry, with its article, for "Add a school", "Add an interest" */
  one: string;
  /** the types an entry must have one of; none if empty */
  types: readonly string[];
  /** the list each entry sits in: a sub-county's county, a town's sub-county */
  parent?: string;
  /** whether admins add, rename and retire entries */
  kept: boolean;
}

// As the backend has them (PickList), in the order the member app asks for them.
export const PICK_LISTS: readonly PickList[] = [
  { path: 'counties', label: 'Counties', one: 'a county', types: [], kept: false },
  { path: 'sub-counties', label: 'Sub-counties', one: 'a sub-county', types: [], parent: 'counties', kept: false },
  { path: 'towns', label: 'Towns', one: 'a town', types: [], parent: 'sub-counties', kept: true },
  { path: 'industries', label: 'Industries', one: 'an industry', types: [], kept: true },
  { path: 'professions', label: 'Professions', one: 'a profession', types: [], kept: true },
  { path: 'interests', label: 'Interests', one: 'an interest', types: [], kept: true },
  { path: 'communities', label: 'Communities', one: 'a community', types: ['SACCO', 'CHAMA', 'CHURCH', 'ASSOCIATION', 'PROFESSIONAL_BODY', 'INVESTMENT_GROUP', 'SOCIAL_GROUP', 'BUSINESS_NETWORK'], kept: true },
  { path: 'organisations', label: 'Organisations', one: 'an organisation', types: ['EMPLOYER', 'BUSINESS'], kept: true },
  { path: 'schools', label: 'Schools', one: 'a school', types: ['SECONDARY', 'COLLEGE', 'UNIVERSITY'], kept: true }
];

export const pickList = (path: string | null | undefined) => PICK_LISTS.find((l) => l.path === path);

/** The backend's limits on a name and on one bulk add. */
export const NAME_MAX = 150;
export const BULK_MAX = 5000;

export interface EntryQuery {
  parentId?: string;
  search?: string;
  includeRetired?: boolean;
  page: number;
  size: number;
}

/** In name order. */
export const listEntries = (list: string, q: EntryQuery) => api.get<Page<ListEntry>>(`/lists/${list}`, { query: { ...q } });

/** Every entry of a list, a page at a time, such as the 290 sub-counties a town can sit in. */
export async function allEntries(list: string, parentId?: string): Promise<ListEntry[]> {
  const all: ListEntry[] = [];
  for (let page = 1; ; page++) {
    const p = await listEntries(list, { parentId, page, size: 100 });
    all.push(...(p.results ?? []));
    if (page >= (p.totalPages ?? 1)) return all;
  }
}

export const addEntry = (list: string, body: NewListEntry) => api.post<ListEntry>(`/lists/${list}`, body);

/** Names already on the list are skipped; one bad entry refuses the lot. */
export const addEntries = (list: string, entries: NewListEntry[]) => api.post<Schemas['ListBulkResponse']>(`/lists/${list}/bulk`, { entries });

export const changeEntry = (list: string, entryId: string, body: ListEntryChange) => api.patch<ListEntry>(`/lists/${list}/${entryId}`, body);

export const REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const;

/** Newest first. */
export const listRequests = (q: { status?: string; page: number; size: number }) => api.get<Page<ListRequest>>('/list-requests', { query: { ...q } });

export const pendingRequestsKey = ['lists', 'requests', 'pending-count'];

/** As a new entry, with its name and type corrected if given, or as `entryId` already on the list. */
export const approveRequest = (requestId: string, body: Schemas['ListRequestApprovalRequest']) => api.post<ListRequest>(`/list-requests/${requestId}/approve`, body);

export const rejectRequest = (requestId: string, note: string) => api.post<ListRequest>(`/list-requests/${requestId}/reject`, { note: note || undefined });

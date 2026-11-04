import { api } from './client';
import type { Account, Schemas } from './types';

/** One page of a list, as every list endpoint answers (the generated PageResponse… types, for any row). */
export type Page<T> = { results?: T[]; page?: number; size?: number; totalPages?: number; totalResults?: number };

export type MemberStatus = NonNullable<Account['status']>;
export type KycStatus = NonNullable<Schemas['MemberDetails']['kycStatus']>;
export type TrustScore = Schemas['TrustScoreResponse'];
export type TrustScoreSnapshot = Schemas['TrustScoreSnapshotResponse'];
export type Relationship = Schemas['RelationshipResponse'];
export type RelationshipValue = Schemas['RelationshipValueResponse'];
export type NetworkValue = Schemas['NetworkValueResponse'];
export type NetworkValueSnapshot = Schemas['NetworkValueSnapshotResponse'];
export type AssetBalances = Schemas['AssetBalancesResponse'];
export type BackingChange = Schemas['BackingChangeResponse'];
export type Guarantee = Schemas['GuaranteeResponse'];
export type Upload = Schemas['UploadResponse'];

export interface MemberQuery {
  page: number;
  size: number;
  search?: string;
  status?: MemberStatus;
  kycStatus?: KycStatus;
}

// Pages start at 1 on every list endpoint.
export const listMembers = (q: MemberQuery) => api.get<Page<Account>>('/members', { query: { ...q } });

export const getMember = (id: string) => api.get<Account>(`/members/${id}`);

export const getTrustScore = (id: string) => api.get<TrustScore>(`/members/${id}/trust-score`);

export const getTrustScoreHistory = (id: string, page: number, size: number) =>
  api.get<Page<TrustScoreSnapshot>>(`/members/${id}/trust-score/history`, { query: { page, size } });

export const getRelationships = (id: string, page: number, size: number) =>
  api.get<Page<Relationship>>(`/members/${id}/relationships`, { query: { page, size } });

export const getRelationshipValue = (id: string) => api.get<RelationshipValue>(`/members/${id}/relationship-value`);

export const getNetworkValue = (id: string) => api.get<NetworkValue>(`/members/${id}/network-value`);

export const getNetworkValueHistory = (id: string, page: number, size: number) =>
  api.get<Page<NetworkValueSnapshot>>(`/members/${id}/network-value/history`, { query: { page, size } });

export const getAssetBalances = (id: string) => api.get<AssetBalances>(`/members/${id}/asset-balances`);

export const getMemberGuarantees = (id: string, page: number, size: number) =>
  api.get<Page<Guarantee>>('/guarantees', { query: { memberId: id, page, size } });

export const getUploads = (ownerId: string, page: number, size: number, category?: string) =>
  api.get<Page<Upload>>(`/uploads/${ownerId}`, { query: { page, size, category } });

/** A link to open a file. A private file's link is signed and lasts a few minutes, so it's asked for on each open. */
export const getFileLink = (uploadId: string) => api.get<Schemas['FileLinkResponse']>(`/uploads/file/${uploadId}`);

export const disableMember = (id: string, reason: string) =>
  api.patch<Account>(`/members/${id}/disable`, (reason ? { reason } : {}) satisfies Schemas['DisableRequest']);

export const enableMember = (id: string) => api.patch<Account>(`/members/${id}/enable`);

/**
 * Enters a member's KES non-withdrawable deposits and USDT vault savings, both replaced, for a second admin to
 * approve. One change waits at a time.
 */
export const setAssetBalances = (id: string, kesDeposits: number, usdtVaultSavings: number, note?: string) =>
  api.put<AssetBalances>(`/members/${id}/asset-balances`, { kesDeposits, usdtVaultSavings, ...(note ? { note } : {}) } satisfies Schemas['AssetBalancesRequest']);

/** Approves or rejects the waiting change; only an admin who didn't enter it can. */
/** Backing changes waiting for a second admin, across members, oldest first. */
export const listPendingBacking = (page: number, size: number) => api.get<Page<BackingChange>>('/members/asset-balances/pending', { query: { page, size } });
export const pendingBackingKey = ['members', 'asset-balances', 'pending'];

export const decideAssetBalances = (id: string, approval: 'approve' | 'reject', note?: string) =>
  api.patch<AssetBalances>(`/members/${id}/asset-balances/${approval}`, (note ? { note } : {}) satisfies Schemas['DecisionRequest']);

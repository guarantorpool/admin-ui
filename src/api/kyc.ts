import { api } from './client';
import type { Page } from './members';
import type { Schemas } from './types';

export type Kyc = Schemas['KycResponse'];
export type AddressProof = Schemas['AddressProofResponse'];
export type AddressDocument = Schemas['Document'];

// Each read decrypts the member's details and is written to the audit log (BlockCoop D-018), so the
// screens read them once per open panel rather than on every refetch.
export const getKyc = (memberId: string) => api.get<Kyc>(`/members/${memberId}/kyc`);

export const getProofOfAddress = (memberId: string) => api.get<AddressProof>(`/members/${memberId}/proof-of-address`);

/** Verifies or rejects a pending submission. A rejection needs a reason, which the member sees. */
export const reviewKyc = (memberId: string, status: 'verified' | 'rejected', reason?: string) =>
  api.patch<Kyc>(`/members/${memberId}/kyc`, { status, ...(reason ? { reason } : {}) } satisfies Schemas['KycUpdateRequest']);

/** Approves or rejects a pending document. A rejection needs a reason, which the member sees. */
export const reviewAddressDocument = (memberId: string, documentId: string, status: 'approved' | 'rejected', reason?: string) =>
  api.patch<AddressProof>(`/members/${memberId}/address-documents/${documentId}`, {
    status,
    ...(reason ? { reason } : {})
  } satisfies Schemas['AddressDocumentReviewRequest']);

export type QueuedAddressDocument = Schemas['AddressDocumentResponse'];

/** Proof-of-address documents across every member, the longest waiting first; pending unless a status is given. */
export const listAddressDocuments = (q: { page: number; size: number; status?: string }) =>
  api.get<Page<QueuedAddressDocument>>('/members/address-documents', { query: { ...q } });

import { api } from './client';
import type { MessageResponse, Schemas } from './types';

export type KycKeyStatus = Schemas['KycKeyStatusResponse'];
export type KeyLossPreview = Schemas['KycKeyLossPreviewResponse'];

// All for the system admin only.

/** Which key protects how many members' KYC details, and how many can't be read with any key that is set. */
export const getKycKeyStatus = () => api.get<KycKeyStatus>('/kyc-key');

/** Every readable record still on an older key moves to the current one, so the old key can be removed. */
export const reencryptKyc = () => api.post<MessageResponse>('/kyc-key/re-encrypt');

/** Who the key-loss reset would affect, and how many files it would delete. Changes nothing. */
export const previewKeyLossReset = () => api.get<KeyLossPreview>('/kyc-key/key-loss-reset');

/** Refused unless `expectedMembers` is still the number of members the preview showed. */
export const runKeyLossReset = (expectedMembers: number) => api.post<MessageResponse>('/kyc-key/key-loss-reset', { expectedMembers } satisfies Schemas['KycKeyLossResetRequest']);

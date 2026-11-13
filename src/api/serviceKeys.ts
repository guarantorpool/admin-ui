import { api } from './client';
import type { Page } from './members';
import type { Schemas } from './types';

export type ServiceKey = Schemas['ServiceKeyResponse'];
export type CreatedServiceKey = Schemas['ServiceKeyCreatedResponse'];

/** What a key may do, as the backend knows them (ServiceKey.KNOWN_SCOPES). */
export const SCOPES = ['facts:write', 'facts:read', 'loans:write'] as const;

/** A key with this scope belongs to one lender: its name is the lender on every loan it sends (#169). */
export const LENDER_SCOPE = 'loans:write';

/** Newest first. A revoked key is left out unless `includeRevoked`. */
export const listServiceKeys = (q: { page: number; size: number; includeRevoked: boolean }) => api.get<Page<ServiceKey>>('/service-keys', { query: { ...q } });

/** The secret in `key` is shown this once and never again. */
export const createServiceKey = (body: Schemas['CreateServiceKeyRequest']) => api.post<CreatedServiceKey>('/service-keys', body);

/** A new key with the same name and scopes; the old one stops working at once. */
export const rotateServiceKey = (id: string) => api.post<CreatedServiceKey>(`/service-keys/${id}/rotate`);

export const revokeServiceKey = (id: string) => api.patch<ServiceKey>(`/service-keys/${id}/revoke`);

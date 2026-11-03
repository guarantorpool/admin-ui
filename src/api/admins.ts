import { api } from './client';
import type { Page } from './members';
import type { Account, Schemas } from './types';

export type Role = Schemas['RoleResponse'];
export type AdminStatus = NonNullable<Account['status']>;

export interface AdminQuery {
  page: number;
  size: number;
  /** name, email or phone */
  search?: string;
  status?: AdminStatus;
  roleId?: string;
}

/** Newest first. */
export const listAdmins = (q: AdminQuery) => api.get<Page<Account>>('/admins', { query: { ...q } });

/** Only the system admin invites. The new admin is emailed a link to set their first password. */
export const inviteAdmin = (body: Schemas['CreateAdminRequest']) => api.post<Account>('/admins', body);

/** A new role is for the system admin only, and so is anyone's role; the names and phone need ADMINS.UPDATE. */
export const updateAdmin = (id: string, body: Schemas['UpdateAdminRequest']) => api.patch<Account>(`/admins/${id}`, body);

export const disableAdmin = (id: string, reason: string) =>
  api.patch<Account>(`/admins/${id}/disable`, (reason ? { reason } : {}) satisfies Schemas['DisableRequest']);

export const enableAdmin = (id: string) => api.patch<Account>(`/admins/${id}/enable`);

export const deleteAdmin = (id: string) => api.delete<void>(`/admins/${id}`);

/** Every role, by name. */
export const listRoles = () => api.get<Role[]>('/roles');

/** Every permission a role can be given, by module, in the backend's order. */
export const listPermissions = () => api.get<Record<string, string[]>>('/roles/permissions/all');

/** Creating, changing and deleting roles is for the system admin only. */
export const createRole = (body: Schemas['RoleRequest']) => api.post<Role>('/roles', body);

/** Leaving out `permissions` keeps them as they are. */
export const updateRole = (id: string, body: Schemas['RoleRequest']) => api.patch<Role>(`/roles/${id}`, body);

/** Only a role no admin holds. */
export const deleteRole = (id: string) => api.delete<void>(`/roles/${id}`);

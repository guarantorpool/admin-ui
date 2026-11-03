// What the signed-in admin may see and do, from the permissions the sign-in returns (already expanded
// from modules by the backend). The backend still checks every call; this only hides what would be refused.

export const SYSTEM_ADMIN_ROLE = 'ROLE_SYSTEM_ADMIN';

export type Permission =
  | 'ADMINS.READ' | 'ADMINS.UPDATE' | 'ADMINS.DELETE'
  | 'MEMBERS.READ' | 'MEMBERS.UPDATE' | 'MEMBERS.KYC'
  | 'PARAMETERS.READ' | 'PARAMETERS.PROPOSE' | 'PARAMETERS.APPROVE'
  | 'SERVICE_KEYS.READ' | 'SERVICE_KEYS.MANAGE'
  | 'AUDIT.READ'
  | 'LEDGER.READ' | 'LEDGER.IMPORT'
  | 'POOL.READ' | 'POOL.MANAGE'
  | 'GUARANTEES.READ' | 'GUARANTEES.MANAGE'
  | 'ALERTS.READ' | 'ALERTS.MANAGE'
  | 'REFUNDS.READ' | 'REFUNDS.MANAGE'
  | 'WALLETS.PROPOSE' | 'WALLETS.APPROVE';

/** A screen's access rule: a permission, several that are all needed, the system admin role, or open to every admin. */
export type Access = Permission | readonly Permission[] | 'SYSTEM_ADMIN' | 'ANY';

export interface Grants {
  role: string | null | undefined;
  permissions: readonly string[] | null | undefined;
}

export function can(grants: Grants | null | undefined, access: Access): boolean {
  if (!grants) return false;
  if (access === 'ANY') return true;
  if (access === 'SYSTEM_ADMIN') return grants.role === SYSTEM_ADMIN_ROLE;
  const held = grants.permissions ?? [];
  return typeof access === 'string' ? held.includes(access) : access.every((p) => held.includes(p));
}

export function canAny(grants: Grants | null | undefined, access: readonly Access[]): boolean {
  return access.some((a) => can(grants, a));
}

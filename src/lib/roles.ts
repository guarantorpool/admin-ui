import { sentence } from './labels';
import { SYSTEM_ADMIN_ROLE, type Grants } from './permissions';

// Roles and their permissions as admins read them, and the backend's rules on who may manage whom
// (BlockCoop D-006), so the portal can say why an action isn't open rather than wait for a refusal.

// each module by the screen it opens
const MODULE: Record<string, string> = {
  ADMINS: 'Admins and roles',
  MEMBERS: 'Members',
  PARAMETERS: 'Pool settings',
  SERVICE_KEYS: 'Service keys',
  AUDIT: 'Audit log',
  LEDGER: 'Activity',
  POOL: 'Pool',
  GUARANTEES: 'Guarantees',
  ALERTS: 'Alerts',
  REFUNDS: 'Refunds',
  WALLETS: 'Pool wallets'
};

const ACTION: Record<string, string> = {
  READ: 'See',
  UPDATE: 'Change',
  DELETE: 'Delete',
  KYC: 'Review KYC and files',
  PROPOSE: 'Propose',
  APPROVE: 'Approve',
  MANAGE: 'Manage',
  IMPORT: 'Import'
};

export const moduleLabel = (module: string) => MODULE[module] ?? sentence(module);

/** `MEMBERS.KYC` → "Review KYC and files"; a module name on its own → every permission in it. */
export function permissionLabel(permission: string): string {
  const [module, action] = permission.split('.');
  if (!action) return `All of ${moduleLabel(module!)}`;
  return ACTION[action] ?? sentence(action);
}

/** `ROLE_PARAMETER_APPROVER` → "Parameter approver"; the built-in role is "System admin". */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return '—';
  if (role === SYSTEM_ADMIN_ROLE) return 'System admin';
  return sentence(role.replace(/^ROLE_/, ''));
}

/**
 * The name the backend stores, as it makes it: "parameter approver" and "Parameter-Approver" both become
 * ROLE_PARAMETER_APPROVER. '' when the name has a character it refuses.
 */
export function roleName(input: string): string {
  const name = input.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!/^[A-Z0-9_]+$/.test(name)) return '';
  return name.startsWith('ROLE_') ? name : `ROLE_${name}`;
}

/**
 * What a role is given: a module's name gives every permission in it, those added later too; otherwise
 * single permissions. Turning a module on puts its name in place of any of its single permissions.
 */
export function setModule(granted: readonly string[], module: string, inModule: readonly string[], on: boolean): string[] {
  const rest = granted.filter((p) => p !== module && !inModule.includes(p));
  return on ? [...rest, module] : rest;
}

export function setPermission(granted: readonly string[], permission: string, on: boolean): string[] {
  const rest = granted.filter((p) => p !== permission);
  return on ? [...rest, permission] : rest;
}

/** The pieces of an admin account the rules look at. */
export interface Target {
  id?: string;
  role?: { id?: string; name?: string };
}

/**
 * Why the signed-in admin can't disable, enable, delete or change another admin, or '' when they can: only a
 * system admin manages a system admin, and nobody manages a role with permissions they don't hold.
 * `targetPermissions` is the target role's effective permissions, when known.
 */
export function cantManage(grants: Grants | null, target: Target, targetPermissions: readonly string[] | undefined): string {
  if (target.role?.name === SYSTEM_ADMIN_ROLE && grants?.role !== SYSTEM_ADMIN_ROLE) return 'Only a system admin can manage a system admin.';
  const held = grants?.permissions ?? [];
  if (targetPermissions?.some((p) => !held.includes(p))) return "Their role has permissions yours doesn't.";
  return '';
}

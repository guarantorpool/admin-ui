import { can, type Access, type Grants } from '@/lib/permissions';

// The side menu, in the wireframe's order. `access` hides an entry from a role that can't open it;
// `comingIn` is the plan's slice or phase for screens not built yet (ADMIN_PORTAL_PLAN.md); a built
// screen has none.

export interface Screen {
  path: string;
  label: string;
  /** what the screen is for, shown on its page until it's built */
  about: string;
  access: Access;
  comingIn?: string;
}

export interface NavGroup {
  id: string;
  label: string;
  items: Screen[];
}

export type NavEntry = { kind: 'direct'; screen: Screen } | { kind: 'group'; group: NavGroup };

const direct = (screen: Screen): NavEntry => ({ kind: 'direct', screen });
const group = (id: string, label: string, items: Screen[]): NavEntry => ({ kind: 'group', group: { id, label, items } });

export const NAV: NavEntry[] = [
  direct({ path: '/dashboard', label: 'Dashboard', about: 'What needs attention, and the pool at a glance.', access: 'ANY', comingIn: 'Phase E' }),
  direct({ path: '/approvals', label: 'Approvals inbox', about: 'Everything waiting for a second admin, in one list.', access: 'ANY', comingIn: 'Phase B' }),
  direct({ path: '/alerts', label: 'Alerts', about: "Pool alerts, and acknowledging them with a note.", access: 'ALERTS.READ' }),
  group('members', 'Members', [
    { path: '/members', label: 'All members', about: 'Find a member and see everything about them.', access: 'MEMBERS.READ' },
    { path: '/kyc', label: 'KYC and address review', about: "Check members' identity and address documents.", access: ['MEMBERS.READ', 'MEMBERS.KYC'] },
    { path: '/activity', label: 'Activity', about: 'Bring in activity records from a file, and search them.', access: 'LEDGER.READ', comingIn: 'slice 11' }
  ]),
  group('guarantees', 'Guarantees', [
    { path: '/guarantees', label: 'Guarantees and quotes', about: 'Every guarantee and quote, with its pricing and payments.', access: 'GUARANTEES.READ' },
    { path: '/loans', label: 'Loans and lender reports', about: 'Record what lenders report about guaranteed loans.', access: 'GUARANTEES.READ' },
    { path: '/claims', label: 'Claims', about: 'Pay lenders when a guaranteed loan defaults.', access: 'GUARANTEES.READ' }
  ]),
  group('money', 'Money', [
    { path: '/payments', label: 'Payments', about: 'Every premium payment, across guarantees.', access: 'GUARANTEES.READ', comingIn: 'Phase B' },
    { path: '/refunds', label: 'Refunds', about: 'Money owed back to members, and recording payouts.', access: 'REFUNDS.READ' }
  ]),
  group('pool', 'Pool', [
    { path: '/pool/health', label: 'Pool health', about: "Check the pool's ratios, solvency and extra liquidity.", access: 'POOL.READ' },
    { path: '/pool/wallets', label: 'Pool wallets', about: "Manage the wallet that receives the pool's USDT.", access: 'POOL.READ' },
    { path: '/pool/settings', label: 'Pool settings', about: "Change the pool's settings.", access: 'PARAMETERS.READ' },
    { path: '/backing', label: 'Backing assets and prices', about: "Set members' KES deposits and vault savings, and see the prices backing is valued at.", access: 'MEMBERS.READ' }
  ]),
  group('admin', 'Administration', [
    { path: '/admins', label: 'Admins and roles', about: 'Manage who can do what.', access: 'ADMINS.READ', comingIn: 'slice 12' },
    { path: '/service-keys', label: 'Service keys', about: 'Manage the keys other systems use to call the GP API.', access: 'SERVICE_KEYS.READ', comingIn: 'slice 13' },
    { path: '/kyc-key', label: 'KYC encryption key', about: "Keep members' private KYC details readable and safe.", access: 'SYSTEM_ADMIN', comingIn: 'slice 13' },
    { path: '/audit', label: 'Audit log', about: 'See every admin action.', access: 'AUDIT.READ', comingIn: 'slice 13' }
  ])
];

export const ACCOUNT: Screen = { path: '/account', label: 'Your account', about: 'Manage your own login and profile.', access: 'ANY' };

export function allScreens(): Screen[] {
  return NAV.flatMap((e) => (e.kind === 'direct' ? [e.screen] : e.group.items));
}

/** The menu as this admin sees it: entries their role can't open are left out, and so are empty groups. */
export function visibleNav(grants: Grants | null): NavEntry[] {
  return NAV.flatMap((e): NavEntry[] => {
    if (e.kind === 'direct') return can(grants, e.screen.access) ? [e] : [];
    const items = e.group.items.filter((s) => can(grants, s.access));
    return items.length ? [{ kind: 'group', group: { ...e.group, items } }] : [];
  });
}

/** A path is the screen's own, or one of its records (`/members/{id}`). */
export function isUnder(path: string, screenPath: string): boolean {
  return path === screenPath || path.startsWith(screenPath + '/');
}

/** Where a screen sits in the menu, for the breadcrumb. A record's path finds its screen. */
export function findScreen(path: string): { screen: Screen; group: NavGroup | null } | null {
  if (path === ACCOUNT.path) return { screen: ACCOUNT, group: null };
  for (const e of NAV) {
    if (e.kind === 'direct' && isUnder(path, e.screen.path)) return { screen: e.screen, group: null };
    if (e.kind === 'group') {
      const screen = e.group.items.find((s) => isUnder(path, s.path));
      if (screen) return { screen, group: e.group };
    }
  }
  return null;
}

/**
 * Where signing in lands. Until the dashboard (Phase E) and the approvals inbox (Phase B) exist, it's the
 * first other screen the admin's role allows; an admin with none of those lands on their account.
 */
export function homePath(grants: Grants | null): string {
  const first = allScreens().find((s) => s.path !== '/dashboard' && s.path !== '/approvals' && can(grants, s.access));
  return first?.path ?? ACCOUNT.path;
}

/** Only follows a `next` that is a path inside the portal, never another site. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if (/^\/(sign-in|forgot-password|reset-password|set-password)\b/.test(next)) return null;
  return next;
}

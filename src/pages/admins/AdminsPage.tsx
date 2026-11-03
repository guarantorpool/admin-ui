import * as React from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { MoreVertical } from 'lucide-react';
import { toast } from 'sonner';
import { deleteAdmin, disableAdmin, enableAdmin, listAdmins, listRoles, type AdminStatus, type Role } from '@/api/admins';
import { errorMessage } from '@/api/errors';
import type { Account } from '@/api/types';
import { PageHeader } from '@/components/shell/AppShell';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { DecisionDialog, NOTE_HINT, type Decision } from '@/components/ui/decision-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Pager, PAGE_SIZES } from '@/components/ui/pager';
import { StatusPill } from '@/components/ui/parts';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { formatDateTime } from '@/lib/format';
import { adminStatus } from '@/lib/labels';
import { fullName } from '@/lib/names';
import { can, SYSTEM_ADMIN_ROLE, type Grants } from '@/lib/permissions';
import { cantManage, roleLabel } from '@/lib/roles';
import { useCompact } from '@/lib/useMedia';
import { cn } from '@/lib/utils';
import { NoAccess } from '@/pages/Placeholders';
import { useGrants, useSession } from '@/session/SessionProvider';
import { AdminForm } from './AdminForm';
import { RolesTab } from './RolesTab';

// Screen 18. Admins, and the roles that say what each can do (BlockCoop D-006). Only the system admin invites
// admins, gives them a role and sets up roles; changing, disabling and deleting an admin needs ADMINS.UPDATE or
// ADMINS.DELETE, and never reaches a system admin, a role with more than the actor's own, or the actor's own account.

const PAGE_TABS = [
  { value: 'admins', label: 'Admins' },
  { value: 'roles', label: 'Roles' }
] as const;

const STATUS_CHIPS: { value: AdminStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'disabled', label: 'Disabled' }
];

const DEFAULT_SIZE = 25;

export function AdminsPage() {
  const grants = useGrants();
  if (!can(grants, 'ADMINS.READ')) return <NoAccess />;
  return <AdminsAndRoles />;
}

function AdminsAndRoles() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const grants = useGrants();
  const tab = pathname === '/admins/roles' || pathname.startsWith('/admins/roles/') ? 'roles' : 'admins';
  const roles = useQuery({ queryKey: ['roles'], queryFn: listRoles });
  const [inviting, setInviting] = React.useState(false);
  const [creatingRole, setCreatingRole] = React.useState(false);
  const isSystemAdmin = grants?.role === SYSTEM_ADMIN_ROLE;

  const action = !isSystemAdmin ? undefined : tab === 'roles' ? <Button onClick={() => setCreatingRole(true)}>Create a role</Button> : <Button onClick={() => setInviting(true)}>Invite an admin</Button>;

  return (
    <>
      <PageHeader actions={action} />
      <Tabs label="Admins and roles" idPrefix="admins-page" tabs={PAGE_TABS} value={tab} onChange={(t) => navigate(t === 'roles' ? '/admins/roles' : '/admins')} />
      <TabPanel idPrefix="admins-page" value={tab} className="flex flex-col gap-3.5">
        {tab === 'roles' ? <RolesTab roles={roles} creating={creatingRole} onCreated={() => setCreatingRole(false)} /> : <AdminsTab roles={roles} />}
      </TabPanel>
      {inviting ? <AdminForm open roles={roles.data ?? []} canSetRole self={false} onClose={() => setInviting(false)} /> : null}
    </>
  );
}

/** One thing to do to an admin, and why it can't be done, if it can't. */
interface Action {
  label: string;
  why: string;
  run: () => void;
}

/** What the signed-in admin can do to `a`, as the backend's rules allow (see AdminService). */
function actionsFor(a: Account, grants: Grants | null, me: string | undefined, roles: Role[], on: { update: () => void; status: () => void; remove: () => void }): Action[] {
  const self = a.id === me;
  const blocked = cantManage(grants, a, roles.find((r) => r.id === a.role?.id)?.effectivePermissions);
  const out: Action[] = [];
  if (can(grants, 'ADMINS.UPDATE')) {
    out.push({ label: 'Update details', why: self ? '' : blocked, run: on.update });
    const disabled = a.status === 'disabled';
    out.push({ label: disabled ? 'Enable' : 'Disable', why: self ? `You can't ${disabled ? 'enable' : 'disable'} your own account.` : blocked, run: on.status });
  }
  if (can(grants, 'ADMINS.DELETE')) out.push({ label: 'Delete', why: self ? "You can't delete your own account." : blocked, run: on.remove });
  return out;
}

function RowMenu({ name, actions }: { name: string; actions: Action[] }) {
  if (!actions.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Options for ${name}`} title="Options" className="mr-2 flex size-9 shrink-0 items-center justify-center rounded-ctl text-ink-2 hover:bg-chip">
        <MoreVertical className="size-[18px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {actions.map((x) => (
          <DropdownMenuItem key={x.label} disabled={!!x.why} onSelect={x.run} className={cn(x.why && 'flex-col items-start justify-center gap-0.5 py-2')}>
            {x.label}
            {x.why ? <span className="text-[12px] font-normal">{x.why}</span> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const lastSignIn = (a: Account) => (a.lastLogin ? formatDateTime(a.lastLogin) : 'Never');
const COLUMNS = 'grid-cols-[1.1fr_1.4fr_0.9fr_0.6fr_0.9fr]';

function AdminRows({ rows, menuFor, me }: { rows: Account[]; menuFor: (a: Account) => Action[]; me: string | undefined }) {
  const compact = useCompact();
  const anyMenu = rows.some((a) => menuFor(a).length > 0);
  const name = (a: Account) => fullName(a) || a.email || '—';
  const you = (a: Account) => (a.id === me ? <span className="font-normal text-muted"> (you)</span> : null);
  if (compact) {
    return (
      <ul aria-label="Admins" className="m-0 list-none p-0">
        {rows.map((a) => (
          <li key={a.id} className="flex items-center border-b border-line last:border-b-0">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-3.5 py-2">
              <span className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="font-semibold [overflow-wrap:anywhere]">
                  {name(a)}
                  {you(a)}
                </span>
                <StatusPill label={adminStatus(a.status)} />
              </span>
              <span className="text-ink-3 [overflow-wrap:anywhere]">
                {a.email} · {roleLabel(a.role?.name)} · {a.lastLogin ? `last signed in ${formatDateTime(a.lastLogin)}` : 'never signed in'}
              </span>
            </div>
            <RowMenu name={name(a)} actions={menuFor(a)} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[820px]" role="table" aria-label="Admins">
        <div role="row" className={cn('grid gap-3 py-2 pl-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted', COLUMNS, anyMenu ? 'pr-[52px]' : 'pr-4')}>
          {['Name', 'Email', 'Role', 'Status', 'Last sign-in'].map((h) => (
            <span key={h} role="columnheader">
              {h}
            </span>
          ))}
        </div>
        {rows.map((a) => {
          const actions = menuFor(a);
          return (
            <div key={a.id} role="row" className="flex items-center border-t border-line">
              <div className={cn('grid min-h-11 min-w-0 flex-1 items-center gap-3 py-1 pl-4', COLUMNS, actions.length ? 'pr-0' : anyMenu ? 'pr-[52px]' : 'pr-4')}>
                <span role="cell" className="min-w-0 font-semibold [overflow-wrap:anywhere]">
                  {name(a)}
                  {you(a)}
                </span>
                <span role="cell" className="min-w-0 [overflow-wrap:anywhere]">{a.email ?? '—'}</span>
                <span role="cell" className="min-w-0 [overflow-wrap:anywhere]">{roleLabel(a.role?.name)}</span>
                <span role="cell"><StatusPill label={adminStatus(a.status)} /></span>
                <span role="cell" className="min-w-0">{lastSignIn(a)}</span>
              </div>
              <RowMenu name={name(a)} actions={actions} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AdminsTab({ roles }: { roles: UseQueryResult<Role[]> }) {
  const grants = useGrants();
  const me = useSession().session?.accountId;
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = React.useState<Account | null>(null);
  const [decision, setDecision] = React.useState<Decision | null>(null);

  const status = STATUS_CHIPS.find((c) => c.value && c.value === params.get('status'))?.value || undefined;
  const roleId = params.get('role') ?? '';
  const q = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const sizeParam = Number(params.get('size'));
  const size = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : DEFAULT_SIZE;

  // the address as it is now: the search's delayed update must not undo a filter chosen while it waited
  const latest = React.useRef(params);
  latest.current = params;

  /** Changes some values; any change but the page goes back to page 1. */
  const update = (changes: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(latest.current);
    for (const [k, v] of Object.entries(changes)) {
      if (v === undefined || v === '' || (k === 'page' && v === 1) || (k === 'size' && v === DEFAULT_SIZE)) next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in changes)) next.delete('page');
    latest.current = next;
    setParams(next, { replace: true });
  };

  // the search waits for a pause in typing, then goes in the address, which can change it too (back, a link)
  const [text, setText] = React.useState(q);
  React.useEffect(() => {
    if (text.trim() === q) return;
    const t = setTimeout(() => update({ q: text.trim() }), 300);
    return () => clearTimeout(t);
  }, [text]);
  React.useEffect(() => setText(q), [q]);

  const query = useQuery({
    queryKey: ['admins', 'list', { page, size, q, status, roleId }],
    queryFn: () => listAdmins({ page, size, search: q || undefined, status, roleId: roleId || undefined }),
    placeholderData: keepPreviousData
  });

  const changed = (message: string) => {
    toast.success(message);
    void qc.invalidateQueries({ queryKey: ['admins'] });
    void qc.invalidateQueries({ queryKey: ['roles'] });
  };

  const rolesList = roles.data ?? [];
  const isSystemAdmin = grants?.role === SYSTEM_ADMIN_ROLE;

  const menuFor = (a: Account) => {
    const name = fullName(a) || a.email || 'this admin';
    const rows = [
      { k: 'Email', v: a.email ?? '—' },
      { k: 'Role', v: roleLabel(a.role?.name) }
    ];
    const disabled = a.status === 'disabled';
    return actionsFor(a, grants, me, rolesList, {
      update: () => setEditing(a),
      status: () =>
        setDecision(
          disabled
            ? { title: `Enable ${name}?`, description: 'They can sign in again with their password.', confirm: 'Enable', rows, run: () => enableAdmin(a.id!), done: () => changed(`${name} is enabled.`) }
            : {
                title: `Disable ${name}?`,
                description: "They are signed out everywhere now and can't sign in until they are enabled. They are emailed that their account was disabled, with the reason below.",
                confirm: 'Disable',
                danger: true,
                rows,
                note: { label: 'Reason (optional)', hint: `${NOTE_HINT} They see it.` },
                run: (note) => disableAdmin(a.id!, note),
                done: () => changed(`${name} is disabled.`)
              }
        ),
      remove: () =>
        setDecision({
          title: `Delete ${name}?`,
          description: "They are signed out and can never sign in again. This can't be undone; what they did stays in the audit log.",
          confirm: 'Delete',
          danger: true,
          rows,
          run: () => deleteAdmin(a.id!),
          done: () => changed(`${name} is deleted.`)
        })
    });
  };

  const total = query.data?.totalResults ?? 0;
  const list = query.isPending ? (
    <p className="m-0 px-4 py-5 text-muted">Loading admins…</p>
  ) : query.isError ? (
    <div className="p-3.5">
      <Banner tone="bad">{errorMessage(query.error)}</Banner>
    </div>
  ) : !query.data.results?.length ? (
    <p className="m-0 px-4 py-5 text-muted">No admins match.</p>
  ) : (
    <AdminRows rows={query.data.results} menuFor={menuFor} me={me} />
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Input type="search" aria-label="Search by name, email or phone" placeholder="Name, email or phone" value={text} onChange={(e) => setText(e.target.value)} className="max-w-[320px] flex-[1_1_220px]" />
        <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
          {STATUS_CHIPS.map((c) => (
            <Chip key={c.label} on={(status ?? '') === c.value} onClick={() => update({ status: c.value })}>
              {c.label}
            </Chip>
          ))}
        </div>
        <select aria-label="Role" value={roleId} onChange={(e) => update({ role: e.target.value })} className="min-h-9 rounded-ctl border border-ctl bg-surface px-2 text-ink">
          <option value="">All roles</option>
          {rolesList.map((r) => (
            <option key={r.id} value={r.id}>
              {roleLabel(r.name)}
            </option>
          ))}
        </select>
      </div>
      <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface', query.isFetching && !query.isPending && 'opacity-70')} aria-busy={query.isFetching}>
        {list}
        {total > 0 ? <Pager page={page} size={size} total={total} onPage={(p) => update({ page: p })} onSize={(s) => update({ size: s })} /> : null}
      </section>

      {editing ? <AdminForm key={editing.id} open admin={editing} roles={rolesList} canSetRole={isSystemAdmin && editing.id !== me} self={editing.id === me} onClose={() => setEditing(null)} /> : null}
      <DecisionDialog decision={decision} onClose={() => setDecision(null)} />
    </>
  );
}

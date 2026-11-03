import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { toast } from 'sonner';
import { createRole, deleteRole, listPermissions, updateRole, type Role } from '@/api/admins';
import { errorMessage } from '@/api/errors';
import { Badge, Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Lines } from '@/components/ui/card';
import { DecisionDialog, type Decision } from '@/components/ui/decision-dialog';
import { Field } from '@/components/ui/field';
import { FormDialog } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Muted, SectionTitle } from '@/components/ui/parts';
import { Rows, type Column } from '@/components/ui/rows';
import { Sheet } from '@/components/ui/sheet';
import { SYSTEM_ADMIN_ROLE } from '@/lib/permissions';
import { moduleLabel, permissionLabel, roleLabel, roleName, setModule, setPermission } from '@/lib/roles';
import { useGrants } from '@/session/SessionProvider';

// The Roles tab of screen 18. Every admin who can see admins sees the roles; only the system admin creates,
// changes and deletes them. The system admin role always has every permission, and no built-in role is renamed
// or deleted. A change reaches every admin holding the role on their next request.

const count = (n: number | undefined, one: string) => `${n ?? 0} ${one}${n === 1 ? '' : 's'}`;

/** How many single permissions a role has: a whole module counts as each one in it, not as one more. */
const permissionCount = (r: Role) => r.effectivePermissions?.filter((p) => p.includes('.')).length ?? 0;

const COLUMNS: Column<Role>[] = [
  {
    header: 'Role',
    cell: (r) => (
      <span className="flex flex-wrap items-center gap-1.5">
        {roleLabel(r.name)}
        {r.protectedRole ? <Badge tone="neutral">Built-in</Badge> : null}
      </span>
    )
  },
  { header: 'Permissions', cell: permissionCount },
  { header: 'Admins holding it', cell: (r) => r.admins ?? 0 }
];

/** Why the role's permissions or name can't be changed, or '' when they can. */
const cantEdit = (r: Role) => (r.name === SYSTEM_ADMIN_ROLE ? 'The system admin role always has every permission.' : '');

/** Why the role can't be deleted, or '' when it can. */
const cantDelete = (r: Role) =>
  r.protectedRole ? "Built-in roles can't be deleted." : r.admins ? `Held by ${count(r.admins, 'admin')}. Give them another role first.` : '';

export function RolesTab({ roles, creating, onCreated }: { roles: UseQueryResult<Role[]>; creating: boolean; onCreated: () => void }) {
  const navigate = useNavigate();
  const { roleId } = useParams();
  const qc = useQueryClient();
  const isSystemAdmin = useGrants()?.role === SYSTEM_ADMIN_ROLE;
  const permissions = useQuery({ queryKey: ['permissions'], queryFn: listPermissions, staleTime: Infinity });
  const [editing, setEditing] = React.useState<Role | null>(null);
  const [decision, setDecision] = React.useState<Decision | null>(null);

  const close = () => navigate('/admins/roles');
  const open = roles.data?.find((r) => r.id === roleId);
  const byModule = permissions.data ?? {};

  const remove = (r: Role) =>
    setDecision({
      title: `Delete the role ${roleLabel(r.name)}?`,
      description: "No admin holds it. This can't be undone.",
      confirm: 'Delete',
      danger: true,
      rows: [{ k: 'Permissions', v: permissionCount(r) }],
      run: () => deleteRole(r.id!),
      done: () => {
        toast.success(`The role ${roleLabel(r.name)} is deleted.`);
        void qc.invalidateQueries({ queryKey: ['roles'] });
        if (roleId === r.id) close();
      }
    });

  const list = roles.isPending ? (
    <p className="m-0 px-4 py-5 text-muted">Loading roles…</p>
  ) : roles.isError ? (
    <div className="p-3.5">
      <Banner tone="bad">{errorMessage(roles.error)}</Banner>
    </div>
  ) : !roles.data.length ? (
    <p className="m-0 px-4 py-5 text-muted">No roles yet.</p>
  ) : (
    <Rows<Role>
      label="Roles"
      rows={roles.data}
      rowKey={(r) => r.id!}
      columns={COLUMNS}
      grid="grid-cols-[1.4fr_0.6fr_0.6fr]"
      minWidth={520}
      linkFor={(r) => `/admins/roles/${r.id}`}
      sub={(r) => `${count(permissionCount(r), 'permission')} · held by ${count(r.admins, 'admin')}`}
    />
  );

  return (
    <>
      <Muted>A role says what its admins can see and do. Giving a role a whole module also gives it any permission added to that module later.</Muted>
      <section className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface">{list}</section>

      <Sheet open={!!roleId} onClose={close} title="Role details">
        {roles.isPending || permissions.isPending ? (
          <Muted>Loading the role…</Muted>
        ) : permissions.isError ? (
          <Banner tone="bad">{errorMessage(permissions.error)}</Banner>
        ) : open ? (
          <RoleDetail role={open} byModule={byModule} canChange={isSystemAdmin} onEdit={() => setEditing(open)} onDelete={() => remove(open)} />
        ) : (
          <Banner tone="bad">There's no role with this ID.</Banner>
        )}
      </Sheet>

      {creating ? <RoleForm roles={roles.data ?? []} byModule={byModule} onClose={onCreated} /> : null}
      {editing ? <RoleForm key={editing.id} role={editing} roles={roles.data ?? []} byModule={byModule} onClose={() => setEditing(null)} /> : null}
      <DecisionDialog decision={decision} onClose={() => setDecision(null)} />
    </>
  );
}

function RoleDetail({ role, byModule, canChange, onEdit, onDelete }: { role: Role; byModule: Record<string, string[]>; canChange: boolean; onEdit: () => void; onDelete: () => void }) {
  const granted = role.permissions ?? [];
  const effective = role.effectivePermissions ?? [];
  const lines = Object.entries(byModule).map(([module, all]) => {
    const held = all.filter((p) => effective.includes(p));
    const v = granted.includes(module) ? 'All, and any added later' : held.length ? held.map(permissionLabel).join(', ') : 'None';
    return { k: moduleLabel(module), v };
  });
  const editWhy = cantEdit(role);
  const deleteWhy = cantDelete(role);
  return (
    <>
      <section className="flex flex-col gap-3.5 rounded-card border border-line bg-surface px-5 pb-4 pt-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="m-0 font-heading text-xl font-bold [overflow-wrap:anywhere]">{roleLabel(role.name)}</h2>
          {role.protectedRole ? <Badge tone="neutral">Built-in</Badge> : null}
        </div>
        <Lines
          rows={[
            { k: 'Name in the GP API', v: <span className="font-mono text-[13px]">{role.name}</span> },
            { k: 'Admins holding it', v: role.admins ? <Link to={`/admins?role=${role.id}`}>{count(role.admins, 'admin')}</Link> : 'None' },
            { k: 'Permissions', v: permissionCount(role) }
          ]}
        />
        <SectionTitle>What it can do</SectionTitle>
        <Lines rows={lines} />
      </section>
      {canChange ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <Button variant="outline" disabled={!!editWhy} onClick={onEdit}>
              {role.protectedRole ? 'Change permissions' : 'Rename or change permissions'}
            </Button>
            <Button variant="danger" className="ml-auto" disabled={!!deleteWhy} onClick={onDelete}>
              Delete the role
            </Button>
          </div>
          {editWhy || deleteWhy ? <Muted>{[editWhy, deleteWhy].filter(Boolean).join(' ')}</Muted> : null}
        </div>
      ) : null}
    </>
  );
}

/** Creating a role (`role` left out), or renaming one and changing its permissions. */
function RoleForm({ role, roles, byModule, onClose }: { role?: Role; roles: Role[]; byModule: Record<string, string[]>; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = React.useState(role ? roleLabel(role.name) : '');
  const [granted, setGranted] = React.useState<string[]>(role?.permissions ?? []);
  const stored = roleName(name);
  const renamed = !!role && stored !== role.name;

  const check = () => {
    if (!name.trim()) return 'Enter the role name.';
    if (!stored) return 'A role name can only have letters, digits, spaces, hyphens and underscores.';
    if (roles.some((r) => r.name === stored && r.id !== role?.id)) return `There's already a role called ${roleLabel(stored)}.`;
    if (!granted.length) return 'Choose at least one permission.';
    return '';
  };

  return (
    <FormDialog
      open
      wide
      title={role ? `Change ${roleLabel(role.name)}` : 'Create a role'}
      description={role ? `${role.admins ? `The ${count(role.admins, 'admin')} holding it get the change on their next step in the portal.` : 'No admin holds it yet.'}` : 'Give it to admins when you invite them, or from their row on the Admins tab.'}
      confirm={role ? 'Save' : 'Create the role'}
      onClose={onClose}
      check={check}
      send={() => (role ? updateRole(role.id!, { ...(renamed ? { name: name.trim() } : {}), permissions: granted }) : createRole({ name: name.trim(), permissions: granted }))}
      saved={() => void qc.invalidateQueries({ queryKey: ['roles'] })}
      done={role ? `${roleLabel(stored)} was saved.` : `The role ${roleLabel(stored)} was created.`}
    >
      <Field id="role-name" label="Role name" hint={role?.protectedRole ? "Built-in roles can't be renamed." : 'Such as Parameter approver. Letters, digits, spaces, hyphens and underscores.'}>
        <Input id="role-name" maxLength={85} value={name} disabled={role?.protectedRole} onChange={(e) => setName(e.target.value)} aria-describedby="role-name-hint" />
      </Field>
      <PermissionPicker byModule={byModule} granted={granted} onChange={setGranted} />
    </FormDialog>
  );
}

/** A box per module: the whole module, or single permissions in it. */
function PermissionPicker({ byModule, granted, onChange }: { byModule: Record<string, string[]>; granted: string[]; onChange: (g: string[]) => void }) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-1.5 p-0 text-sm font-medium text-ink">Permissions</legend>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {Object.entries(byModule).map(([module, all]) => {
          const whole = granted.includes(module);
          const label = moduleLabel(module);
          return (
            <div key={module} role="group" aria-label={label} className="flex flex-col gap-1.5 rounded-ctl border border-line px-3 py-2.5">
              <span className="font-semibold">{label}</span>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-primary" checked={whole} onChange={(e) => onChange(setModule(granted, module, all, e.target.checked))} />
                All, and any added later
              </label>
              {all.map((p) => (
                <label key={p} className="flex items-center gap-2 pl-6" title={p}>
                  <input type="checkbox" className="size-4 accent-primary" checked={whole || granted.includes(p)} disabled={whole} onChange={(e) => onChange(setPermission(granted, p, e.target.checked))} />
                  {permissionLabel(p)}
                </label>
              ))}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

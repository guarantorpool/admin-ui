import { useQueryClient } from '@tanstack/react-query';
import { inviteAdmin, updateAdmin, type Role } from '@/api/admins';
import type { Account } from '@/api/types';
import { Field } from '@/components/ui/field';
import { FormDialog, selectClass, useForm } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { fullName } from '@/lib/names';
import { cleanPhone, isPhone, PHONE_MESSAGE } from '@/lib/phone';
import { roleLabel } from '@/lib/roles';
import * as store from '@/session/store';

const NAME = /^[\p{L} .'-]+$/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Inviting an admin (`admin` left out), or changing one's names, phone number and, for the system admin, role.
 * `canSetRole` is false for anyone but the system admin, and for their own account.
 */
export function AdminForm({ open, admin, roles, canSetRole, self, onClose }: { open: boolean; admin?: Account; roles: Role[]; canSetRole: boolean; self: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, set] = useForm(open, {
    firstName: admin?.firstName ?? '',
    middleName: admin?.middleName ?? '',
    lastName: admin?.lastName ?? '',
    email: admin?.email ?? '',
    phoneNumber: admin?.phoneNumber ?? '',
    roleId: admin?.role?.id ?? ''
  });

  const check = () => {
    if (!f.firstName.trim() || !f.lastName.trim()) return 'Enter the first and last names.';
    if (![f.firstName, f.middleName, f.lastName].every((n) => !n.trim() || NAME.test(n.trim()))) return 'Names can only have letters, spaces, dots, apostrophes and hyphens.';
    if (!admin && !EMAIL.test(f.email.trim())) return 'Enter their email address.';
    if ((!admin || f.phoneNumber.trim()) && !isPhone(f.phoneNumber)) return PHONE_MESSAGE;
    if (canSetRole && !f.roleId) return 'Choose their role.';
    return '';
  };

  // an empty middle name takes it away
  const names = { firstName: f.firstName.trim(), middleName: f.middleName.trim(), lastName: f.lastName.trim() };
  const send = () =>
    admin
      ? updateAdmin(admin.id!, { ...names, ...(f.phoneNumber.trim() ? { phoneNumber: cleanPhone(f.phoneNumber) } : {}), ...(canSetRole ? { roleId: f.roleId } : {}) })
      : inviteAdmin({ ...names, email: f.email.trim(), phoneNumber: cleanPhone(f.phoneNumber), roleId: f.roleId });

  const saved = (a: Account) => {
    void qc.invalidateQueries({ queryKey: ['admins'] });
    void qc.invalidateQueries({ queryKey: ['roles'] });
    if (self) {
      store.updateProfile({ firstName: a.firstName ?? '', lastName: a.lastName ?? '' });
      void qc.invalidateQueries({ queryKey: ['profile'] });
    }
  };

  const name = fullName(admin) || admin?.email || '';
  return (
    <FormDialog
      open={open}
      title={admin ? `Update ${name}` : 'Invite an admin'}
      description={admin ? (self ? 'Only another system admin can change your role.' :'A new phone number has to be confirmed again.') : 'They get an email with a link to set their first password, and can sign in once it is set.'}
      rows={admin ? [{ k: 'Email', v: admin.email ?? '—' }, ...(canSetRole ? [] : [{ k: 'Role', v: roleLabel(admin.role?.name) }])] : undefined}
      confirm={admin ? 'Save' : 'Send the invitation'}
      onClose={onClose}
      check={check}
      send={send}
      saved={saved}
      done={admin ? `${name}'s details were saved.` : `The invitation was sent to ${f.email.trim()}.`}
    >
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field id="admin-first" label="First name">
          <Input id="admin-first" maxLength={100} value={f.firstName} onChange={set('firstName')} />
        </Field>
        <Field id="admin-last" label="Last name">
          <Input id="admin-last" maxLength={100} value={f.lastName} onChange={set('lastName')} />
        </Field>
      </div>
      <Field id="admin-middle" label="Middle name (optional)">
        <Input id="admin-middle" maxLength={100} value={f.middleName} onChange={set('middleName')} />
      </Field>
      {admin ? null : (
        <Field id="admin-email" label="Email">
          <Input id="admin-email" type="email" autoComplete="off" value={f.email} onChange={set('email')} />
        </Field>
      )}
      <Field id="admin-phone" label="Phone number">
        <Input id="admin-phone" type="tel" autoComplete="off" value={f.phoneNumber} onChange={set('phoneNumber')} />
      </Field>
      {canSetRole ? (
        <Field id="admin-role" label="Role" hint="What they can see and do. Roles are set up on the Roles tab.">
          <select id="admin-role" value={f.roleId} onChange={set('roleId')} aria-describedby="admin-role-hint" className={selectClass}>
            <option value="">Choose a role</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {roleLabel(r.name)}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
    </FormDialog>
  );
}

import { describe, expect, it } from 'vitest';
import { cantManage, permissionLabel, roleLabel, roleName, setModule, setPermission } from './roles';

describe('roles', () => {
  it('reads role names as admins say them', () => {
    expect(roleLabel('ROLE_SYSTEM_ADMIN')).toBe('System admin');
    expect(roleLabel('ROLE_PARAMETER_APPROVER')).toBe('Parameter approver');
    expect(roleLabel(undefined)).toBe('—');
  });

  it('stores a name the way the backend does, or refuses it', () => {
    expect(roleName('parameter approver')).toBe('ROLE_PARAMETER_APPROVER');
    expect(roleName(' Parameter-Approver ')).toBe('ROLE_PARAMETER_APPROVER');
    expect(roleName('ROLE_auditor')).toBe('ROLE_AUDITOR');
    expect(roleName('KYC & files')).toBe('');
    // the label of a stored name comes back to the same name
    expect(roleName(roleLabel('ROLE_LEDGER_2'))).toBe('ROLE_LEDGER_2');
  });

  it('names permissions and whole modules', () => {
    expect(permissionLabel('MEMBERS.KYC')).toBe('Review KYC and files');
    expect(permissionLabel('PARAMETERS.APPROVE')).toBe('Approve');
    expect(permissionLabel('LEDGER')).toBe('All of Activity');
    expect(permissionLabel('NEW.THING')).toBe('Thing');
  });

  it('gives a whole module in place of its single permissions, and takes it back', () => {
    const inModule = ['MEMBERS.READ', 'MEMBERS.UPDATE', 'MEMBERS.KYC'];
    const some = ['MEMBERS.READ', 'AUDIT.READ'];
    const whole = setModule(some, 'MEMBERS', inModule, true);
    expect(whole).toEqual(['AUDIT.READ', 'MEMBERS']);
    expect(setModule(whole, 'MEMBERS', inModule, false)).toEqual(['AUDIT.READ']);
    expect(setPermission(['AUDIT.READ'], 'MEMBERS.KYC', true)).toEqual(['AUDIT.READ', 'MEMBERS.KYC']);
    expect(setPermission(['AUDIT.READ', 'MEMBERS.KYC'], 'MEMBERS.KYC', false)).toEqual(['AUDIT.READ']);
  });

  it('says why an admin is out of reach', () => {
    const ops = { role: 'ROLE_OPERATIONS', permissions: ['ADMINS.READ', 'ADMINS.UPDATE', 'MEMBERS.READ'] };
    const sys = { role: 'ROLE_SYSTEM_ADMIN', permissions: ['ADMINS.READ'] };
    const sysTarget = { role: { name: 'ROLE_SYSTEM_ADMIN' } };
    expect(cantManage(ops, sysTarget, undefined)).toBe('Only a system admin can manage a system admin.');
    expect(cantManage(ops, { role: { name: 'ROLE_KYC' } }, ['MEMBERS.READ', 'MEMBERS.KYC'])).toBe("Their role has permissions yours doesn't.");
    expect(cantManage(ops, { role: { name: 'ROLE_READER' } }, ['MEMBERS.READ'])).toBe('');
    expect(cantManage(sys, sysTarget, ['ADMINS.READ'])).toBe('');
  });
});

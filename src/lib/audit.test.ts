import { describe, expect, it } from 'vitest';
import { resetPhrase } from '@/pages/kycKey/KycKeyPage';
import { actorName, auditAction, KNOWN_ACTIONS, recordPath, recordType } from './audit';
import { keyStatus, scopeLabel } from './labels';

describe('audit log labels', () => {
  it('reads actions, with a code it does not know as a sentence', () => {
    expect(auditAction('LOGIN')).toBe('Signed in');
    expect(auditAction('SERVICE_KEY_ROTATED')).toBe('Service key rotated');
    expect(auditAction('LOAN_WRITE_OFF_APPROVED')).toBe('Loan write off approved');
    expect(auditAction('SOMETHING_NEW')).toBe('Something new');
    expect(auditAction(null)).toBe('—');
  });

  it('offers each action once', () => {
    expect(new Set(KNOWN_ACTIONS).size).toBe(KNOWN_ACTIONS.length);
  });

  it('names who did it', () => {
    expect(actorName('ADMIN', 'grace@blockcoop.test')).toBe('grace@blockcoop.test');
    expect(actorName('SERVICE', 'Ledger sync')).toBe('Ledger sync');
    expect(actorName('SYSTEM', null)).toBe('The GP API');
    expect(actorName('MEMBER', null)).toBe('Member');
  });

  it('links a record to its page where it has one', () => {
    expect(recordPath('member', 'm1')).toBe('/members/m1');
    expect(recordPath('role', 'r1')).toBe('/admins/roles/r1');
    expect(recordPath('payment_refund', 'x')).toBe('/refunds/x');
    expect(recordPath('service_key', 'k1')).toBeNull();
    expect(recordPath('member', null)).toBeNull();
    expect(recordType('loan_record')).toBe('Loan');
    expect(recordType('new_kind')).toBe('New kind');
  });
});

describe('service keys and the KYC key', () => {
  it('reads key status and scopes', () => {
    expect(keyStatus('active')).toEqual({ text: 'In use', tone: 'ok' });
    expect(keyStatus('revoked').tone).toBe('bad');
    expect(scopeLabel('facts:write')).toBe('Send activity records');
    expect(scopeLabel('loans:write')).toBe("Send a lender's new loans");
    expect(scopeLabel('other:scope')).toBe('other:scope');
  });

  it('asks for the number of members in the reset phrase', () => {
    expect(resetPhrase(1)).toBe('reset 1 member');
    expect(resetPhrase(3)).toBe('reset 3 members');
  });
});

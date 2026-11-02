import { envBadge } from './env';
import { formatAmount, formatDate, formatDateTime, formatNumber, formatUsdt } from './format';
import { can, canAny } from './permissions';

describe('envBadge', () => {
  it('hides only for exactly prod', () => {
    expect(envBadge('prod')).toBeNull();
    expect(envBadge('local')).toBe('Local');
    expect(envBadge('staging')).toBe('Staging');
    expect(envBadge('Prod')).toBe('Prod');
    expect(envBadge('production')).toBe('Production');
  });

  it('says Unknown when unset, so a forgotten setting still warns', () => {
    expect(envBadge(undefined)).toBe('Unknown');
    expect(envBadge('  ')).toBe('Unknown');
  });
});

describe('dates in Nairobi time (D-002)', () => {
  it('shows UTC instants in EAT, whatever the browser zone', () => {
    // 21:30 UTC is 00:30 the next day in Nairobi
    expect(formatDateTime('2026-11-01T21:30:00Z')).toBe('2 Nov 2026, 00:30');
    expect(formatDate('2026-11-01T21:30:00Z')).toBe('2 Nov 2026');
  });

  it('labels the zone when asked', () => {
    expect(formatDateTime(Date.UTC(2026, 10, 2, 11, 5), { zone: true })).toBe('2 Nov 2026, 14:05 EAT');
  });

  it('shows a dash for nothing or nonsense', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDate('not a date')).toBe('—');
  });
});

describe('amounts (D-002)', () => {
  it('rounds to 2 decimals in lists', () => {
    expect(formatUsdt('1234.5')).toBe('1,234.50 USDT');
    expect(formatUsdt('0.005')).toBe('0.01 USDT');
    expect(formatUsdt('0.004999')).toBe('0.00 USDT');
    expect(formatUsdt('999999.995')).toBe('1,000,000.00 USDT');
    expect(formatUsdt(-12.345)).toBe('-12.35 USDT');
  });

  it('keeps full precision for detail views, without passing through a float', () => {
    expect(formatUsdt('1234.123456789012345678', { full: true })).toBe('1,234.123456789012345678 USDT');
    expect(formatUsdt('90071992547409931.000001', { full: true })).toBe('90,071,992,547,409,931.000001 USDT');
    expect(formatUsdt('1500', { full: true })).toBe('1,500.00 USDT');
    expect(formatUsdt('1500.10', { full: true })).toBe('1,500.10 USDT');
    expect(formatUsdt('-0.5', { full: true })).toBe('-0.50 USDT');
  });

  it('labels KES and BLOCKS the same way', () => {
    expect(formatAmount('55000', 'KES')).toBe('55,000.00 KES');
    expect(formatAmount('12.3456', 'BLOCKS', { full: true })).toBe('12.3456 BLOCKS');
  });

  it('shows a dash for missing or malformed values', () => {
    expect(formatUsdt(null)).toBe('—');
    expect(formatUsdt('')).toBe('—');
    expect(formatUsdt('12abc')).toBe('—');
    expect(formatNumber('-0.001', 2)).toBe('0.00');
  });

  it('handles numbers JavaScript would print in exponent form', () => {
    expect(formatNumber(1e-7)).toBe('0.0000001');
    expect(formatNumber(1e21, 2)).toBe('1,000,000,000,000,000,000,000.00');
  });
});

describe('permissions', () => {
  const kyc = { role: 'KYC reviewer', permissions: ['MEMBERS.READ', 'MEMBERS.KYC'] };
  const sys = { role: 'ROLE_SYSTEM_ADMIN', permissions: ['MEMBERS.READ'] };

  it('checks a granted permission', () => {
    expect(can(kyc, 'MEMBERS.KYC')).toBe(true);
    expect(can(kyc, 'POOL.READ')).toBe(false);
    expect(canAny(kyc, ['POOL.READ', 'MEMBERS.READ'])).toBe(true);
  });

  it('needs every permission of a list', () => {
    expect(can(kyc, ['MEMBERS.READ', 'MEMBERS.KYC'])).toBe(true);
    expect(can({ ...kyc, permissions: ['MEMBERS.KYC'] }, ['MEMBERS.READ', 'MEMBERS.KYC'])).toBe(false);
  });

  it('keeps the KYC key to the system admin role, which no permission grants', () => {
    expect(can(sys, 'SYSTEM_ADMIN')).toBe(true);
    expect(can({ ...kyc, permissions: [...kyc.permissions, 'ADMINS.READ'] }, 'SYSTEM_ADMIN')).toBe(false);
  });

  it('refuses everything when signed out', () => {
    expect(can(null, 'ANY')).toBe(false);
    expect(can(undefined, 'MEMBERS.READ')).toBe(false);
  });
});

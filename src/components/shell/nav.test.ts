import { allScreens, findScreen, homePath, safeNext, visibleNav } from './nav';

const labels = (grants: Parameters<typeof visibleNav>[0]) =>
  visibleNav(grants).map((e) => (e.kind === 'direct' ? e.screen.label : `${e.group.label}: ${e.group.items.map((s) => s.label).join(', ')}`));

describe('menu', () => {
  it('hides what a narrow role cannot open, and empty groups', () => {
    expect(labels({ role: 'KYC', permissions: ['MEMBERS.KYC'] })).toEqual(['Dashboard', 'Approvals inbox', 'Members: KYC and address review']);
  });

  it('shows the KYC key only to the system admin role', () => {
    const all = ['ADMINS.READ', 'SERVICE_KEYS.READ', 'AUDIT.READ'];
    expect(labels({ role: 'Ops', permissions: all }).at(-1)).toBe('Administration: Admins and roles, Service keys, Audit log');
    expect(labels({ role: 'ROLE_SYSTEM_ADMIN', permissions: all }).at(-1)).toBe('Administration: Admins and roles, Service keys, KYC encryption key, Audit log');
  });

  it('gives every screen a unique path, and each one not built yet a slice or phase', () => {
    const screens = allScreens();
    expect(new Set(screens.map((s) => s.path)).size).toBe(screens.length);
    screens.filter((s) => s.comingIn !== undefined).forEach((s) => expect(s.comingIn).toMatch(/^(slice \d+|Phase [A-E])$/));
    expect(findScreen('/members')?.screen.comingIn).toBeUndefined();
  });

  it('finds the breadcrumb group, for a screen and for one of its records', () => {
    expect(findScreen('/pool/settings')?.group?.label).toBe('Pool');
    expect(findScreen('/members/0b8f')?.screen.label).toBe('All members');
    expect(findScreen('/membersx')).toBeNull();
    expect(findScreen('/alerts')?.group).toBeNull();
    expect(findScreen('/nowhere')).toBeNull();
  });
});

describe('where sign-in lands', () => {
  it('is the first screen the role allows, skipping the dashboard and inbox until they exist', () => {
    expect(homePath({ role: 'x', permissions: ['ALERTS.READ', 'MEMBERS.READ'] })).toBe('/alerts');
    expect(homePath({ role: 'x', permissions: ['REFUNDS.READ'] })).toBe('/refunds');
    expect(homePath({ role: 'x', permissions: [] })).toBe('/account');
  });

  it('only follows a next inside the portal', () => {
    expect(safeNext('/members?q=1')).toBe('/members?q=1');
    expect(safeNext('https://evil.example')).toBeNull();
    expect(safeNext('//evil.example')).toBeNull();
    expect(safeNext('/\\evil.example')).toBeNull();
    expect(safeNext('/sign-in')).toBeNull();
    expect(safeNext(null)).toBeNull();
  });
});

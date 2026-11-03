import { alertDetails, newerAlert, type Alert } from './alerts';

const open: Alert = { id: 'a1', status: 'OPEN', lastSeenAt: '2026-11-03T10:00:00Z' };

describe('newerAlert', () => {
  it('keeps an acknowledgement made after the list was read', () => {
    const acked: Alert = { ...open, status: 'ACKNOWLEDGED', acknowledgedAt: '2026-11-03T10:05:00Z' };
    expect(newerAlert(acked, open)).toBe(acked);
  });

  it('takes a list row read after the cached one', () => {
    const acked: Alert = { ...open, status: 'ACKNOWLEDGED', acknowledgedAt: '2026-11-03T10:05:00Z' };
    const resolved: Alert = { ...acked, status: 'RESOLVED', resolvedAt: '2026-11-03T11:00:00Z' };
    expect(newerAlert(acked, resolved)).toBe(resolved);
  });

  it('takes whichever one there is', () => {
    expect(newerAlert(null, open)).toBe(open);
    expect(newerAlert(open, undefined)).toBe(open);
    expect(newerAlert(null, undefined)).toBeUndefined();
  });
});

describe('alertDetails', () => {
  it('reads details sent as an object or as JSON text', () => {
    expect(alertDetails({ ...open, details: { quoteId: 'GPQ-1' } as unknown as string })).toEqual({ quoteId: 'GPQ-1' });
    expect(alertDetails({ ...open, details: '{"quoteId":"GPQ-1"}' })).toEqual({ quoteId: 'GPQ-1' });
    expect(alertDetails({ ...open, details: 'not json' })).toEqual({});
  });
});

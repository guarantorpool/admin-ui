import { APPLIES_AT_ONCE, groupSettings, OTHER, readValue, sameValue, SETTING_GROUPS, settingValue, sumValues } from './settings';

describe('pool settings groups', () => {
  it('puts each setting in its group, in order, and drops empty groups', () => {
    const groups = groupSettings([
      { key: 'operating_fee_max_usd', type: 'static' },
      { key: 'pillar_weight_financial', type: 'static' },
      { key: 'pillar_weight_identity', type: 'static' },
      { key: 'operating_fee_rate', type: 'static' }
    ]);
    expect(groups.map((g) => [g.title, g.settings.map((s) => s.key)])).toEqual([
      ['Trust Score pillar weights', ['pillar_weight_identity', 'pillar_weight_financial']],
      ['Operating fee', ['operating_fee_rate', 'operating_fee_max_usd']]
    ]);
  });

  it('lists a setting that applies at once on its own, and one it does not know under other settings', () => {
    const groups = groupSettings([
      { key: 'invite_max_unused', type: 'dynamic' },
      // a known key the backend has since made dynamic moves with the type, not the list
      { key: 'claim_waiting_days', type: 'dynamic' },
      { key: 'new_backend_setting', type: 'static' }
    ]);
    expect(groups.map((g) => [g.title, g.settings.map((s) => s.key)])).toEqual([
      [APPLIES_AT_ONCE, ['invite_max_unused', 'claim_waiting_days']],
      [OTHER, ['new_backend_setting']]
    ]);
  });

  it('names each key once', () => {
    const keys = SETTING_GROUPS.flatMap((g) => g.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('setting values', () => {
  it('shows the value in full, and a switch as on or off', () => {
    expect(settingValue('liquidity_ratio', 0.485)).toBe('0.485');
    expect(settingValue('quote_validity_seconds', 86400)).toBe('86,400');
    expect(settingValue('recovery_rate_calculated', 0)).toBe('0 (off)');
    expect(settingValue('recovery_rate_calculated', 1)).toBe('1 (on)');
    expect(settingValue('recovery_rate', undefined)).toBe('—');
  });

  it('reads a typed value, refusing what is not a plain number', () => {
    expect(readValue(' 0.25 ')).toEqual({ value: 0.25 });
    expect(readValue('.5')).toEqual({ value: 0.5 });
    expect(readValue('72')).toEqual({ value: 72 });
    expect(readValue('')).toEqual({ error: 'Enter the new value.' });
    for (const bad of ['-1', '1,000', '10%', '0.5 USD', '1e3', 'abc', '.']) expect(readValue(bad)).toHaveProperty('error');
    // past what a JSON number keeps exactly
    expect(readValue('0.123456789012345678')).toHaveProperty('error');
  });

  it('compares values as numbers', () => {
    expect(sameValue('0.10', 0.1)).toBe(true);
    expect(sameValue(72, '72.000')).toBe(true);
    expect(sameValue(0.1, 0.2)).toBe(false);
    expect(sameValue(undefined, 0)).toBe(false);
  });

  it('adds decimals exactly', () => {
    expect(sumValues([0.15, 0.25, 0.25, 0.35])).toBe('1');
    expect(sumValues(['0.1', '0.2'])).toBe('0.3');
    expect(sumValues(['0.2', '0.25', '0.25', '0.35'])).toBe('1.05');
    expect(sumValues([])).toBe('0');
  });
});

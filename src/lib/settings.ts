import { formatNumber } from './format';

// The pool settings screen (screen 14): how its settings are grouped, shown and entered. The backend holds each
// setting's description and rules and checks every value; the portal only groups them and catches what's plainly
// not a number.

export interface SettingGroup {
  title: string;
  keys: readonly string[];
}

// In the wireframe's order, then the settings it didn't show. A setting that applies at once is listed under
// APPLIES_AT_ONCE whatever its group, and one the portal doesn't know yet under OTHER, so none is hidden.
export const SETTING_GROUPS: readonly SettingGroup[] = [
  { title: 'Trust Score pillar weights', keys: ['pillar_weight_identity', 'pillar_weight_relationship', 'pillar_weight_activity', 'pillar_weight_financial'] },
  {
    title: 'Trust Score benchmarks',
    keys: ['benchmark_account_age_days', 'benchmark_network_size', 'benchmark_longevity_days', 'benchmark_network_value', 'benchmark_deposit_count', 'benchmark_deposit_volume', 'benchmark_lock_weeks', 'benchmark_active_weeks', 'benchmark_blocks_staked', 'benchmark_lp_held', 'benchmark_loans_taken']
  },
  {
    title: 'Trust Score activity',
    keys: ['deposit_period_days', 'activity_period_days', 'min_deposit_usdt', 'min_lock_blocks', 'lp_average_days', 'no_history_score', 'max_activity_bonus', 'target_qualified_transactions', 'qualified_txn_period_days', 'min_qualified_txn_blocks', 'min_qualified_txn_usdt']
  },
  {
    title: 'Relationship weights',
    keys: ['weight_mutual_trust', 'weight_trust', 'weight_connection', 'weight_referral', 'weight_mutual_trust_pending', 'weight_trust_pending', 'weight_connection_pending', 'weight_referral_pending', 'weight_mutual_trust_rejected', 'weight_trust_rejected', 'weight_connection_rejected', 'weight_referral_rejected']
  },
  {
    title: 'Pricing inputs',
    keys: ['base_default_rate', 'base_default_rate_calculated', 'recovery_rate', 'recovery_rate_calculated', 'liquidity_ratio', 'liquidity_ratio_calculated', 'book_ratio_target', 'target_utilization']
  },
  { title: 'Operating fee', keys: ['operating_fee_rate', 'operating_fee_min_usd', 'operating_fee_max_usd'] },
  { title: 'Quotes and tenures', keys: ['quote_validity_seconds', 'min_tenure_months', 'max_tenure_months', 'tenure_step_months', 'max_guarantee_decimals'] },
  { title: 'Haircuts', keys: ['blocks_haircut', 'kes_deposit_haircut', 'vault_savings_haircut'] },
  { title: 'Claims', keys: ['claim_waiting_days', 'claim_grace_days'] },
  { title: 'Pool upkeep and alerts', keys: ['factor_refresh_seconds', 'pool_wallet_watch_days', 'alert_reader_failures', 'alert_refund_count', 'alert_refund_window_hours', 'alert_refund_held_hours'] }
];

export const APPLIES_AT_ONCE = 'Applies at once';
export const OTHER = 'Other settings';

export const PILLAR_WEIGHTS = SETTING_GROUPS[0]!.keys;

interface Keyed {
  key?: string;
  type?: string;
}

/** The settings in their groups, in order; groups with none are left out. */
export function groupSettings<T extends Keyed>(settings: readonly T[]): { title: string; settings: T[] }[] {
  const byKey = new Map(settings.map((s) => [s.key, s]));
  const placed = new Set<string | undefined>();
  const groups = SETTING_GROUPS.map((g) => ({
    title: g.title,
    settings: g.keys.flatMap((k) => {
      const s = byKey.get(k);
      if (!s || s.type === 'dynamic') return [];
      placed.add(k);
      return [s];
    })
  }));
  const atOnce = settings.filter((s) => s.type === 'dynamic');
  atOnce.forEach((s) => placed.add(s.key));
  const other = settings.filter((s) => !placed.has(s.key));
  return [...groups, { title: APPLIES_AT_ONCE, settings: atOnce }, { title: OTHER, settings: other }].filter((g) => g.settings.length);
}

/** BDR, RR and LR each switch once, from their setting to the calculated value (BlockCoop 3.4.3). */
export const isToggle = (key: string | undefined) => !!key?.endsWith('_calculated');

/** A setting's value as entered, in full: "0.485", "86,400"; a switch reads "1 (on)" or "0 (off)". */
export function settingValue(key: string | undefined, value: number | string | null | undefined): string {
  const n = formatNumber(value);
  if (!isToggle(key) || n === '—') return n;
  return Number(value) === 0 ? '0 (off)' : `${n} (on)`;
}

const plain = (v: number | string) => formatNumber(v).replace(/,/g, '');

/**
 * A typed value as the number to send, or a message. The backend checks each setting's own range; this only
 * refuses what isn't a plain number, or has more digits than a number sent as JSON keeps exactly.
 */
export function readValue(text: string): { value: number } | { error: string } {
  const t = text.trim();
  if (!t) return { error: 'Enter the new value.' };
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return { error: 'Enter a number of 0 or more, such as 0.25, with no units or commas.' };
  const value = Number(t);
  if (plain(value) !== plain(t)) return { error: 'That has more digits than can be sent exactly. Use 15 significant digits or fewer.' };
  return { value };
}

/** Whether two values are the same number: 0.10 and 0.1 are. */
export const sameValue = (a: number | string | null | undefined, b: number | string | null | undefined) =>
  a !== null && a !== undefined && b !== null && b !== undefined && plain(a) === plain(b);

// 18 decimals, the most the backend keeps
const SCALE = 18;

function scaled(v: number | string): bigint {
  const [int = '0', frac = ''] = plain(v).split('.');
  return BigInt(int + frac.padEnd(SCALE, '0').slice(0, SCALE));
}

/** The total of decimal values, worked out on their digits so 0.15 + 0.25 + 0.25 + 0.35 is exactly 1. */
export function sumValues(values: readonly (number | string)[]): string {
  const total = values.reduce((sum, v) => sum + scaled(v), 0n).toString().padStart(SCALE + 1, '0');
  const int = total.slice(0, -SCALE);
  const frac = total.slice(-SCALE).replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}

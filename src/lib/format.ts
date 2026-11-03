import { env } from './env';

// D-002: every date and time in Nairobi time, whatever the browser is set to.

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const dateFmt = () => new Intl.DateTimeFormat('en-GB', { timeZone: env.timeZone, day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = () => new Intl.DateTimeFormat('en-GB', { timeZone: env.timeZone, hour: '2-digit', minute: '2-digit', hour12: false });

/** The zone's short label: "EAT" for Nairobi, otherwise what the browser calls it. */
export function zoneLabel(): string {
  if (env.timeZone === 'Africa/Nairobi') return 'EAT';
  const part = new Intl.DateTimeFormat('en-GB', { timeZone: env.timeZone, timeZoneName: 'short' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? env.timeZone;
}

/** "2 Nov 2026", or "—" when there is no date. */
export function formatDate(value: DateInput): string {
  const d = toDate(value);
  return d ? dateFmt().format(d) : '—';
}

/** "2 Nov 2026, 14:05", with " EAT" added when zone is true. */
export function formatDateTime(value: DateInput, { zone = false } = {}): string {
  const d = toDate(value);
  if (!d) return '—';
  const text = `${dateFmt().format(d)}, ${timeFmt().format(d)}`;
  return zone ? `${text} ${zoneLabel()}` : text;
}

/** The day an instant falls on in the zone, as a date input holds it: "2026-11-03". */
export function dayInZone(value: DateInput = new Date()): string {
  const d = toDate(value);
  if (!d) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: env.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** The instant a day ("2026-11-03") starts in the zone, as an ISO string. */
export function startOfDay(day: string): string {
  const utc = new Date(`${day}T00:00:00Z`);
  // the zone's offset then: its clock reading at that instant, less UTC's
  const shown: Record<string, number> = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: env.timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(utc)
      .map((p) => [p.type, Number(p.value)])
  );
  const at = (t: string) => shown[t] ?? 0;
  const offset = Date.UTC(at('year'), at('month') - 1, at('day'), at('hour'), at('minute'), at('second')) - utc.getTime();
  return new Date(utc.getTime() - offset).toISOString();
}

// Amounts are handled as decimal strings, so a full-precision figure is never passed through a float.

type Amount = string | number | null | undefined;

function parts(value: Amount): { neg: boolean; int: string; frac: string } | null {
  if (value === null || value === undefined || value === '') return null;
  const s = typeof value === 'number' ? numberToPlain(value) : value.trim();
  const m = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (!m[2] && !m[3])) return null;
  return { neg: m[1] === '-', int: (m[2] || '0').replace(/^0+(?=\d)/, ''), frac: m[3] ?? '' };
}

function numberToPlain(n: number): string {
  if (!Number.isFinite(n)) return '';
  const s = String(n);
  if (!/e/i.test(s)) return s;
  // toFixed also switches to exponent form from 1e21, where every digit is whole anyway
  if (Math.abs(n) >= 1e21) return BigInt(n).toString();
  return n.toFixed(20).replace(/\.?0+$/, '');
}

function group(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Rounds half away from zero to `dp` decimals, on the digits themselves. */
function round(int: string, frac: string, dp: number): { int: string; frac: string } {
  if (frac.length <= dp) return { int, frac: frac.padEnd(dp, '0') };
  const keep = int + frac.slice(0, dp);
  const up = Number(frac[dp]) >= 5;
  let digits = keep;
  if (up) {
    const arr = keep.split('');
    let i = arr.length - 1;
    while (i >= 0) {
      if (arr[i] === '9') { arr[i] = '0'; i--; } else { arr[i] = String(Number(arr[i]) + 1); break; }
    }
    digits = (i < 0 ? '1' : '') + arr.join('');
  }
  const cut = digits.length - dp;
  return { int: digits.slice(0, cut) || '0', frac: digits.slice(cut) };
}

/**
 * A plain number with thousands separators. `dp` rounds to that many decimals;
 * without it the value is shown in full, trailing zeros dropped.
 */
export function formatNumber(value: Amount, dp?: number): string {
  const p = parts(value);
  if (!p) return '—';
  let { int, frac } = p;
  if (dp !== undefined) ({ int, frac } = round(int, frac, dp));
  else frac = frac.replace(/0+$/, '');
  const zero = /^0*$/.test(int + frac);
  const sign = p.neg && !zero ? '-' : '';
  return sign + group(int) + (frac ? '.' + frac : '');
}

export type Asset = 'USDT' | 'KES' | 'BLOCKS';

/**
 * D-002: 2 decimals in lists and cards; `full` for detail views and anything entered for approval,
 * so a payout is never approved from a rounded figure.
 */
export function formatAmount(value: Amount, asset: Asset, { full = false } = {}): string {
  const n = full ? formatNumber(value) : formatNumber(value, 2);
  if (n === '—') return n;
  // full precision still shows cents: 14.4 reads 14.40, and nothing is rounded away
  if (full && asset === 'USDT') {
    const decimals = n.split('.')[1]?.length ?? 0;
    if (decimals < 2) return `${n}${decimals ? '' : '.'}${'0'.repeat(2 - decimals)} ${asset}`;
  }
  return `${n} ${asset}`;
}

export const formatUsdt = (value: Amount, opts?: { full?: boolean }) => formatAmount(value, 'USDT', opts);

/** An amount in the currency it's held in; one the portal doesn't know is shown as a plain number and its code. */
export function formatIn(value: Amount, currency: string | null | undefined, opts?: { full?: boolean }): string {
  if (currency === 'USDT' || currency === 'KES' || currency === 'BLOCKS') return formatAmount(value, currency, opts);
  return `${opts?.full ? formatNumber(value) : formatNumber(value, 2)} ${currency ?? ''}`.trim();
}

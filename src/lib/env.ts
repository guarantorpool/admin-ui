// Settings from .env (see .env.example). VITE_ values are built into the bundle and are not secret.

const raw = import.meta.env;

function minutes(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** The env badge's text: the value with a capital first letter, "Unknown" when unset, and none for prod. */
export function envBadge(value: string | undefined): string | null {
  const v = (value ?? '').trim();
  if (v === 'prod') return null;
  if (!v) return 'Unknown';
  return v.charAt(0).toUpperCase() + v.slice(1);
}

export const env = {
  apiBaseUrl: (raw.VITE_API_BASE_URL || 'http://localhost:8080/api').replace(/\/+$/, ''),
  idleLockMinutes: minutes(raw.VITE_IDLE_LOCK_MINUTES, 5),
  timeZone: raw.VITE_TIME_ZONE || 'Africa/Nairobi',
  badge: envBadge(raw.VITE_APP_ENV)
};

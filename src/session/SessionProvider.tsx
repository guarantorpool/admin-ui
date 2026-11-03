import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as store from './store';
import type { Grants } from '@/lib/permissions';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'] as const;
const CHECK_EVERY_MS = 15_000;

/**
 * Keeps React in step with the session store, records activity, and locks every tab after the idle
 * time (D-001). A tab opened after that time has passed starts locked.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const state = React.useSyncExternalStore(store.subscribe, store.getState);
  const signedIn = state.status === 'signedIn';
  const accountId = state.session?.accountId ?? null;
  const queryClient = useQueryClient();

  // nothing read for one admin is shown to the next one to sign in on this browser
  React.useEffect(() => {
    if (!accountId) queryClient.clear();
  }, [accountId, queryClient]);

  React.useEffect(() => {
    window.addEventListener('storage', store.onStorage);
    return () => window.removeEventListener('storage', store.onStorage);
  }, []);

  React.useEffect(() => {
    if (!signedIn) return;
    const check = () => {
      if (store.isIdle()) void store.lock();
    };
    check();
    const onActivity = () => store.markActivity();
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    // timers slow down in background tabs, so check again when a tab comes back into view
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(timer);
    };
  }, [signedIn]);

  return <>{children}</>;
}

export function useSession(): store.SessionState {
  return React.useSyncExternalStore(store.subscribe, store.getState);
}

/** The signed-in admin's role and permissions, for hiding what their role can't do. */
export function useGrants(): Grants | null {
  const { session } = useSession();
  return React.useMemo(() => (session ? { role: session.role, permissions: session.permissions } : null), [session]);
}

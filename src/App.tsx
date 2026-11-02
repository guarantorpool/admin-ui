import { Navigate, Outlet, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { AppShell } from '@/components/shell/AppShell';
import { allScreens, homePath, safeNext } from '@/components/shell/nav';
import { Account } from '@/pages/Account';
import { ForgotPassword, ResetPassword, SetPassword } from '@/pages/auth/PasswordPages';
import { SignIn } from '@/pages/auth/SignIn';
import { KycPage } from '@/pages/kyc/KycPage';
import { MembersPage } from '@/pages/members/MembersPage';
import { ComingSoon, NotFound } from '@/pages/Placeholders';
import { useGrants, useSession } from '@/session/SessionProvider';

/**
 * Screens that need a session. Signed out: go to sign-in, coming back here after. Locked (D-001): the
 * lock screen shows in place of the page, so the address is kept and signing in carries on here.
 */
function RequireSession() {
  const state = useSession();
  const location = useLocation();
  if (state.status === 'locked') return <SignIn locked={state.locked} />;
  if (state.status === 'signedOut') {
    const next = location.pathname + location.search;
    return <Navigate to={`/sign-in?next=${encodeURIComponent(next)}`} replace />;
  }
  return <Outlet />;
}

/** Sign-in pages: a signed-in admin is sent on to the page they came for, or their first screen. */
function SignedOutOnly() {
  const state = useSession();
  const grants = useGrants();
  const [params] = useSearchParams();
  if (state.status === 'signedIn') return <Navigate to={safeNext(params.get('next')) ?? homePath(grants)} replace />;
  if (state.status === 'locked') return <SignIn locked={state.locked} />;
  return <Outlet />;
}

function Home() {
  const grants = useGrants();
  return <Navigate to={homePath(grants)} replace />;
}

export function App() {
  return (
    <Routes>
      <Route element={<SignedOutOnly />}>
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
      </Route>
      {/* emailed links open whatever the session, so a signed-in admin can still accept an invitation link */}
      <Route path="/set-password" element={<SetPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<RequireSession />}>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="/account" element={<Account />} />
          <Route path="/members" element={<MembersPage />} />
          <Route path="/members/:memberId" element={<MembersPage />} />
          <Route path="/kyc" element={<KycPage />} />
          <Route path="/kyc/address" element={<KycPage />} />
          <Route path="/kyc/address/:memberId" element={<KycPage />} />
          <Route path="/kyc/:memberId" element={<KycPage />} />
          {allScreens()
            .filter((s) => s.comingIn)
            .map((s) => (
              <Route key={s.path} path={s.path} element={<ComingSoon />} />
            ))}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}

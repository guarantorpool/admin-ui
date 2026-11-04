import { Navigate, Outlet, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { AppShell } from '@/components/shell/AppShell';
import { allScreens, homePath, safeNext } from '@/components/shell/nav';
import { Account } from '@/pages/Account';
import { ActivityPage } from '@/pages/activity/ActivityPage';
import { AdminsPage } from '@/pages/admins/AdminsPage';
import { AuditPage } from '@/pages/audit/AuditPage';
import { AlertsPage } from '@/pages/alerts/AlertsPage';
import { ApprovalsPage } from '@/pages/approvals/ApprovalsPage';
import { BackingPage } from '@/pages/backing/BackingPage';
import { ForgotPassword, ResetPassword, SetPassword } from '@/pages/auth/PasswordPages';
import { SignIn } from '@/pages/auth/SignIn';
import { GuaranteesPage } from '@/pages/guarantees/GuaranteesPage';
import { KycPage } from '@/pages/kyc/KycPage';
import { KycKeyPage } from '@/pages/kycKey/KycKeyPage';
import { ClaimsPage } from '@/pages/loans/ClaimsPage';
import { LoansPage } from '@/pages/loans/LoansPage';
import { MembersPage } from '@/pages/members/MembersPage';
import { ComingSoon, NotFound } from '@/pages/Placeholders';
import { PoolHealthPage } from '@/pages/pool/PoolHealthPage';
import { PoolSettingsPage } from '@/pages/pool/PoolSettingsPage';
import { PoolWalletsPage } from '@/pages/pool/PoolWalletsPage';
import { PaymentsPage } from '@/pages/payments/PaymentsPage';
import { RefundsPage } from '@/pages/refunds/RefundsPage';
import { ServiceKeysPage } from '@/pages/serviceKeys/ServiceKeysPage';
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
          <Route path="/approvals" element={<ApprovalsPage />} />
          <Route path="/approvals/:kind/:itemId" element={<ApprovalsPage />} />
          <Route path="/alerts/:alertId?" element={<AlertsPage />} />
          <Route path="/members" element={<MembersPage />} />
          <Route path="/members/:memberId" element={<MembersPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/kyc" element={<KycPage />} />
          <Route path="/kyc/address" element={<KycPage />} />
          <Route path="/kyc/address/:memberId" element={<KycPage />} />
          <Route path="/kyc/:memberId" element={<KycPage />} />
          <Route path="/guarantees" element={<GuaranteesPage />} />
          <Route path="/guarantees/quotes" element={<GuaranteesPage />} />
          <Route path="/guarantees/quotes/:quoteId" element={<GuaranteesPage />} />
          <Route path="/guarantees/:guaranteeId" element={<GuaranteesPage />} />
          <Route path="/loans" element={<LoansPage />} />
          <Route path="/loans/:loanId" element={<LoansPage />} />
          <Route path="/claims" element={<ClaimsPage />} />
          <Route path="/claims/:loanId" element={<ClaimsPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/payments/:guaranteeId/:paymentId" element={<PaymentsPage />} />
          <Route path="/refunds" element={<RefundsPage />} />
          <Route path="/refunds/:refundId" element={<RefundsPage />} />
          <Route path="/pool/health" element={<PoolHealthPage />} />
          <Route path="/pool/wallets" element={<PoolWalletsPage />} />
          <Route path="/pool/wallets/:walletId" element={<PoolWalletsPage />} />
          {/* one route, so opening and closing a setting keeps each card on its page */}
          <Route path="/pool/settings/:key?" element={<PoolSettingsPage />} />
          <Route path="/backing" element={<BackingPage />} />
          <Route path="/backing/:memberId" element={<BackingPage />} />
          <Route path="/admins" element={<AdminsPage />} />
          <Route path="/admins/roles/:roleId?" element={<AdminsPage />} />
          <Route path="/service-keys" element={<ServiceKeysPage />} />
          <Route path="/kyc-key" element={<KycKeyPage />} />
          <Route path="/audit" element={<AuditPage />} />
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

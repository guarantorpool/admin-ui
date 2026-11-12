import * as React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { adminLogin, resendOtp, verifyOtp } from '@/api/auth';
import { errorMessage } from '@/api/errors';
import type { OtpChallenge } from '@/api/types';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { OtpInput } from '@/components/ui/input-otp';
import { env } from '@/lib/env';
import * as store from '@/session/store';
import { AuthLayout } from './AuthLayout';
import { useCountdown } from './useCountdown';

/**
 * Sign-in in two steps: email and password, then the one-time code (BlockCoop D-009).
 * With `locked` it is the lock screen (D-001): the email is filled in, and signing in returns every tab to its
 * page, because this renders in place of the page without changing the address. The email stays editable:
 * signing in with a different one forgets the lock, and that admin starts on their own first screen.
 */
export function SignIn({ locked }: { locked?: store.Locked }) {
  const navigate = useNavigate();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice ?? store.signOutNotice();

  const [email, setEmail] = React.useState(locked?.email ?? '');
  const [password, setPassword] = React.useState('');
  const [challenge, setChallenge] = React.useState<OtpChallenge | null>(null);
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [resent, setResent] = React.useState(false);
  const resendIn = useCountdown(challenge?.resendAvailableInSeconds ?? 0, challenge);
  const codeRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (challenge) codeRef.current?.focus();
  }, [challenge]);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      setChallenge(await adminLogin(email.trim(), password));
      setCode('');
      setResent(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (value = code) => {
    if (!challenge?.challengeId || value.length !== 6 || busy) return;
    setError('');
    setBusy(true);
    try {
      const res = await verifyOtp(challenge.challengeId, value);
      if (!res.profile) throw new Error('The GP API returned no session.');
      if (store.isOtherAdmin(locked, email)) {
        // someone else is signing in on the lock screen: the locked admin's page (and `next`) is not theirs.
        // Both changes render together, so the lock screen stays until the new session opens their home.
        navigate('/', { replace: true });
        store.forgetLocked();
      }
      // The routes take it from here: the sign-in page goes on to `next` or the first screen, and a
      // locked page renders again where it was.
      store.signedIn(res.profile);
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!challenge?.challengeId) return;
    setError('');
    try {
      setChallenge(await resendOtp(challenge.challengeId));
      setResent(true);
      setCode('');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const someoneElse = () => {
    store.forgetLocked();
    navigate('/sign-in', { replace: true });
  };

  if (challenge) {
    return (
      <AuthLayout>
        <form
          className="flex flex-col gap-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            void submitCode();
          }}
        >
          <h1 className="m-0 text-xl font-bold">Enter your one-time code</h1>
          <p className="m-0 text-muted">
            We sent a 6-digit code to {challenge.maskedDestination || 'your admin email'}. It works for{' '}
            {Math.max(1, Math.round((challenge.expiresInSeconds ?? 300) / 60))} minutes.
          </p>
          <Field id="code" label="One-time code">
            <OtpInput id="code" ref={codeRef} value={code} onChange={setCode} onComplete={(v) => void submitCode(v)} disabled={busy} />
          </Field>
          {resent && !error ? <Banner tone="ok">New code sent.</Banner> : null}
          {error ? <Banner tone="bad">{error}</Banner> : null}
          <Button type="submit" disabled={busy || code.length !== 6}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          <Button type="button" variant="outline" onClick={() => void resend()} disabled={resendIn > 0}>
            {resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'}
          </Button>
          <Button type="button" variant="link" className="self-start" onClick={() => { setChallenge(null); setPassword(''); setError(''); }}>
            Use a different password or email
          </Button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form className="flex flex-col gap-3.5" onSubmit={(e) => void submitPassword(e)}>
        <h1 className="m-0 text-xl font-bold">{locked ? 'Your session was locked' : 'Sign in'}</h1>
        {locked ? (
          <p className="m-0 text-muted">
            No activity for {env.idleLockMinutes} minutes, so every tab was signed out. Sign in again to carry on where you left off.
          </p>
        ) : null}
        {notice && !locked ? <Banner tone="ok">{notice}</Banner> : null}
        <Field id="email" label="Email">
          <Input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus={!locked}
          />
        </Field>
        <Field id="password" label="Password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus={!!locked}
          />
        </Field>
        {error ? <Banner tone="bad">{error}</Banner> : null}
        <Button type="submit" disabled={busy}>
          {busy ? 'Checking…' : 'Continue'}
        </Button>
        {locked ? (
          <Button type="button" variant="outline" onClick={someoneElse}>
            Sign in as someone else
          </Button>
        ) : null}
        <Link to="/forgot-password" className="self-start font-medium text-ink-strong underline-offset-4 hover:underline">
          Forgot password
        </Link>
      </form>
    </AuthLayout>
  );
}

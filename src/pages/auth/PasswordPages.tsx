import * as React from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { forgotPassword, resetPassword, setPassword } from '@/api/auth';
import { errorMessage } from '@/api/errors';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { OtpInput } from '@/components/ui/input-otp';
import { checkNewPassword, PASSWORD_RULES } from '@/lib/password';
import { AuthLayout } from './AuthLayout';
import { useCountdown } from './useCountdown';

const backLink = (
  <Link to="/sign-in" className="self-start font-medium text-ink-strong underline-offset-4 hover:underline">
    Back to sign in
  </Link>
);

const RESET_DONE = 'Your password was changed. Sign in with the new one.';

/** What the reset code step is handed by the email step: the backend's timings for the code just sent. */
interface CodeSent {
  expiresInSeconds?: number;
  resendAvailableInSeconds?: number;
}

/** The new password and its confirmation, with the backend's rule as the hint. */
function NewPasswordFields({ next, again, setNext, setAgain, autoFocus }: { next: string; again: string; setNext: (v: string) => void; setAgain: (v: string) => void; autoFocus?: boolean }) {
  return (
    <>
      <Field id="new" label="New password" hint={`At least: ${PASSWORD_RULES.map((r) => r.label).join(', ')}.`}>
        <Input id="new" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} aria-describedby="new-hint" autoFocus={autoFocus} />
      </Field>
      <Field id="again" label="New password again">
        <Input id="again" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
      </Field>
    </>
  );
}

/** Forgot password, step 1: the email to send a reset code to. Step 2 is `/reset-password?email=`. */
export function ForgotPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = React.useState(params.get('email') ?? '');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const to = email.trim();
      const sent = await forgotPassword(to);
      navigate(`/reset-password?email=${encodeURIComponent(to)}`, {
        state: { expiresInSeconds: sent.expiresInSeconds, resendAvailableInSeconds: sent.resendAvailableInSeconds } satisfies CodeSent
      });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <form className="flex flex-col gap-3.5" onSubmit={(e) => void submit(e)}>
        <h1 className="m-0 text-xl font-bold">Forgot password</h1>
        <p className="m-0 text-muted">We will email you a 6-digit code to set a new password.</p>
        <Field id="email" label="Email">
          <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        {error ? <Banner tone="bad">{error}</Banner> : null}
        <Button type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Email me a code'}
        </Button>
        {backLink}
      </form>
    </AuthLayout>
  );
}

/**
 * Forgot password, step 2: the emailed code and the new password on one page, with a new code once the
 * resend wait is over. The email comes from `?email=`, so reloading keeps the step.
 */
export function ResetPassword() {
  const [params] = useSearchParams();
  const email = params.get('email')?.trim() ?? '';
  const location = useLocation();
  const navigate = useNavigate();
  const [sent, setSent] = React.useState<CodeSent>(() => (location.state as CodeSent | null) ?? {});
  const [code, setCode] = React.useState('');
  const [next, setNext] = React.useState('');
  const [again, setAgain] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [resent, setResent] = React.useState(false);
  const [resending, setResending] = React.useState(false);
  const resendIn = useCountdown(sent.resendAvailableInSeconds ?? 0, sent);
  const codeRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    codeRef.current?.focus();
  }, [sent]);

  // without an email (an old reset link, or a typed address) there is no code to check: start again
  if (!email) return <Navigate to="/forgot-password" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) {
      setError('Enter the 6-digit code from the email.');
      return;
    }
    const problem = checkNewPassword(next, again);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setBusy(true);
    try {
      await resetPassword(email, code, next);
      navigate('/sign-in', { replace: true, state: { notice: RESET_DONE } });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const resend = async () => {
    if (resending) return;
    setError('');
    setResent(false);
    setResending(true);
    try {
      const fresh = await forgotPassword(email);
      setSent({ expiresInSeconds: fresh.expiresInSeconds, resendAvailableInSeconds: fresh.resendAvailableInSeconds });
      setResent(true);
      setCode('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setResending(false);
    }
  };

  const minutes = Math.max(1, Math.round((sent.expiresInSeconds ?? 600) / 60));

  return (
    <AuthLayout>
      <form className="flex flex-col gap-3.5" onSubmit={(e) => void submit(e)}>
        <h1 className="m-0 text-xl font-bold">Set a new password</h1>
        {/* the backend answers the same whether or not the account exists, so this does too */}
        <p className="m-0 text-muted">
          If {email} belongs to an admin, a 6-digit code is on its way. It works for {minutes} minutes. Choose a new password; every session signed in with the old one ends.
        </p>
        <Field id="code" label="Reset code">
          <OtpInput id="code" ref={codeRef} value={code} onChange={setCode} disabled={busy} />
        </Field>
        <NewPasswordFields next={next} again={again} setNext={setNext} setAgain={setAgain} />
        {resent && !error ? <Banner tone="ok">New code sent.</Banner> : null}
        {error ? <Banner tone="bad">{error}</Banner> : null}
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Change the password'}
        </Button>
        <Button type="button" variant="outline" onClick={() => void resend()} disabled={resendIn > 0 || busy || resending}>
          {resending ? 'Sending…' : resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'}
        </Button>
        <Link to={`/forgot-password?email=${encodeURIComponent(email)}`} className="self-start font-medium text-ink-strong underline-offset-4 hover:underline">
          Use a different email
        </Link>
        {backLink}
      </form>
    </AuthLayout>
  );
}

/** A new admin chooses their first password from the invitation link (`/set-password?token=`). */
export function SetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [next, setNext] = React.useState('');
  const [again, setAgain] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = checkNewPassword(next, again);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setBusy(true);
    try {
      await setPassword(token, next);
      navigate('/sign-in', { replace: true, state: { notice: 'Your password is set. Sign in to finish.' } });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <AuthLayout>
        <h1 className="m-0 text-xl font-bold">Set your first password</h1>
        <Banner tone="bad">This link is incomplete. Open the link from the invitation email again, or ask for a new invitation.</Banner>
        {backLink}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form className="flex flex-col gap-3.5" onSubmit={(e) => void submit(e)}>
        <h1 className="m-0 text-xl font-bold">Set your first password</h1>
        <p className="m-0 text-muted">You were invited to BlockCoop Guarantor Pool Admin. Choose a password to finish setting up your account.</p>
        <NewPasswordFields next={next} again={again} setNext={setNext} setAgain={setAgain} autoFocus />
        {error ? <Banner tone="bad">{error}</Banner> : null}
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Set the password'}
        </Button>
        {backLink}
      </form>
    </AuthLayout>
  );
}

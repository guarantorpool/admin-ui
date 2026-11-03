import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { forgotPassword, resetPassword, setPassword } from '@/api/auth';
import { errorMessage } from '@/api/errors';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { checkNewPassword, PASSWORD_RULES } from '@/lib/password';
import { AuthLayout } from './AuthLayout';

const backLink = (
  <Link to="/sign-in" className="self-start font-medium text-ink-strong underline-offset-4 hover:underline">
    Back to sign in
  </Link>
);

export function ForgotPassword() {
  const [email, setEmail] = React.useState('');
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <form className="flex flex-col gap-3.5" onSubmit={(e) => void submit(e)}>
        <h1 className="m-0 text-xl font-bold">Forgot password</h1>
        {sent ? (
          // the backend answers the same whether or not the account exists, so this does too
          <Banner tone="ok">If {email.trim()} belongs to an admin, a link to set a new password is on its way. It works for a limited time.</Banner>
        ) : (
          <>
            <p className="m-0 text-muted">We will email you a link to set a new password.</p>
            <Field id="email" label="Email">
              <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </Field>
            {error ? <Banner tone="bad">{error}</Banner> : null}
            <Button type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Email the link'}
            </Button>
          </>
        )}
        {backLink}
      </form>
    </AuthLayout>
  );
}

/**
 * Choosing a password from an emailed link: the invitation (`/set-password`) and the reset
 * (`/reset-password`) work the same way, with the token from the link.
 */
function NewPasswordPage({ kind }: { kind: 'invite' | 'reset' }) {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [next, setNext] = React.useState('');
  const [again, setAgain] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const invite = kind === 'invite';

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
      await (invite ? setPassword : resetPassword)(token, next);
      navigate('/sign-in', { replace: true, state: { notice: invite ? 'Your password is set. Sign in to finish.' : 'Your password was changed. Sign in with the new one.' } });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <AuthLayout>
        <h1 className="m-0 text-xl font-bold">{invite ? 'Set your first password' : 'Set a new password'}</h1>
        <Banner tone="bad">This link is incomplete. Open the link from the email again, or ask for a new one.</Banner>
        {backLink}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form className="flex flex-col gap-3.5" onSubmit={(e) => void submit(e)}>
        <h1 className="m-0 text-xl font-bold">{invite ? 'Set your first password' : 'Set a new password'}</h1>
        <p className="m-0 text-muted">
          {invite
            ? 'You were invited to BlockCoop Guarantor Pool Admin. Choose a password to finish setting up your account.'
            : 'Choose a new password. Every session signed in with the old one ends.'}
        </p>
        <Field id="new" label="New password" hint={`At least: ${PASSWORD_RULES.map((r) => r.label).join(', ')}.`}>
          <Input id="new" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} aria-describedby="new-hint" autoFocus />
        </Field>
        <Field id="again" label="New password again">
          <Input id="again" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
        </Field>
        {error ? <Banner tone="bad">{error}</Banner> : null}
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : invite ? 'Set the password' : 'Change the password'}
        </Button>
        {backLink}
      </form>
    </AuthLayout>
  );
}

export const SetPassword = () => <NewPasswordPage kind="invite" />;
export const ResetPassword = () => <NewPasswordPage kind="reset" />;

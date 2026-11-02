import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { changePassword, deleteProfileImage, getProfile, logoutAll, updateProfile, uploadProfileImage } from '@/api/auth';
import { errorMessage } from '@/api/errors';
import type { Account as AccountData } from '@/api/types';
import { PageHeader } from '@/components/shell/AppShell';
import { Avatar, initials } from '@/components/ui/avatar';
import { Badge, Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, Lines } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { formatDateTime } from '@/lib/format';
import { fullName } from '@/lib/names';
import { roleLabel } from '@/lib/permissions';
import { checkNewPassword, PASSWORD_RULES } from '@/lib/password';
import { useSession } from '@/session/SessionProvider';
import * as store from '@/session/store';

const PHONE = /^\+?(?:254|0)([17]\d{8})$/;
const NAME = /^[\p{L} .'-]+$/u;
const IMAGE_TYPES = 'image/jpeg,image/png,image/gif,image/webp';

const TABS = [
  { value: 'profile', label: 'Profile' },
  { value: 'security', label: 'Password and sessions' }
] as const;

function EditProfile({ account, open, onOpenChange }: { account: AccountData; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [first, setFirst] = React.useState(account.firstName ?? '');
  const [last, setLast] = React.useState(account.lastName ?? '');
  const [phone, setPhone] = React.useState(account.phoneNumber ?? '');
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setFirst(account.firstName ?? '');
      setLast(account.lastName ?? '');
      setPhone(account.phoneNumber ?? '');
      setError('');
    }
  }, [open, account]);

  const save = useMutation({
    mutationFn: () => updateProfile({ firstName: first.trim(), lastName: last.trim(), ...(phone.trim() ? { phoneNumber: phone.trim() } : {}) }),
    onSuccess: (updated) => {
      qc.setQueryData(['profile'], updated);
      store.updateProfile({ firstName: updated.firstName ?? '', lastName: updated.lastName ?? '' });
      toast.success('Your details were saved.');
      onOpenChange(false);
    },
    onError: (err) => setError(errorMessage(err))
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!NAME.test(first.trim()) || !NAME.test(last.trim())) return setError('Names can only have letters, spaces, dots, apostrophes and hyphens.');
    if (phone.trim() && !PHONE.test(phone.trim())) return setError('Enter a Kenyan mobile number, such as 0712345678 or +254712345678.');
    setError('');
    save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Update your details</DialogTitle>
        <form className="flex flex-col gap-3.5" onSubmit={submit}>
          <Field id="first" label="First name">
            <Input id="first" required maxLength={100} value={first} onChange={(e) => setFirst(e.target.value)} />
          </Field>
          <Field id="last" label="Last name">
            <Input id="last" required maxLength={100} value={last} onChange={(e) => setLast(e.target.value)} />
          </Field>
          <Field id="phone" label="Phone number">
            <Input id="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          {error ? <Banner tone="bad">{error}</Banner> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProfileTab({ account }: { account: AccountData }) {
  const qc = useQueryClient();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [editing, setEditing] = React.useState(false);

  const afterImage = (updated: AccountData | undefined, picUrl: string | null) => {
    if (updated) qc.setQueryData(['profile'], updated);
    else void qc.invalidateQueries({ queryKey: ['profile'] });
    store.updateProfile({ picUrl });
  };

  const upload = useMutation({
    mutationFn: (file: File) => uploadProfileImage(file),
    onSuccess: (updated) => {
      afterImage(updated, updated.picUrl ?? null);
      toast.success('Your profile image was uploaded.');
    },
    onError: (err) => toast.error(errorMessage(err))
  });

  const remove = useMutation({
    mutationFn: () => deleteProfileImage(account.id ?? ''),
    onSuccess: () => {
      afterImage(undefined, null);
      toast.success('Your profile image was removed.');
    },
    onError: (err) => toast.error(errorMessage(err))
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[5fr_7fr]">
      <Card>
        <CardHeader title="Profile image" />
        <div className="flex items-center gap-4">
          <Avatar src={account.picUrl} text={initials(account.firstName, account.lastName, account.email)} className="size-16 text-lg" />
          <p className="m-0 text-muted">{account.picUrl ? 'Shown in the top bar.' : 'Your initials show until you upload one.'}</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_TYPES}
          className="sr-only"
          aria-label="Choose a profile image"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) upload.mutate(f);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? 'Uploading…' : account.picUrl ? 'Replace' : 'Upload'}
          </Button>
          {account.picUrl ? (
            <Button variant="danger-outline" onClick={() => remove.mutate()} disabled={remove.isPending}>
              Remove
            </Button>
          ) : null}
        </div>
      </Card>
      <Card>
        <CardHeader title="Your details" actions={<Button variant="outline" onClick={() => setEditing(true)}>Update</Button>} />
        <Lines
          rows={[
            { k: 'Name', v: fullName(account) || '—' },
            { k: 'Email', v: account.email ?? '—' },
            { k: 'Phone number', v: account.phoneNumber || '—' },
            { k: 'Role', v: roleLabel(account.role?.name) },
            { k: 'Last sign-in', v: formatDateTime(account.lastLogin, { zone: true }) }
          ]}
        />
      </Card>
      <EditProfile account={account} open={editing} onOpenChange={setEditing} />
    </div>
  );
}

function ChangePassword({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [again, setAgain] = React.useState('');
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setCurrent('');
      setNext('');
      setAgain('');
      setError('');
    }
  }, [open]);

  const change = useMutation({
    mutationFn: () => changePassword(current, next),
    onSuccess: () => {
      // the backend ends every session, this one included; the page goes to sign-in and back here after
      store.clearSession('Your password was changed and every session ended. Sign in with the new password.');
    },
    onError: (err) => setError(errorMessage(err))
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const problem = checkNewPassword(next, again);
    if (problem) return setError(problem);
    setError('');
    change.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Change your password</DialogTitle>
        <DialogDescription>This signs you out everywhere, including here. Then sign in with the new password.</DialogDescription>
        <form className="flex flex-col gap-3.5" onSubmit={submit}>
          <Field id="current" label="Current password">
            <Input id="current" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field id="next" label="New password" hint={`At least: ${PASSWORD_RULES.map((r) => r.label).join(', ')}.`}>
            <Input id="next" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} aria-describedby="next-hint" />
          </Field>
          <Field id="again" label="New password again">
            <Input id="again" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
          </Field>
          {error ? <Banner tone="bad">{error}</Banner> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={change.isPending}>
              {change.isPending ? 'Changing…' : 'Change the password'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SignOutEverywhere({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [error, setError] = React.useState('');
  const run = useMutation({
    mutationFn: logoutAll,
    onSuccess: () => {
      store.clearSession('You signed out of every session.');
    },
    onError: (err) => setError(errorMessage(err))
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setError(''); onOpenChange(o); }}>
      <DialogContent>
        <DialogTitle>Sign out of every session?</DialogTitle>
        <DialogDescription>This signs you out on every device, including this one.</DialogDescription>
        {error ? <Banner tone="bad">{error}</Banner> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? 'Signing out…' : 'Sign out everywhere'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SecurityTab({ account }: { account: AccountData }) {
  const { session } = useSession();
  const [changing, setChanging] = React.useState(false);
  const [everywhere, setEverywhere] = React.useState(false);
  return (
    <div className="grid gap-4 lg:grid-cols-[5fr_7fr]">
      <Card>
        <CardHeader title="Password" actions={<Button variant="outline" onClick={() => setChanging(true)}>Change</Button>} />
        <p className="m-0 text-muted">Changing it signs you out of every session.</p>
      </Card>
      <Card>
        <CardHeader title="Sessions" actions={<Button variant="danger-outline" onClick={() => setEverywhere(true)}>Sign out of every session</Button>} />
        <Lines
          rows={[
            { k: 'This session', v: <Badge>This device</Badge> },
            { k: 'Signed in', v: formatDateTime(account.lastLogin, { zone: true }) },
            { k: 'Ends by', v: session ? formatDateTime(session.refreshTokenExpiry, { zone: true }) : '—' }
          ]}
        />
        <p className="m-0 text-[13px] text-muted">
          A list of your other signed-in devices needs a backend endpoint that doesn't exist yet.
        </p>
      </Card>
      <ChangePassword open={changing} onOpenChange={setChanging} />
      <SignOutEverywhere open={everywhere} onOpenChange={setEverywhere} />
    </div>
  );
}

export function Account() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'security' ? 'security' : 'profile';
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile });

  return (
    <>
      <PageHeader title="Your account" />
      <Tabs label="Your account" idPrefix="account" tabs={TABS} value={tab} onChange={(v) => setParams(v === 'profile' ? {} : { tab: v }, { replace: true })} />
      <TabPanel idPrefix="account" value={tab}>
        {profile.isPending ? (
          <p className="text-muted">Loading your account…</p>
        ) : profile.isError ? (
          <Banner tone="bad">{errorMessage(profile.error)}</Banner>
        ) : tab === 'profile' ? (
          <ProfileTab account={profile.data} />
        ) : (
          <SecurityTab account={profile.data} />
        )}
      </TabPanel>
    </>
  );
}

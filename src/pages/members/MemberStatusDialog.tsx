import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage } from '@/api/errors';
import { disableMember, enableMember } from '@/api/members';
import type { Account } from '@/api/types';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Lines } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { fullName } from '@/lib/names';

const REASON_MAX = 500;

/**
 * Disabling or enabling a member: one admin decides, and it takes effect at once. Disabling ends every
 * session the member has and emails them, with the reason if one is given.
 */
export function MemberStatusDialog({ member, open, onOpenChange }: { member: Account; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const enabling = member.status === 'disabled';
  const name = fullName(member) || 'this member';
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setReason('');
      setError('');
    }
  }, [open]);

  const run = useMutation({
    mutationFn: () => (enabling ? enableMember(member.id!) : disableMember(member.id!, reason.trim())),
    onSuccess: (updated) => {
      qc.setQueryData(['members', member.id], updated);
      void qc.invalidateQueries({ queryKey: ['members', 'list'] });
      toast.success(enabling ? `${name} is enabled.` : `${name} is disabled.`);
      onOpenChange(false);
    },
    onError: (err) => setError(errorMessage(err))
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="flex flex-col gap-3.5" onSubmit={submit}>
          <DialogTitle>{enabling ? `Enable ${name}?` : `Disable ${name}?`}</DialogTitle>
          <DialogDescription>
            {enabling
              ? 'The member can sign in and use the pool again.'
              : "The member is signed out everywhere now, and can't sign in or ask for new guarantees until they are enabled. They are emailed that their account was disabled, with the reason below."}
          </DialogDescription>
          <Lines rows={[{ k: 'Member number', v: member.member?.memberNumber ?? '—' }]} />
          {enabling ? null : (
            <Field id="disable-reason" label="Reason (optional)" hint={`Up to ${REASON_MAX} characters. The member sees it.`}>
              <textarea
                id="disable-reason"
                value={reason}
                maxLength={REASON_MAX}
                rows={3}
                onChange={(e) => setReason(e.target.value)}
                aria-describedby="disable-reason-hint"
                className="w-full rounded-ctl border border-ctl bg-surface px-3 py-2 text-sm text-ink"
              />
            </Field>
          )}
          {error ? <Banner tone="bad">{error}</Banner> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={enabling ? 'primary' : 'danger'} disabled={run.isPending}>
              {run.isPending ? 'Saving…' : enabling ? 'Enable' : 'Disable'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

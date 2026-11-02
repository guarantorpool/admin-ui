import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { errorMessage } from '@/api/errors';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Lines } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';

const REASON_MAX = 500;

export interface Decision {
  /** "Verify" or "Approve" to accept; "Reject" needs a reason */
  verb: string;
  reject: boolean;
  /** what's being decided, as in "Verify this KYC submission?" */
  what: string;
  rows: { k: string; v: React.ReactNode }[];
  run: (reason: string) => Promise<unknown>;
  done: () => void;
}

/** One admin decides, and it takes effect at once. A rejection's reason is shown to the member. */
export function DecisionDialog({ decision, onClose }: { decision: Decision | null; onClose: () => void }) {
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    setReason('');
    setError('');
  }, [decision]);

  const run = useMutation({
    mutationFn: () => decision!.run(reason.trim()),
    onSuccess: () => {
      decision!.done();
      onClose();
    },
    onError: (err) => setError(errorMessage(err))
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (decision?.reject && !reason.trim()) {
      setError('Give a reason. The member sees it.');
      return;
    }
    run.mutate();
  };

  return (
    <Dialog open={!!decision} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        {decision ? (
          <form className="flex flex-col gap-3.5" onSubmit={submit} noValidate>
            <DialogTitle>
              {decision.verb} {decision.what}?
            </DialogTitle>
            <DialogDescription>
              One admin decides, and it takes effect at once.{' '}
              {decision.reject ? 'The member sees the reason, and can put forward a new one.' : 'It counts towards the member’s Trust Score straight away.'}
            </DialogDescription>
            <Lines rows={decision.rows} />
            {decision.reject ? (
              <Field id="decision-reason" label="Reason" hint={`Up to ${REASON_MAX} characters. The member sees it.`}>
                <textarea
                  id="decision-reason"
                  value={reason}
                  maxLength={REASON_MAX}
                  rows={3}
                  required
                  onChange={(e) => setReason(e.target.value)}
                  aria-describedby="decision-reason-hint"
                  className="w-full rounded-ctl border border-ctl bg-surface px-3 py-2 text-sm text-ink"
                />
              </Field>
            ) : null}
            {error ? <Banner tone="bad">{error}</Banner> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant={decision.reject ? 'danger' : 'primary'} disabled={run.isPending}>
                {run.isPending ? 'Saving…' : decision.verb}
              </Button>
            </div>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

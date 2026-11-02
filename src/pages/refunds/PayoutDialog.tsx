import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage } from '@/api/errors';
import { enterPayout, type Refund } from '@/api/refunds';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Lines } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NOTE_HINT } from '@/components/ui/decision-dialog';
import { dayInZone, startOfDay } from '@/lib/format';

// the backend's limits on a payout's reference and note
const REFERENCE_MAX = 200;
const NOTE_MAX = 500;

/** Records how an owed refund was paid back: the USDT transfer's reference and the day it was paid. */
export function PayoutDialog({ open, refundId, rows, onClose, onSaved }: { open: boolean; refundId: string; rows: { k: string; v: React.ReactNode }[]; onClose: () => void; onSaved: (r: Refund) => void }) {
  const [reference, setReference] = React.useState('');
  const [day, setDay] = React.useState('');
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState('');
  const today = dayInZone();

  React.useEffect(() => {
    if (!open) return;
    setReference('');
    setDay('');
    setNote('');
    setError('');
  }, [open]);

  const save = useMutation({
    mutationFn: () => enterPayout(refundId, { reference: reference.trim(), paidAt: startOfDay(day), ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: (updated) => {
      onSaved(updated);
      toast.success('Payout entered. A second admin approves it.');
      onClose();
    },
    onError: (err) => setError(errorMessage(err))
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reference.trim() || !day) {
      setError('Enter the reference and the date.');
      return;
    }
    if (day > today) {
      setError("The date paid can't be in the future.");
      return;
    }
    save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <form className="flex flex-col gap-3.5" onSubmit={submit} noValidate>
          <DialogTitle>Record how the refund was paid</DialogTitle>
          <DialogDescription>Refunds are paid back in USDT. A second admin must approve this before the refund shows as paid.</DialogDescription>
          <Lines rows={rows} />
          <Field id="payout-reference" label="Reference" hint="The transfer's transaction hash, or the reference it was sent with.">
            <Input id="payout-reference" value={reference} maxLength={REFERENCE_MAX} onChange={(e) => setReference(e.target.value)} aria-describedby="payout-reference-hint" className="font-mono" />
          </Field>
          <Field id="payout-date" label="Date paid" hint="In Nairobi time.">
            <Input id="payout-date" type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} aria-describedby="payout-date-hint" />
          </Field>
          <Field id="payout-note" label="Note (optional)" hint={`${NOTE_HINT} Kept with the refund and in the audit log.`}>
            <textarea
              id="payout-note"
              value={note}
              maxLength={NOTE_MAX}
              rows={2}
              onChange={(e) => setNote(e.target.value)}
              aria-describedby="payout-note-hint"
              className="w-full rounded-ctl border border-ctl bg-surface px-3 py-2 text-sm text-ink"
            />
          </Field>
          {error ? <Banner tone="bad">{error}</Banner> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Enter the payout'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

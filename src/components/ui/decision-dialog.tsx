import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { errorMessage } from '@/api/errors';
import { Banner } from './badge';
import { Button } from './button';
import { Lines } from './card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';
import { Field } from './field';

// The backend's limit on a reason or a note.
const NOTE_MAX = 500;

export interface Decision {
  /** "Verify this KYC submission?" */
  title: string;
  description: string;
  /** the button's label: "Verify", "Enter the close" */
  confirm: string;
  danger?: boolean;
  rows: { k: string; v: React.ReactNode }[];
  /** a written reason or note; `required` is the message shown when it's left empty */
  note?: { label: string; hint: string; required?: string };
  run: (note: string) => Promise<unknown>;
  done: () => void;
}

/** Confirms one action, with what it acts on and an optional or required written reason. */
export function DecisionDialog({ decision, onClose }: { decision: Decision | null; onClose: () => void }) {
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    setNote('');
    setError('');
  }, [decision]);

  const run = useMutation({
    mutationFn: () => decision!.run(note.trim()),
    onSuccess: () => {
      decision!.done();
      onClose();
    },
    onError: (err) => setError(errorMessage(err))
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (decision?.note?.required && !note.trim()) {
      setError(decision.note.required);
      return;
    }
    run.mutate();
  };

  return (
    <Dialog open={!!decision} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        {decision ? (
          <form className="flex flex-col gap-3.5" onSubmit={submit} noValidate>
            <DialogTitle>{decision.title}</DialogTitle>
            <DialogDescription>{decision.description}</DialogDescription>
            <Lines rows={decision.rows} />
            {decision.note ? (
              <Field id="decision-note" label={decision.note.label} hint={decision.note.hint}>
                <textarea
                  id="decision-note"
                  value={note}
                  maxLength={NOTE_MAX}
                  rows={3}
                  required={!!decision.note.required}
                  onChange={(e) => setNote(e.target.value)}
                  aria-describedby="decision-note-hint"
                  className="w-full rounded-ctl border border-ctl bg-surface px-3 py-2 text-sm text-ink"
                />
              </Field>
            ) : null}
            {error ? <Banner tone="bad">{error}</Banner> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant={decision.danger ? 'danger' : 'primary'} disabled={run.isPending}>
                {run.isPending ? 'Saving…' : decision.confirm}
              </Button>
            </div>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export const NOTE_HINT = `Up to ${NOTE_MAX} characters.`;

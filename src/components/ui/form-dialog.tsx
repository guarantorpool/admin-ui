import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage } from '@/api/errors';
import { Banner } from './badge';
import { Button } from './button';
import { Lines } from './card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';

export type Rows = { k: string; v: React.ReactNode }[];
export const textareaClass = 'w-full rounded-ctl border border-ctl bg-surface px-3 py-2 text-sm text-ink';
export const selectClass = 'min-h-10 w-full rounded-ctl border border-ctl bg-surface px-2 text-ink';

/**
 * One entry form: what it acts on, its fields and the backend's answer. `check` returns a message to stop on,
 * or '' to send it.
 */
export function FormDialog<T>({ open, title, description, rows, confirm, onClose, check, send, saved, done, children }: {
  open: boolean;
  title: string;
  description: string;
  rows?: Rows;
  confirm: string;
  onClose: () => void;
  check: () => string;
  send: () => Promise<T>;
  saved: (result: T) => void;
  done: string;
  children: React.ReactNode;
}) {
  const [error, setError] = React.useState('');
  React.useEffect(() => setError(''), [open]);
  const save = useMutation({
    mutationFn: send,
    onSuccess: (result) => {
      saved(result);
      toast.success(done);
      onClose();
    },
    onError: (err) => setError(errorMessage(err))
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const problem = check();
    if (problem) setError(problem);
    else save.mutate();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <form className="flex flex-col gap-3.5" onSubmit={submit} noValidate>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
          {rows?.length ? <Lines rows={rows} /> : null}
          {children}
          {error ? <Banner tone="bad">{error}</Banner> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : confirm}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Keeps a form's values, emptied each time it opens. */
/** A form's values, back to `empty` each time it opens. */
export function useForm<T extends Record<string, string>>(open: boolean, empty: T) {
  const [values, setValues] = React.useState(empty);
  // the first empty values, not each render's copy
  const first = React.useRef(empty);
  React.useEffect(() => setValues(first.current), [open]);
  const set = (k: keyof T) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));
  return [values, set] as const;
}

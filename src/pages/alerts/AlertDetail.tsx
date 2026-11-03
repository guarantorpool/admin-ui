import * as React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { acknowledgeAlert, alertDetails, findAlert, type Alert } from '@/api/alerts';
import { errorMessage } from '@/api/errors';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { textareaClass } from '@/components/ui/form-dialog';
import { Fields, Muted, SectionTitle, StatusPill } from '@/components/ui/parts';
import { formatDateTime, formatNumber } from '@/lib/format';
import { alertDetail, alertLevel, alertStatus, alertType } from '@/lib/labels';
import { can, type Access } from '@/lib/permissions';
import { useGrants } from '@/session/SessionProvider';

const link = 'font-medium text-ink-strong underline underline-offset-4';
const mono = (v: string) => <span className="font-mono text-[13px] [overflow-wrap:anywhere]">{v}</span>;
const NOTE_MAX = 500;

// details that name a record the portal opens, and who can open it
const LINKS: Record<string, { to: (v: string) => string; access: Access }> = {
  quoteId: { to: (v) => `/guarantees/quotes/${encodeURIComponent(v)}`, access: 'GUARANTEES.READ' },
  guaranteeId: { to: (v) => `/guarantees/${encodeURIComponent(v)}`, access: 'GUARANTEES.READ' },
  oldestRefundId: { to: (v) => `/refunds/${encodeURIComponent(v)}`, access: 'REFUNDS.READ' }
};
// details shown as codes: IDs, hashes and wallet addresses
const CODES = new Set(['paymentId', 'txHash', 'wallet', 'previous', 'reference', 'paymentReference', 'oldestRefundId', 'error']);

/** One alert. The GP API has no read of one, so it's the list's row, or looked for when the list doesn't hold it. */
export function AlertDetail({ alertId, listed }: { alertId: string; listed?: Alert }) {
  const query = useQuery({ queryKey: ['alerts', 'one', alertId], queryFn: () => findAlert(alertId), enabled: !listed });
  const grants = useGrants();

  // an acknowledgement just made is newer than the list's row
  const alert = query.data ?? listed;
  if (!alert) {
    if (query.isPending) return <Muted>Loading the alert…</Muted>;
    return <Banner tone="bad">{query.isError ? errorMessage(query.error) : "There's no such alert."}</Banner>;
  }

  const details = Object.entries(alertDetails(alert)).filter(([, v]) => v !== null && v !== undefined && v !== '');
  const value = (k: string, v: unknown): React.ReactNode => {
    const text = typeof v === 'object' ? JSON.stringify(v) : String(v);
    const target = LINKS[k];
    if (target && can(grants, target.access)) return <Link to={target.to(text)} className={link}>{CODES.has(k) ? mono(text) : text}</Link>;
    if (/(At|Since|Until)$/.test(k)) return formatDateTime(text, { zone: true });
    return CODES.has(k) ? mono(text) : text;
  };

  return (
    <>
      <section className="flex flex-col gap-3.5 rounded-card border border-line bg-surface px-5 pb-4 pt-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="m-0 font-heading text-xl font-bold">{alertType(alert.type)}</h2>
          <StatusPill label={alertStatus(alert.status)} />
        </div>
        <p className="m-0">{alert.summary}</p>
        <Fields
          rows={[
            { k: 'Level', v: <StatusPill label={alertLevel(alert.severity)} /> },
            { k: 'Triggered by', v: mono(alert.type ?? '—') },
            { k: 'First seen', v: formatDateTime(alert.firstSeenAt, { zone: true }) },
            { k: 'Last seen', v: formatDateTime(alert.lastSeenAt, { zone: true }) },
            { k: 'Times seen', v: formatNumber(alert.count) },
            ...(alert.acknowledgedAt
              ? [
                  { k: 'Acknowledged by', v: `${alert.acknowledgedBy ?? '—'}, ${formatDateTime(alert.acknowledgedAt, { zone: true })}` },
                  { k: 'What was done', v: alert.acknowledgeNote ?? '—' }
                ]
              : []),
            ...(alert.resolvedAt ? [{ k: 'Resolved', v: formatDateTime(alert.resolvedAt, { zone: true }) }] : [])
          ]}
        />
      </section>
      {details.length ? (
        <section aria-label="What triggered it" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
          <SectionTitle>What triggered it</SectionTitle>
          <Fields rows={details.map(([k, v]) => ({ k: alertDetail(k), v: value(k, v) }))} />
        </section>
      ) : null}
      {alert.status === 'OPEN' ? (
        can(grants, 'ALERTS.MANAGE') ? (
          <Acknowledge alert={alert} />
        ) : (
          <Muted>Your role can view this but can't acknowledge it.</Muted>
        )
      ) : alert.status === 'ACKNOWLEDGED' ? (
        <Banner tone="warn">Acknowledged. It resolves on its own once its condition clears, and counts each time it's seen until then.</Banner>
      ) : (
        <Banner tone="ok">Resolved: its condition cleared. If it happens again, a new alert opens.</Banner>
      )}
    </>
  );
}

/** Saying what was done about an open alert. */
function Acknowledge({ alert }: { alert: Alert }) {
  const qc = useQueryClient();
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState('');
  const id = alert.id!;
  const save = useMutation({
    mutationFn: () => acknowledgeAlert(id, note.trim()),
    onSuccess: (updated) => {
      qc.setQueryData(['alerts', 'one', id], updated);
      void qc.invalidateQueries({ queryKey: ['alerts', 'list'] });
      toast.success('Alert acknowledged.');
    },
    onError: (err) => setError(errorMessage(err))
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) setError('Say what was done.');
    else {
      setError('');
      save.mutate();
    }
  };
  return (
    <form aria-label="Acknowledge" onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <SectionTitle>Acknowledge</SectionTitle>
      <Field id="ack-note" label="What was done" hint={`Shown on the alert and kept in the audit log. Up to ${NOTE_MAX} characters.`}>
        <textarea id="ack-note" aria-describedby="ack-note-hint" rows={3} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} className={textareaClass} />
      </Field>
      {error ? <Banner tone="bad">{error}</Banner> : null}
      <Button type="submit" className="self-end" disabled={save.isPending}>
        {save.isPending ? 'Saving…' : 'Acknowledge'}
      </Button>
    </form>
  );
}

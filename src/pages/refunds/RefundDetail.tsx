import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { decidePayout, owedOn, type Refund } from '@/api/refunds';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DecisionDialog, NOTE_HINT, type Decision } from '@/components/ui/decision-dialog';
import { Fields, Muted, StatusPill } from '@/components/ui/parts';
import { formatDate, formatDateTime, formatIn, formatUsdt } from '@/lib/format';
import { refundStatus, refundWhy } from '@/lib/labels';
import { can } from '@/lib/permissions';
import { useMemberName } from '@/pages/members/useMemberName';
import { useGrants, useSession } from '@/session/SessionProvider';
import { PayoutDialog } from './PayoutDialog';

const link = 'font-medium text-ink-strong underline underline-offset-4';
const mono = (v: string | undefined) => <span className="font-mono text-[13px] [overflow-wrap:anywhere]">{v ?? '—'}</span>;

const METHOD: Record<string, string> = { transfer: 'USDT transfer', swap: 'BLOCKS sold for the refund' };

/**
 * One refund. There's no way to read a single refund by itself, so it's the one on the list's page, or the copy
 * an action here returned, whichever is newer.
 */
export function RefundDetail({ refundId, listed, listedAt, loading }: { refundId: string; listed?: Refund; listedAt: number; loading: boolean }) {
  const saved = useQuery<Refund>({ queryKey: ['refunds', 'one', refundId], queryFn: () => Promise.reject(new Error('not read')), enabled: false });
  const refund = saved.data && (!listed || saved.dataUpdatedAt > listedAt) ? saved.data : listed;
  const member = useMemberName(refund?.memberId);

  if (!refund) return loading ? <Muted>Loading the refund…</Muted> : <Banner tone="warn">This refund isn't on the list as it's filtered now. Change the filters or the page, then open it from the list.</Banner>;

  return (
    <>
      <section className="flex flex-col gap-3.5 rounded-card border border-line bg-surface px-5 pb-4 pt-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="m-0 font-heading text-xl font-bold">Owed on {owedOn(refund)}</h2>
          <StatusPill label={refundStatus(refund.status)} />
        </div>
        <p className="m-0">{refundWhy(refund.type)}</p>
        <Fields
          rows={[
            { k: 'Member', v: member.link ? <Link to={member.link} className={link}>{member.text}</Link> : member.text },
            { k: 'Type', v: mono(refund.type) },
            { k: 'Amount', v: formatIn(refund.amount, refund.currency, { full: true }) },
            { k: 'Owed since', v: formatDateTime(refund.refundedAt, { zone: true }) },
            { k: refund.guaranteeId ? 'Owed on guarantee' : 'Owed on quote', v: <OwedOnLink refund={refund} /> },
            ...(refund.reason && refund.reason !== refund.type ? [{ k: 'Reason recorded', v: refund.reason }] : []),
            ...(refund.method
              ? [
                  { k: 'Paid by', v: METHOD[refund.method] ?? refund.method },
                  { k: 'Reference', v: mono(refund.reference) },
                  { k: 'Date paid', v: formatDate(refund.paidAt) },
                  ...(refund.usdtSpent ? [{ k: 'USDT spent', v: formatUsdt(refund.usdtSpent, { full: true }) }] : [])
                ]
              : []),
            ...(refund.enteredBy ? [{ k: 'Entered by', v: `${refund.enteredBy}, ${formatDateTime(refund.enteredAt, { zone: true })}` }] : []),
            ...(refund.entryNote ? [{ k: 'Note when entered', v: refund.entryNote }] : []),
            ...(refund.approvedBy ? [{ k: 'Approved by', v: `${refund.approvedBy}, ${formatDateTime(refund.approvedAt, { zone: true })}` }] : []),
            ...(refund.decisionNote ? [{ k: refund.status === 'owed' ? 'Why the last payout was rejected' : 'Note when approved', v: refund.decisionNote }] : [])
          ]}
        />
      </section>
      <Payout refund={refund} memberName={member.text} />
    </>
  );
}

function OwedOnLink({ refund: r }: { refund: Refund }) {
  const readable = can(useGrants(), 'GUARANTEES.READ');
  const id = owedOn(r);
  const to = r.guaranteeId ? `/guarantees/${r.guaranteeId}` : r.quoteId ? `/guarantees/quotes/${r.quoteId}` : null;
  return readable && to ? (
    <Link to={to} className={link}>
      {id}
    </Link>
  ) : (
    <>{id}</>
  );
}

/** Paying it back: one admin records the payout, and a different admin approves or rejects it. */
function Payout({ refund: r, memberName }: { refund: Refund; memberName: string }) {
  const grants = useGrants();
  const { session } = useSession();
  const qc = useQueryClient();
  const [entering, setEntering] = React.useState(false);
  const [decision, setDecision] = React.useState<Decision | null>(null);
  const canManage = can(grants, 'REFUNDS.MANAGE');
  const id = r.id!;
  const mine = r.status === 'entered' && r.enteredBy?.toLowerCase() === session?.email.toLowerCase();
  const name = owedOn(r);
  const amount = formatIn(r.amount, r.currency, { full: true });
  const rows = [
    { k: 'Owed on', v: name },
    { k: 'Member', v: memberName },
    { k: 'Amount', v: amount }
  ];

  const saved = (updated: Refund) => {
    qc.setQueryData(['refunds', 'one', id], updated);
    void qc.invalidateQueries({ queryKey: ['refunds', 'list'] });
  };

  const decide = (approve: boolean) =>
    setDecision({
      title: approve ? 'Approve this payout?' : 'Reject this payout?',
      description: approve ? 'The refund shows as paid and leaves Liquid Funds.' : 'The refund is owed again, and the payout can be entered afresh.',
      confirm: approve ? 'Approve' : 'Reject',
      danger: !approve,
      rows: [...rows, { k: 'Reference', v: mono(r.reference) }, { k: 'Date paid', v: formatDate(r.paidAt) }, { k: 'Entered by', v: `${r.enteredBy ?? '—'}, ${formatDateTime(r.enteredAt, { zone: true })}` }],
      note: { label: 'Note (optional)', hint: approve ? `${NOTE_HINT} Kept in the audit log.` : `${NOTE_HINT} Shown on the refund and kept in the audit log.` },
      run: async (note) => saved(await decidePayout(id, approve ? 'approve' : 'reject', note || undefined)),
      done: () => toast.success(approve ? `Refund on ${name} is paid.` : `Payout on ${name} rejected. The refund is owed again.`)
    });

  return (
    <>
      {r.status === 'paid' ? (
        <Banner tone="ok">Paid{r.approvedBy ? `. Approved by ${r.approvedBy}, ${formatDateTime(r.approvedAt, { zone: true })}.` : '.'}</Banner>
      ) : r.status === 'entered' ? (
        <section aria-label="Waiting for approval" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
          <Banner tone="warn">
            Waiting for approval. Payout entered by {mine ? 'you' : r.enteredBy}, {formatDateTime(r.enteredAt, { zone: true })}.
          </Banner>
          {canManage ? (
            <>
              {mine ? <Muted>You entered it, so a different admin approves or rejects it.</Muted> : null}
              <div className="flex flex-wrap justify-end gap-2.5">
                <Button variant="danger" disabled={mine} onClick={() => decide(false)}>
                  Reject
                </Button>
                <Button disabled={mine} onClick={() => decide(true)}>
                  Approve
                </Button>
              </div>
            </>
          ) : null}
        </section>
      ) : (
        <>
          {r.decisionNote ? <Banner tone="warn">The last payout entered was rejected: {r.decisionNote}</Banner> : null}
          {canManage ? (
            <Button className="self-start" onClick={() => setEntering(true)}>
              Record the payout
            </Button>
          ) : null}
        </>
      )}
      <PayoutDialog open={entering} refundId={id} rows={rows} onClose={() => setEntering(false)} onSaved={saved} />
      <DecisionDialog decision={decision} onClose={() => setDecision(null)} />
    </>
  );
}

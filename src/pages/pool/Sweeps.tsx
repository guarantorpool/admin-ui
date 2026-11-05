import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage } from '@/api/errors';
import { decideSweep, listRetiredWallets, listSweeps, recordSweep, retiredKey, sweepsKey, type PoolWallet, type Sweep } from '@/api/pool';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DecisionDialog, NOTE_HINT, type Decision } from '@/components/ui/decision-dialog';
import { Field } from '@/components/ui/field';
import { FormDialog, textareaClass, useForm } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Fields, Item, Items, Muted, SectionTitle, StatusPill } from '@/components/ui/parts';
import { Rows, type Column } from '@/components/ui/rows';
import { formatAmount, formatDateTime, formatUsdt } from '@/lib/format';
import { lateStatus, sweepStatus } from '@/lib/labels';
import { can } from '@/lib/permissions';
import { useGrants, useSession } from '@/session/SessionProvider';

// Sweeping retired pool wallets (#142 Phase E1, R-43). Only a wallet's signers can move what reaches it, outside the
// portal; an admin records their transaction, the GP API reads what it moved from the chain, and a second admin
// approves it. USDT that reached a retired wallet after its watch ended isn't credited: it's owed back to the member
// once an approved sweep has moved it.

const HASH = /^0x[0-9a-fA-F]{64}$/;
const NOTE_MAX = 500;
const linkClass = 'font-medium text-ink-strong underline underline-offset-4';

const mono = (v: string | undefined) => <span className="font-mono text-[13px] [overflow-wrap:anywhere]">{v ?? '—'}</span>;
const short = (a: string | undefined) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');

/** What a sweep moved, in full as it's approved from it: "120.00 USDT and 3.5 BLOCKS", leaving out a token it didn't move. */
export function moved(s: Sweep): string {
  const parts = [Number(s.usdtAmount) > 0 ? formatUsdt(s.usdtAmount, { full: true }) : '', Number(s.blocksAmount) > 0 ? formatAmount(s.blocksAmount, 'BLOCKS', { full: true }) : ''].filter(Boolean);
  return parts.join(' and ') || '—';
}

const COLUMNS: Column<Sweep>[] = [
  { header: 'From', cell: (s) => <span className="font-mono">{short(s.fromAddress)}</span> },
  { header: 'Moved', cell: moved },
  { header: 'Mined', cell: (s) => formatDateTime(s.minedAt) },
  { header: 'Recorded by', cell: (s) => <span className="block truncate" title={s.enteredBy}>{s.enteredBy ?? '—'}</span> },
  { header: 'Status', cell: (s) => <StatusPill label={sweepStatus(s.status)} /> }
];

/** Every sweep, newest first; each opens its details, where a waiting one is approved or rejected. */
export function SweepList() {
  const query = useQuery({ queryKey: sweepsKey, queryFn: listSweeps });
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface">
      {query.isPending ? (
        <p className="m-0 px-4 py-5 text-muted">Loading…</p>
      ) : query.isError ? (
        <div className="p-3.5">
          <Banner tone="bad">{errorMessage(query.error)}</Banner>
        </div>
      ) : !query.data.length ? (
        <p className="m-0 px-4 py-5 text-muted">No sweep has been recorded. Open a retired wallet to record one.</p>
      ) : (
        <Rows<Sweep>
          label="Sweeps"
          rows={query.data}
          rowKey={(s) => s.sweepId!}
          columns={COLUMNS}
          grid="grid-cols-[0.9fr_1.3fr_1fr_1.2fr_1.1fr]"
          minWidth={760}
          linkFor={(s) => `/pool/sweeps/${s.sweepId}`}
          sub={(s) => `${moved(s)} · mined ${formatDateTime(s.minedAt)}`}
        />
      )}
    </section>
  );
}

/** One sweep, and approving or rejecting it while it waits. */
export function SweepDetail({ sweepId }: { sweepId: string }) {
  const qc = useQueryClient();
  const { session } = useSession();
  const canApprove = can(useGrants(), 'WALLETS.APPROVE');
  const query = useQuery({ queryKey: sweepsKey, queryFn: listSweeps });
  const [decision, setDecision] = React.useState<Decision | null>(null);
  if (query.isPending) return <Muted>Loading the sweep…</Muted>;
  if (query.isError) return <Banner tone="bad">{errorMessage(query.error)}</Banner>;
  const s = query.data.find((x) => x.sweepId === sweepId);
  if (!s) return <Banner tone="bad">There's no such sweep.</Banner>;
  const waiting = s.status === 'pending';
  const mine = waiting && s.enteredBy?.toLowerCase() === session?.email.toLowerCase();

  const decide = (approve: boolean) =>
    setDecision({
      title: approve ? 'Approve this sweep?' : 'Reject this sweep?',
      description: approve
        ? 'The GP API reads the transaction again. Late payments it moved are then owed back to their members as refunds, oldest first.'
        : 'Nothing is owed back. The transaction can be recorded again.',
      confirm: approve ? 'Approve' : 'Reject',
      danger: !approve,
      rows: [
        { k: 'From', v: mono(s.fromAddress) },
        { k: 'Moved', v: moved(s) },
        { k: 'Transaction', v: mono(s.txHash) },
        { k: 'Recorded by', v: `${s.enteredBy ?? '—'}, ${formatDateTime(s.enteredAt, { zone: true })}` }
      ],
      note: { label: 'Note (optional)', hint: `${NOTE_HINT} Shown on the sweep and kept in the audit log.` },
      run: async (note) => {
        await decideSweep(s.sweepId!, approve ? 'approve' : 'reject', note || undefined);
        await Promise.all([qc.invalidateQueries({ queryKey: sweepsKey }), qc.invalidateQueries({ queryKey: retiredKey }), qc.invalidateQueries({ queryKey: ['refunds'] })]);
      },
      done: () => toast.success(approve ? 'Sweep approved.' : 'Sweep rejected.')
    });

  return (
    <>
      <section className="flex flex-col gap-3.5 rounded-card border border-line bg-surface px-5 pb-4 pt-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="m-0 font-heading text-xl font-bold">Sweep of {short(s.fromAddress)}</h2>
          <StatusPill label={sweepStatus(s.status)} />
        </div>
        <Fields
          rows={[
            { k: 'Moved', v: moved(s) },
            { k: 'From retired wallet', v: <Link to={`/pool/wallets/${s.fromWalletId}`} className={linkClass}>{mono(s.fromAddress)}</Link> },
            { k: 'To current wallet', v: mono(s.toAddress) },
            { k: 'Transaction', v: mono(s.txHash) },
            { k: 'Mined', v: formatDateTime(s.minedAt, { zone: true }) },
            { k: 'Recorded by', v: `${s.enteredBy ?? '—'}, ${formatDateTime(s.enteredAt, { zone: true })}` },
            ...(s.note ? [{ k: 'Note', v: s.note }] : []),
            ...(s.decidedBy ? [{ k: s.status === 'rejected' ? 'Rejected by' : 'Approved by', v: `${s.decidedBy}, ${formatDateTime(s.decidedAt, { zone: true })}` }] : []),
            ...(s.decisionNote ? [{ k: 'Decision note', v: s.decisionNote }] : [])
          ]}
        />
      </section>
      {waiting ? (
        <section aria-label="Waiting for approval" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
          <Banner tone="warn">
            Waiting for approval. Recorded by {mine ? 'you' : s.enteredBy}, {formatDateTime(s.enteredAt, { zone: true })}.
          </Banner>
          {canApprove ? (
            <>
              {mine ? <Muted>You recorded it, so a different admin approves or rejects it.</Muted> : null}
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
      ) : null}
      <DecisionDialog decision={decision} onClose={() => setDecision(null)} />
    </>
  );
}

/** A retired wallet's holdings on-chain, the payments that reached it after its watch ended, and its sweeps. */
export function RetiredWalletParts({ wallet }: { wallet: PoolWallet }) {
  const canSweep = can(useGrants(), 'WALLETS.SWEEP');
  const [recording, setRecording] = React.useState(false);
  const query = useQuery({ queryKey: retiredKey, queryFn: listRetiredWallets });
  if (query.isPending) return <Muted>Reading what the wallet holds…</Muted>;
  if (query.isError) return <Banner tone="bad">{errorMessage(query.error)}</Banner>;
  const r = query.data.find((x) => x.wallet?.id === wallet.id);
  if (!r) return null;
  const late = r.latePayments ?? [];
  const sweeps = r.sweeps ?? [];
  const waitingSweep = sweeps.some((s) => s.status === 'pending');

  return (
    <>
      <section aria-label="What it holds" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <SectionTitle>What it holds, read on-chain</SectionTitle>
          {canSweep ? <Button onClick={() => setRecording(true)}>Record a sweep</Button> : null}
        </div>
        {r.balancesRead ? (
          <Fields
            rows={[
              { k: 'USDT', v: formatUsdt(r.usdtBalance, { full: true }) },
              { k: 'BLOCKS', v: formatAmount(r.blocksBalance, 'BLOCKS', { full: true }) },
              { k: 'Late payments waiting for a sweep', v: formatUsdt(r.lateWaiting, { full: true }) }
            ]}
          />
        ) : (
          <>
            <Banner tone="warn">The chain couldn't be read, so what the wallet holds is unknown. Try again in a minute.</Banner>
            <Fields rows={[{ k: 'Late payments waiting for a sweep', v: formatUsdt(r.lateWaiting, { full: true }) }]} />
          </>
        )}
        <Muted>Only the wallet's signers can move what it holds, to the current pool wallet. Record their transaction here, and a second admin approves it. A sweep is a move between the pool's own wallets, not new money.</Muted>
        {waitingSweep ? <Banner tone="warn">A sweep of this wallet is waiting for approval.</Banner> : null}
      </section>

      <section aria-label="Late payments" className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
        <SectionTitle>Paid here after its watch ended</SectionTitle>
        {late.length ? (
          <Items label="Late payments">
            {late.map((p) => (
              <Item
                key={p.latePaymentId}
                title={formatUsdt(p.amount, { full: true })}
                sub={
                  <>
                    Quote <Link to={`/guarantees/quotes/${encodeURIComponent(p.quoteId ?? '')}`} className={linkClass}>{p.quoteId}</Link>, arrived {formatDateTime(p.arrivedAt)}
                    {p.refundId ? (
                      <>
                        {' · '}
                        <Link to={`/refunds/${p.refundId}`} className={linkClass}>
                          Its refund
                        </Link>
                      </>
                    ) : null}
                  </>
                }
                status={<StatusPill label={lateStatus(p.status)} />}
              />
            ))}
          </Items>
        ) : (
          <Muted>Nothing has been paid here since its watch ended.</Muted>
        )}
        <Muted>These aren't credited to a guarantee. Each is owed back to its member once an approved sweep moved it.</Muted>
      </section>

      <section aria-label="Sweeps of this wallet" className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
        <SectionTitle>Sweeps</SectionTitle>
        {sweeps.length ? (
          <Items label="Sweeps of this wallet">
            {sweeps.map((s) => (
              <Item
                key={s.sweepId}
                title={
                  <Link to={`/pool/sweeps/${s.sweepId}`} className={linkClass}>
                    {moved(s)}
                  </Link>
                }
                sub={`Mined ${formatDateTime(s.minedAt)} · recorded by ${s.enteredBy ?? '—'}`}
                status={<StatusPill label={sweepStatus(s.status)} />}
              />
            ))}
          </Items>
        ) : (
          <Muted>No sweep has been recorded.</Muted>
        )}
      </section>
      <RecordSweepDialog wallet={wallet} open={recording} onClose={() => setRecording(false)} />
    </>
  );
}

/** Records the signers' transaction; what it moved is read from its receipt, not typed in. */
function RecordSweepDialog({ wallet, open, onClose }: { wallet: PoolWallet; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, set] = useForm(open, { txHash: '', note: '' });
  return (
    <FormDialog
      open={open}
      title="Record a sweep"
      description={`The transaction must move USDT or BLOCKS from ${short(wallet.address)} to the current pool wallet. The GP API reads what it moved from the chain, and a different admin approves it.`}
      confirm="Record the sweep"
      onClose={onClose}
      check={() => (!HASH.test(f.txHash.trim()) ? 'Enter the transaction hash: 0x followed by 64 hexadecimal characters.' : '')}
      send={() => recordSweep(wallet.id!, f.txHash.trim(), f.note.trim() || undefined)}
      saved={async () => {
        await Promise.all([qc.invalidateQueries({ queryKey: sweepsKey }), qc.invalidateQueries({ queryKey: retiredKey })]);
      }}
      done="Sweep recorded. A second admin approves it."
    >
      <Field id="sweep-hash" label="Transaction hash" hint="From the Safe's transaction history, once it has been executed.">
        <Input id="sweep-hash" value={f.txHash} onChange={set('txHash')} aria-describedby="sweep-hash-hint" className="font-mono" autoComplete="off" spellCheck={false} />
      </Field>
      <Field id="sweep-note" label="Note (optional)" hint={`${NOTE_HINT} Shown to the admin who approves it.`}>
        <textarea id="sweep-note" value={f.note} maxLength={NOTE_MAX} rows={2} onChange={set('note')} aria-describedby="sweep-note-hint" className={textareaClass} />
      </Field>
    </FormDialog>
  );
}

import * as React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage } from '@/api/errors';
import { decideWallet, listSweeps, listWallets, proposeWallet, sweepsKey, type PoolWallet } from '@/api/pool';
import { PageHeader } from '@/components/shell/AppShell';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DecisionDialog, NOTE_HINT, type Decision } from '@/components/ui/decision-dialog';
import { Field } from '@/components/ui/field';
import { FormDialog, textareaClass, useForm } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Fields, Item, Items, Muted, SectionTitle, StatusPill } from '@/components/ui/parts';
import { Rows, type Column } from '@/components/ui/rows';
import { Sheet } from '@/components/ui/sheet';
import { Tabs } from '@/components/ui/tabs';
import { formatDate, formatDateTime } from '@/lib/format';
import { walletStatus } from '@/lib/labels';
import { can } from '@/lib/permissions';
import { useMedia, WIDE_QUERY } from '@/lib/useMedia';
import { NoAccess } from '@/pages/Placeholders';
import { useGrants, useSession } from '@/session/SessionProvider';
import { RetiredWalletParts, SweepDetail, SweepList } from './Sweeps';

// Screen 13. The pool wallet is a Safe multisig that receives the pool's USDT. It's replaced from time to time: one
// admin proposes a Safe, the GP API reads its signers and threshold from the chain, and a different admin approves
// it, which retires the current wallet. Every wallet is kept, and a retired one is still watched for payments for a
// while. What reaches a retired wallet is swept into the current one by its signers, recorded here by one admin and
// approved by a second (Phase E1).

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
// the backend's limit on a note
const NOTE_MAX = 500;

const mono = (v: string | undefined) => <span className="font-mono text-[13px] [overflow-wrap:anywhere]">{v ?? '—'}</span>;

/** An address cut to its ends for lists, as wallets show it: 0x91ab…7e0b. */
export const shortAddress = (a: string | undefined) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');

const mustSign = (w: PoolWallet) => `${w.threshold ?? '—'} of ${w.signers?.length ?? '—'}`;

const COLUMNS: Column<PoolWallet>[] = [
  { header: 'Safe address', cell: (w) => <span className="font-mono">{shortAddress(w.address)}</span> },
  { header: 'Must sign', cell: mustSign },
  { header: 'Current from', cell: (w) => formatDate(w.currentFrom) },
  { header: 'Current until', cell: (w) => (w.status === 'current' ? 'Now' : formatDate(w.currentUntil)) },
  { header: 'Proposed', cell: (w) => formatDate(w.proposedAt) },
  { header: 'Status', cell: (w) => <StatusPill label={walletStatus(w.status)} /> }
];

export function PoolWalletsPage() {
  const grants = useGrants();
  if (!can(grants, 'POOL.READ')) return <NoAccess />;
  return <PoolWallets />;
}

function PoolWallets() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { walletId, sweepId } = useParams();
  const [params] = useSearchParams();
  const view = sweepId || params.get('view') === 'sweeps' ? 'sweeps' : 'wallets';
  const wide = useMedia(WIDE_QUERY);
  const [proposing, setProposing] = React.useState(false);
  const canPropose = can(useGrants(), 'WALLETS.PROPOSE');
  const query = useQuery({ queryKey: ['pool', 'wallets'], queryFn: listWallets });
  const wallets = query.data ?? [];
  const waiting = wallets.find((w) => w.status === 'proposed');
  const open = wallets.find((w) => w.id === walletId);
  const sweeps = useQuery({ queryKey: sweepsKey, queryFn: listSweeps });
  const sweepsWaiting = (sweeps.data ?? []).filter((s) => s.status === 'pending').length;
  const tabs = [
    { value: 'wallets', label: 'Wallets' },
    { value: 'sweeps', label: 'Sweeps', count: sweepsWaiting }
  ];

  return (
    <>
      <PageHeader actions={canPropose && view === 'wallets' ? <Button onClick={() => setProposing(true)} disabled={!!waiting}>Propose a new wallet</Button> : undefined} />
      <div className="flex flex-col gap-3.5">
        <Tabs label="Pool wallets" idPrefix="wallets" tabs={tabs} value={view} onChange={(v) => navigate(v === 'sweeps' ? '/pool/wallets?view=sweeps' : '/pool/wallets')} />
        <div role="tabpanel" id={`wallets-panel-${view}`} aria-labelledby={`wallets-tab-${view}`} className="flex flex-col gap-3.5">
          {view === 'sweeps' ? (
            <>
              <Muted>A sweep moves what reached a retired wallet into the current one. The wallet's signers make it; one admin records it and a different one approves it. Approving owes back, as refunds, the late payments it moved.</Muted>
              <SweepList />
            </>
          ) : (
            <>
              <Muted>Members' premiums are paid into the current pool wallet, a Safe multisig. Switching to a new one takes two admins, and a retired wallet is still watched for payments for a while.</Muted>
              {waiting && canPropose ? <Banner tone="warn">A new wallet is waiting for approval. Another can be proposed once it's approved or rejected.</Banner> : null}
              <section className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface">
                {query.isPending ? (
                  <p className="m-0 px-4 py-5 text-muted">Loading…</p>
                ) : query.isError ? (
                  <div className="p-3.5">
                    <Banner tone="bad">{errorMessage(query.error)}</Banner>
                  </div>
                ) : !wallets.length ? (
                  <p className="m-0 px-4 py-5 text-muted">No pool wallet has been proposed yet. Members can't pay by wallet until the first one is approved.</p>
                ) : (
                  <Rows<PoolWallet>
                    label="Pool wallets"
                    rows={wallets}
                    rowKey={(w) => w.id!}
                    columns={COLUMNS}
                    grid="grid-cols-[1.1fr_0.7fr_0.9fr_0.9fr_0.9fr_1.1fr]"
                    minWidth={820}
                    linkFor={(w) => `/pool/wallets/${w.id}`}
                    sub={(w) => `${mustSign(w)} must sign · ${w.status === 'current' ? `current since ${formatDate(w.currentFrom)}` : w.status === 'retired' ? `retired ${formatDate(w.currentUntil)}` : `proposed ${formatDate(w.proposedAt)}`}`}
                  />
                )}
              </section>
            </>
          )}
        </div>
      </div>

      <Sheet open={!!walletId} onClose={() => navigate('/pool/wallets')} title="Pool wallet details" wide={wide}>
        {query.isPending ? <Muted>Loading the wallet…</Muted> : open ? <WalletDetail wallet={open} /> : <Banner tone="bad">There's no such pool wallet.</Banner>}
      </Sheet>
      <Sheet open={!!sweepId} onClose={() => navigate('/pool/wallets?view=sweeps')} title="Sweep details" wide={false}>
        {sweepId ? <SweepDetail sweepId={sweepId} /> : null}
      </Sheet>
      <ProposeDialog
        open={proposing}
        onClose={() => setProposing(false)}
        onSaved={(w) => {
          qc.setQueryData<PoolWallet[]>(['pool', 'wallets'], (old) => [w, ...(old ?? [])]);
          navigate(`/pool/wallets/${w.id}`);
        }}
      />
    </>
  );
}

function WalletDetail({ wallet: w }: { wallet: PoolWallet }) {
  const qc = useQueryClient();
  const { session } = useSession();
  const canApprove = can(useGrants(), 'WALLETS.APPROVE');
  const [decision, setDecision] = React.useState<Decision | null>(null);
  const waiting = w.status === 'proposed';
  const mine = waiting && w.proposedBy?.toLowerCase() === session?.email.toLowerCase();

  const decide = (approve: boolean) =>
    setDecision({
      title: approve ? 'Approve this pool wallet?' : 'Reject this pool wallet?',
      description: approve
        ? "Members' premiums go to it from now on, and the current wallet is retired. Check the signers and threshold against the Safe; the GP API reads them again and refuses if they changed."
        : 'The current wallet stays as it is. The Safe can be proposed again.',
      confirm: approve ? 'Approve' : 'Reject',
      danger: !approve,
      rows: [
        { k: 'Safe address', v: mono(w.address) },
        { k: 'Must sign', v: mustSign(w) },
        ...(w.signers ?? []).map((s, i) => ({ k: `Signer ${i + 1}`, v: mono(s) })),
        { k: 'Proposed by', v: `${w.proposedBy ?? '—'}, ${formatDateTime(w.proposedAt, { zone: true })}` }
      ],
      note: { label: 'Note (optional)', hint: `${NOTE_HINT} Shown on the wallet and kept in the audit log.` },
      run: async (note) => {
        await decideWallet(w.id!, approve ? 'approve' : 'reject', note || undefined);
        await qc.invalidateQueries({ queryKey: ['pool', 'wallets'] });
      },
      done: () => toast.success(approve ? `The pool wallet is now ${shortAddress(w.address)}.` : `Wallet ${shortAddress(w.address)} rejected.`)
    });

  return (
    <>
      <section className="flex flex-col gap-3.5 rounded-card border border-line bg-surface px-5 pb-4 pt-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="m-0 font-heading text-xl font-bold">Safe {shortAddress(w.address)}</h2>
          <StatusPill label={walletStatus(w.status)} />
        </div>
        <Fields
          rows={[
            { k: 'Safe address', v: mono(w.address) },
            { k: 'Must sign', v: mustSign(w) },
            { k: 'Current from', v: w.currentFrom ? formatDateTime(w.currentFrom, { zone: true }) : 'Not yet' },
            { k: 'Current until', v: w.status === 'current' ? 'Now' : w.currentUntil ? formatDateTime(w.currentUntil, { zone: true }) : '—' },
            ...(w.status === 'retired' ? [{ k: 'Watched for payments until', v: formatDateTime(w.watchUntil, { zone: true }) }] : []),
            { k: 'Proposed by', v: `${w.proposedBy ?? '—'}, ${formatDateTime(w.proposedAt, { zone: true })}` },
            ...(w.proposalNote ? [{ k: 'Proposal note', v: w.proposalNote }] : []),
            ...(w.decidedBy ? [{ k: w.status === 'rejected' ? 'Rejected by' : 'Approved by', v: `${w.decidedBy}, ${formatDateTime(w.decidedAt, { zone: true })}` }] : []),
            ...(w.decisionNote ? [{ k: 'Decision note', v: w.decisionNote }] : [])
          ]}
        />
      </section>

      {waiting ? (
        <section aria-label="Waiting for approval" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
          <Banner tone="warn">
            Waiting for approval. Proposed by {mine ? 'you' : w.proposedBy}, {formatDateTime(w.proposedAt, { zone: true })}.
          </Banner>
          {canApprove ? (
            <>
              {mine ? <Muted>You proposed it, so a different admin approves or rejects it.</Muted> : null}
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

      {w.status === 'retired' ? <RetiredWalletParts wallet={w} /> : null}

      <section className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
        <SectionTitle>Signers, as read from the Safe</SectionTitle>
        <Items label="Signers">
          {(w.signers ?? []).map((s, i) => (
            <Item key={s} title={`Signer ${i + 1}`} sub={mono(s)} />
          ))}
        </Items>
      </section>
      <DecisionDialog decision={decision} onClose={() => setDecision(null)} />
    </>
  );
}

/** Proposes a Safe as the next pool wallet. Its signers and threshold are read from the chain, not typed in. */
function ProposeDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (w: PoolWallet) => void }) {
  const [f, set] = useForm(open, { address: '', note: '' });
  return (
    <FormDialog
      open={open}
      title="Propose a new pool wallet"
      description="The GP API reads the Safe's signers and threshold from the chain, and a different admin approves it, seeing them. The wallet it replaces is kept as retired."
      confirm="Propose the wallet"
      onClose={onClose}
      check={() => (!ADDRESS.test(f.address.trim()) ? 'Enter the Safe address: 0x followed by 40 hexadecimal characters.' : '')}
      send={() => proposeWallet(f.address.trim(), f.note.trim() || undefined)}
      saved={onSaved}
      done="Wallet proposed. A second admin approves it."
    >
      <Field id="wallet-address" label="Safe address" hint="A Safe multisig on BNB Smart Chain, not an ordinary wallet.">
        <Input id="wallet-address" value={f.address} onChange={set('address')} aria-describedby="wallet-address-hint" className="font-mono" autoComplete="off" spellCheck={false} />
      </Field>
      <Field id="wallet-note" label="Note (optional)" hint={`${NOTE_HINT} Shown to the admin who approves it.`}>
        <textarea id="wallet-note" value={f.note} maxLength={NOTE_MAX} rows={2} onChange={set('note')} aria-describedby="wallet-note-hint" className={textareaClass} />
      </Field>
    </FormDialog>
  );
}

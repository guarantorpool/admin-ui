import * as React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { approvalCountKey, decideApproval, getApprovalCount, listApprovals, type Approval, type ApprovalQuery } from '@/api/approvals';
import { errorMessage } from '@/api/errors';
import { PageHeader } from '@/components/shell/AppShell';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { DecisionDialog, NOTE_HINT, type Decision } from '@/components/ui/decision-dialog';
import { Pager, PAGE_SIZES } from '@/components/ui/pager';
import { Fields, Muted, StatusPill } from '@/components/ui/parts';
import { Rows, type Column } from '@/components/ui/rows';
import { Sheet } from '@/components/ui/sheet';
import { formatDateTime, formatIn, zoneLabel } from '@/lib/format';
import { APPROVAL_KINDS, approvalKind, type Tone } from '@/lib/labels';
import { cn } from '@/lib/utils';

// Screen 3. Everything one admin entered that waits for a second, across the screens that decide them, longest
// waiting first. An item is approved or rejected here on the route the GP API gives for it, which still refuses the
// admin who entered it; each also links to its own screen. A default to verify is verified on its claim, against
// its documents.

const DEFAULT_SIZE = 25;
// an item opened from a link may not be on the page shown, so it is looked for among the first this many of its kind
const LOOKUP_SIZE = 100;
const selectClass = 'min-h-9 rounded-ctl border border-ctl bg-surface px-2 text-ink';
const linkClass = 'font-medium text-ink-strong underline underline-offset-4';

/** Where you stand on an item: you can decide it, you entered it, or your role can't decide it. */
function standing(a: Approval): { text: string; tone: Tone } {
  if (a.canDecide) return { text: 'You can decide', tone: 'warn' };
  if (a.yours) return { text: 'Entered by you', tone: 'neutral' };
  return { text: "Your role can't decide", tone: 'neutral' };
}

const amountOf = (a: Approval, full = false) => (a.amount ? formatIn(a.amount, a.currency, { full }) : '—');

/** The item on its own screen. */
export function itsScreen(a: Approval): string {
  const id = encodeURIComponent(a.id ?? '');
  switch (a.kind) {
    case 'guarantee_close':
      return `/guarantees/${encodeURIComponent(a.guaranteeId ?? a.id ?? '')}`;
    case 'loan_step':
      return `/loans/${a.loanId ?? id}`;
    case 'default_verification':
    case 'loan_recovery':
      return a.loanId ? `/claims/${a.loanId}` : '/claims';
    case 'refund_payout':
      return `/refunds/${id}`;
    case 'liquidity_adjustment':
      return '/pool/health?view=liquidity';
    case 'pool_wallet':
      return `/pool/wallets/${id}`;
    case 'pool_wallet_sweep':
      return `/pool/sweeps/${id}`;
    case 'parameter_change':
    case 'parameter_change_set':
      return '/pool/settings';
    case 'backing_change':
      return `/backing/${id}`;
    default:
      return '/approvals';
  }
}

const COLUMNS: Column<Approval>[] = [
  { header: 'Type', cell: (a) => approvalKind(a.kind) },
  { header: 'What', cell: (a) => <span className="block truncate" title={a.summary}>{a.summary ?? '—'}</span> },
  { header: 'Amount', cell: (a) => amountOf(a), figure: true },
  { header: 'Entered by', cell: (a) => <span className="block truncate" title={a.enteredByEmail}>{a.enteredByEmail ?? '—'}</span> },
  { header: 'Waiting since', cell: (a) => formatDateTime(a.enteredAt) },
  { header: 'You', cell: (a) => <StatusPill label={standing(a)} /> }
];

export function ApprovalsPage() {
  const navigate = useNavigate();
  const { kind: openKind, itemId } = useParams();
  const [params, setParams] = useSearchParams();

  const forYou = params.get('show') === 'for-you';
  const kind = APPROVAL_KINDS.find((k) => k === params.get('kind')) ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const sizeParam = Number(params.get('size'));
  const size = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : DEFAULT_SIZE;

  /** Changes some values; any change but the page goes back to page 1. */
  const update = (changes: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === undefined || v === '' || (k === 'page' && v === 1) || (k === 'size' && v === DEFAULT_SIZE)) next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  const address = params.toString() ? `?${params.toString()}` : '';
  const count = useQuery({ queryKey: approvalCountKey, queryFn: getApprovalCount, refetchInterval: 60_000 });
  const q: ApprovalQuery = { page, size, kind: kind || undefined, forYou };
  const query = useQuery({ queryKey: ['approvals', 'list', q], queryFn: () => listApprovals(q), placeholderData: keepPreviousData, refetchInterval: 60_000 });

  // a page emptied by decisions steps back to the last page that has items
  const total = query.data?.totalResults ?? 0;
  React.useEffect(() => {
    if (query.data && !query.data.results?.length && page > 1) update({ page: Math.max(1, query.data.totalPages ?? 1) });
  }, [query.data, page]);

  const byKind = count.data?.byKind ?? {};
  const visibleKinds = APPROVAL_KINDS.filter((k) => k in byKind);
  const filtered = forYou || !!kind;

  const list = query.isPending ? (
    <p className="m-0 px-4 py-5 text-muted">Loading…</p>
  ) : query.isError ? (
    <div className="p-3.5">
      <Banner tone="bad">{errorMessage(query.error)}</Banner>
    </div>
  ) : !query.data.results?.length ? (
    <p className="m-0 px-4 py-5 text-muted">{forYou ? 'Nothing is waiting for you to decide.' : kind ? 'Nothing of this type is waiting.' : 'Nothing is waiting for a second admin.'}</p>
  ) : (
    <Rows<Approval>
      label="Waiting for a second admin"
      rows={query.data.results}
      rowKey={(a) => `${a.kind}:${a.id}`}
      columns={COLUMNS}
      grid="grid-cols-[1.1fr_2.4fr_1fr_1.5fr_1.1fr_1.1fr]"
      minWidth={1000}
      linkFor={(a) => `/approvals/${a.kind}/${encodeURIComponent(a.id ?? '')}${address}`}
      sub={(a) => [a.summary, a.amount ? amountOf(a) : null, `entered by ${a.enteredByEmail ?? 'no one recorded'}`].filter(Boolean).join(' · ')}
    />
  );

  return (
    <>
      <PageHeader />
      <div className="flex flex-col gap-3.5">
        <Muted>
          Everything one admin entered that waits for a second, longest waiting first. Times are in {zoneLabel()}. Approve or reject an item here, or open it on its own screen; the admin who entered an item
          can't decide it. You see the types your role can read.
        </Muted>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
            <Chip on={!forYou} onClick={() => update({ show: undefined })}>
              Everything waiting{count.data ? ` (${count.data.waiting ?? 0})` : ''}
            </Chip>
            <Chip on={forYou} onClick={() => update({ show: 'for-you' })}>
              For you to decide{count.data ? ` (${count.data.forYou ?? 0})` : ''}
            </Chip>
          </div>
          <select aria-label="Type" value={kind} onChange={(e) => update({ kind: e.target.value })} className={selectClass}>
            <option value="">All types</option>
            {(visibleKinds.length ? visibleKinds : kind ? [kind] : []).map((k) => (
              <option key={k} value={k}>
                {approvalKind(k)}
                {k in byKind ? ` (${byKind[k]})` : ''}
              </option>
            ))}
          </select>
          {filtered ? (
            <Button variant="outline" onClick={() => update({ show: undefined, kind: undefined })}>
              Clear the filters
            </Button>
          ) : null}
        </div>
        <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface', query.isFetching && !query.isPending && 'opacity-70')} aria-busy={query.isFetching}>
          {list}
          {total > 0 ? <Pager page={page} size={size} total={total} onPage={(p) => update({ page: p })} onSize={(s) => update({ size: s })} /> : null}
        </section>
      </div>

      <Sheet open={!!(openKind && itemId)} onClose={() => navigate(`/approvals${address}`)} title="Waiting item">
        {openKind && itemId ? (
          <ApprovalDetail
            kind={openKind}
            id={itemId}
            listed={query.data?.results?.find((a) => a.kind === openKind && a.id === itemId)}
            onDecided={() => navigate(`/approvals${address}`)}
          />
        ) : null}
      </Sheet>
    </>
  );
}

/** Looks for one waiting item among its kind, a page at a time, so an item past the first page is still found. */
async function findApproval(kind: string, id: string): Promise<Approval | null> {
  for (let page = 1; ; page++) {
    const found = await listApprovals({ page, size: LOOKUP_SIZE, kind });
    const item = found.results?.find((a) => a.id === id);
    if (item) return item;
    if (!found.results?.length || page >= (found.totalPages ?? 1)) return null;
  }
}

/** One waiting item, with approving or rejecting it, or why you can't. */
function ApprovalDetail({ kind, id, listed, onDecided }: { kind: string; id: string; listed?: Approval; onDecided: () => void }) {
  const qc = useQueryClient();
  const [decision, setDecision] = React.useState<Decision | null>(null);
  const known = APPROVAL_KINDS.includes(kind);
  const lookup = useQuery({ queryKey: ['approvals', 'item', kind, id], queryFn: () => findApproval(kind, id), enabled: !listed && known });
  const item = listed ?? lookup.data ?? undefined;

  if (!item) {
    if (known && lookup.isPending) return <Muted>Loading the item…</Muted>;
    if (lookup.isError) return <Banner tone="bad">{errorMessage(lookup.error)}</Banner>;
    return (
      <Banner tone="warn">
        This item isn't waiting any more: another admin may have decided it, or it was withdrawn.{' '}
        <Link to="/approvals" className={linkClass}>
          Back to the inbox
        </Link>
      </Banner>
    );
  }

  const label = approvalKind(item.kind).toLowerCase();
  const rows = [
    { k: 'What', v: item.summary ?? '—' },
    ...(item.amount ? [{ k: 'Amount', v: amountOf(item, true) }] : []),
    { k: 'Entered by', v: `${item.enteredByEmail ?? 'No one recorded'}, ${formatDateTime(item.enteredAt, { zone: true })}` }
  ];

  const decide = (approve: boolean) =>
    setDecision({
      title: approve ? `Approve this ${label}?` : `Reject this ${label}?`,
      description: approve
        ? 'It takes effect now, the same as approving it on its own screen. The GP API checks it again and refuses if it changed.'
        : 'Nothing it would change is changed. It can be entered again.',
      confirm: approve ? 'Approve' : 'Reject',
      danger: !approve,
      rows,
      note: { label: 'Note (optional)', hint: `${NOTE_HINT} Kept with the decision and in the audit log.` },
      run: async (note) => {
        await decideApproval(item, approve ? 'approve' : 'reject', note || undefined);
        // a decision changes the item's own screen as well as the inbox
        await qc.invalidateQueries();
      },
      done: () => {
        toast.success(approve ? `${approvalKind(item.kind)} approved.` : `${approvalKind(item.kind)} rejected.`);
        onDecided();
      }
    });

  const decidable = item.canDecide && item.approve?.method === 'PATCH';
  return (
    <div className="flex flex-col gap-4">
      <Fields
        rows={[
          { k: 'Type', v: approvalKind(item.kind) },
          { k: 'What', v: item.summary ?? '—' },
          ...(item.amount ? [{ k: 'Amount', v: amountOf(item, true) }] : []),
          ...(item.note ? [{ k: 'Note', v: <span className="whitespace-pre-wrap">{item.note}</span> }] : []),
          { k: 'Entered by', v: item.enteredByEmail ?? 'No one recorded' },
          { k: 'Waiting since', v: formatDateTime(item.enteredAt, { zone: true }) },
          ...(item.guaranteeId
            ? [
                {
                  k: 'Guarantee',
                  v: (
                    <Link to={`/guarantees/${encodeURIComponent(item.guaranteeId)}`} className={cn(linkClass, 'font-mono text-[13px]')}>
                      {item.guaranteeId}
                    </Link>
                  )
                }
              ]
            : []),
          {
            k: 'Its screen',
            v: (
              <Link to={itsScreen(item)} className={linkClass}>
                Open it on its own screen
              </Link>
            )
          }
        ]}
      />
      {item.yours ? (
        <Banner tone="warn">You entered this, so a different admin has to approve or reject it.</Banner>
      ) : !item.canDecide ? (
        <Banner tone="warn">Your role can read this but can't approve or reject it.</Banner>
      ) : item.approve?.method !== 'PATCH' ? (
        <Banner tone="warn">
          A default is verified against its documents, on its claim.{' '}
          <Link to={itsScreen(item)} className={linkClass}>
            Verify it there
          </Link>
        </Banner>
      ) : null}
      {decidable ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => decide(true)}>Approve</Button>
          {item.reject ? (
            <Button variant="danger" onClick={() => decide(false)}>
              Reject
            </Button>
          ) : null}
        </div>
      ) : null}
      <DecisionDialog decision={decision} onClose={() => setDecision(null)} />
    </div>
  );
}

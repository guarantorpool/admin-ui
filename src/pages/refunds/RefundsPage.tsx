import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { errorMessage } from '@/api/errors';
import { listRefunds, owedOn, refundMember, type Refund, type RefundQuery } from '@/api/refunds';
import { PageHeader } from '@/components/shell/AppShell';
import { Badge, Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Pager, PAGE_SIZES } from '@/components/ui/pager';
import { Muted, StatusPill } from '@/components/ui/parts';
import { Rows, type Column } from '@/components/ui/rows';
import { Sheet } from '@/components/ui/sheet';
import { formatDate, formatIn } from '@/lib/format';
import { REFUND_TYPES, refundStatus } from '@/lib/labels';
import { can } from '@/lib/permissions';
import { useMedia, WIDE_QUERY } from '@/lib/useMedia';
import { cn } from '@/lib/utils';
import { NoAccess } from '@/pages/Placeholders';
import { useGrants } from '@/session/SessionProvider';
import { RefundDetail } from './RefundDetail';

// Screen 11. Money owed back, newest first. A refund has no business ID, so a row is named by the guarantee or
// quote it's owed on, and by its member.

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'owed', label: 'Owed' },
  { value: 'entered', label: 'Entered' },
  { value: 'paid', label: 'Paid' }
];

const DEFAULT_SIZE = 25;

/** Its status, and whether the last payout entered on it was rejected. */
function RefundStatusCell({ r }: { r: Refund }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StatusPill label={refundStatus(r.status)} />
      {r.status === 'owed' && r.decisionNote ? <Badge tone="bad">Payout rejected</Badge> : null}
    </span>
  );
}

const COLUMNS: Column<Refund>[] = [
  { header: 'Owed on', cell: owedOn },
  { header: 'Member', cell: refundMember },
  { header: 'Type', cell: (r) => <span className="font-mono text-[13px]">{r.type}</span> },
  { header: 'Amount', cell: (r) => formatIn(r.amount, r.currency), figure: true },
  { header: 'Owed since', cell: (r) => formatDate(r.refundedAt) },
  { header: 'Status', cell: (r) => <RefundStatusCell r={r} /> }
];

export function RefundsPage() {
  const grants = useGrants();
  if (!can(grants, 'REFUNDS.READ')) return <NoAccess />;
  return <Refunds />;
}

function Refunds() {
  const navigate = useNavigate();
  const { refundId } = useParams();
  const wide = useMedia(WIDE_QUERY);
  const [params, setParams] = useSearchParams();

  const status = STATUS_FILTERS.find((f) => f.value && f.value === params.get('status'))?.value ?? '';
  const type = (REFUND_TYPES as readonly string[]).includes(params.get('type') ?? '') ? params.get('type')! : '';
  const paymentId = params.get('payment') ?? undefined;
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

  const search = params.toString() ? `?${params.toString()}` : '';
  const q: RefundQuery = { page, size, status: status || undefined, type: type || undefined, paymentId };
  const query = useQuery({ queryKey: ['refunds', 'list', q], queryFn: () => listRefunds(q), placeholderData: keepPreviousData });

  const total = query.data?.totalResults ?? 0;
  const list = query.isPending ? (
    <p className="m-0 px-4 py-5 text-muted">Loading…</p>
  ) : query.isError ? (
    <div className="p-3.5">
      <Banner tone="bad">{errorMessage(query.error)}</Banner>
    </div>
  ) : !query.data.results?.length ? (
    <p className="m-0 px-4 py-5 text-muted">No refunds match.</p>
  ) : (
    <Rows<Refund>
      label="Refunds"
      rows={query.data.results}
      rowKey={(r) => r.id!}
      columns={COLUMNS}
      grid="grid-cols-[1.1fr_1.3fr_1fr_0.9fr_0.8fr_1.1fr]"
      minWidth={900}
      linkFor={(r) => `/refunds/${r.id}${search}`}
      sub={(r) => `${refundMember(r)} · ${r.type} · ${formatIn(r.amount, r.currency)} · since ${formatDate(r.refundedAt)}`}
    />
  );

  return (
    <>
      <PageHeader />
      <div className="flex flex-col gap-3.5">
        <Muted>Nothing is refunded automatically. Admins pay refunds outside the system, then record them here.</Muted>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((f) => (
              <Chip key={f.label} on={status === f.value} onClick={() => update({ status: f.value })}>
                {f.label}
              </Chip>
            ))}
          </div>
          <select aria-label="Type" value={type} onChange={(e) => update({ type: e.target.value })} className="min-h-9 rounded-ctl border border-ctl bg-surface px-2 text-ink">
            <option value="">All types</option>
            {REFUND_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {paymentId ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface py-0.5 pl-3 pr-1 text-sm">
              On one payment
              <Button variant="ghost" size="icon" className="size-7" aria-label="Show refunds on every payment" title="Show refunds on every payment" onClick={() => update({ payment: undefined })}>
                <X />
              </Button>
            </span>
          ) : null}
        </div>
        <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface', query.isFetching && !query.isPending && 'opacity-70')} aria-busy={query.isFetching}>
          {list}
          {total > 0 ? <Pager page={page} size={size} total={total} onPage={(p) => update({ page: p })} onSize={(s) => update({ size: s })} /> : null}
        </section>
      </div>

      <Sheet open={!!refundId} onClose={() => navigate(`/refunds${search}`)} title="Refund details" wide={wide}>
        {refundId ? <RefundDetail refundId={refundId} listed={query.data?.results?.find((r) => r.id === refundId)} /> : null}
      </Sheet>
    </>
  );
}

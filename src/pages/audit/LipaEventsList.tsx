import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { listLipaEvents, type LipaEvent, type LipaEventQuery } from '@/api/audit';
import { errorMessage } from '@/api/errors';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pager, PAGE_SIZES } from '@/components/ui/pager';
import { Muted, StatusPill } from '@/components/ui/parts';
import { Rows, type Column } from '@/components/ui/rows';
import { formatDateTime, formatUsdt, zoneLabel } from '@/lib/format';
import { LIPA_STATUSES, lipaSource, lipaStatus } from '@/lib/labels';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { useGrants } from '@/session/SessionProvider';

// C6: what the Lipa API told the GP API about quote payments, by its signed callback or our status check. The backend
// keeps these beside the audit log rather than in it, so they have their own tab and filters.

const DEFAULT_SIZE = 25;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const FILTERS = ['source', 'status', 'quote', 'payment', 'from', 'to'] as const;
const SOURCES = [
  { value: 'callback', label: 'Callbacks' },
  { value: 'status_check', label: 'Status checks' }
];
const selectClass = 'min-h-9 rounded-ctl border border-ctl bg-surface px-2 text-ink';
const short = (v: string | undefined) => (v && v.length > 18 ? `${v.slice(0, 10)}…${v.slice(-6)}` : v);

function What({ e }: { e: LipaEvent }) {
  if (e.status === 'FAILED')
    return (
      <span className="flex flex-col">
        <span className="font-mono text-[12px]">{e.failureReason ?? 'No reason given'}</span>
        {e.failureMessage ? <span className="text-[12px] text-muted">Member told: {e.failureMessage}</span> : null}
      </span>
    );
  return e.txHash ? (
    <span className="font-mono text-[12px]" title={e.txHash}>
      {short(e.txHash)}
    </span>
  ) : (
    <span className="text-muted">—</span>
  );
}

export function LipaEventsList() {
  const grants = useGrants();
  const [params, setParams] = useSearchParams();
  const source = SOURCES.some((s) => s.value === params.get('source')) ? params.get('source')! : '';
  const status = LIPA_STATUSES.includes(params.get('status') ?? '') ? params.get('status')! : '';
  const quote = params.get('quote') ?? '';
  const payment = params.get('payment') ?? '';
  const from = DAY.test(params.get('from') ?? '') ? params.get('from')! : '';
  const to = DAY.test(params.get('to') ?? '') ? params.get('to')! : '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const sizeParam = Number(params.get('size'));
  const size = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : DEFAULT_SIZE;
  const filtered = FILTERS.some((f) => params.get(f));

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

  // as on the log: typed filters wait for a pause, then go in the address
  const [quoteText, setQuoteText] = React.useState(quote);
  const [paymentText, setPaymentText] = React.useState(payment);
  React.useEffect(() => {
    if (quoteText.trim().toUpperCase() === quote && paymentText.trim() === payment) return;
    const t = setTimeout(() => update({ quote: quoteText.trim().toUpperCase(), payment: paymentText.trim() }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteText, paymentText, params.toString()]);
  React.useEffect(() => setQuoteText(quote), [quote]);
  React.useEffect(() => setPaymentText(payment), [payment]);

  const q: LipaEventQuery = { page, size, source: source || undefined, status: status || undefined, quoteId: quote || undefined, paymentId: payment || undefined, from: from || undefined, to: to || undefined };
  const query = useQuery({ queryKey: ['audit', 'lipa', q], queryFn: () => listLipaEvents(q), placeholderData: keepPreviousData });

  const quotes = can(grants, 'GUARANTEES.READ');
  const quoteCell = (e: LipaEvent) =>
    quotes && e.quoteId ? (
      <Link to={`/guarantees/quotes/${e.quoteId}?tab=lipa`} className="font-mono text-[13px] font-medium text-ink-strong underline underline-offset-4">
        {e.quoteId}
      </Link>
    ) : (
      <span className="font-mono text-[13px]">{e.quoteId ?? '—'}</span>
    );
  const paymentButton = (e: LipaEvent) => (
    <button type="button" className="text-left font-mono text-[12px] text-ink-strong underline-offset-4 hover:underline [overflow-wrap:anywhere]" title="Show only this attempt" onClick={() => update({ payment: e.paymentId })}>
      {e.paymentId}
    </button>
  );
  const columns: Column<LipaEvent>[] = [
    { header: 'Received', cell: (e) => formatDateTime(e.receivedAt) },
    { header: 'How', cell: (e) => lipaSource(e.source) },
    { header: 'Quote', cell: quoteCell },
    { header: 'Payment ID', cell: paymentButton },
    { header: 'Amount', cell: (e) => (e.amount ? formatUsdt(e.amount, { full: true }) : '—'), figure: true },
    { header: 'Transaction or failure', cell: (e) => <What e={e} /> },
    { header: 'Status', cell: (e) => <StatusPill label={lipaStatus(e.status)} /> }
  ];

  const total = query.data?.totalResults ?? 0;
  const list = query.isPending ? (
    <p className="m-0 px-4 py-5 text-muted">Loading…</p>
  ) : query.isError ? (
    <div className="p-3.5">
      <Banner tone="bad">{errorMessage(query.error)}</Banner>
    </div>
  ) : !query.data.results?.length ? (
    <p className="m-0 px-4 py-5 text-muted">{filtered ? 'Nothing matches.' : 'No callbacks or status checks yet.'}</p>
  ) : (
    <Rows<LipaEvent>
      label="Lipa API callbacks and status checks"
      rows={query.data.results}
      rowKey={(e) => e.id!}
      columns={columns}
      grid="grid-cols-[0.95fr_0.65fr_0.85fr_1fr_0.85fr_1.3fr_0.75fr]"
      minWidth={920}
      // the phone shows only this line, so the quote link and the attempt's filter are here too
      sub={(e) => (
        <>
          {lipaSource(e.source)} for {quoteCell(e)}
          {' · '}
          {[e.amount ? formatUsdt(e.amount, { full: true }) : null, e.status === 'FAILED' ? e.failureReason : short(e.txHash), `received ${formatDateTime(e.receivedAt)}`].filter(Boolean).join(' · ')}
          {' · payment '}
          {paymentButton(e)}
        </>
      )}
    />
  );

  return (
    <div className="flex flex-col gap-3.5">
      <Muted>
        What the Lipa API reported about each quote payment, by its signed callback or by our status check, newest first. A status already stored for an attempt isn't stored again. Times are in {zoneLabel()}.
      </Muted>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="How" value={source} onChange={(e) => update({ source: e.target.value })} className={selectClass}>
          <option value="">Callbacks and status checks</option>
          {SOURCES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select aria-label="Status" value={status} onChange={(e) => update({ status: e.target.value })} className={selectClass}>
          <option value="">Every status</option>
          {LIPA_STATUSES.map((s) => (
            <option key={s} value={s}>
              {lipaStatus(s).text}
            </option>
          ))}
        </select>
        <Input aria-label="Quote ID" placeholder="Quote ID (GPQ-…)" value={quoteText} onChange={(e) => setQuoteText(e.target.value)} className="max-w-[200px] flex-[1_1_160px] font-mono" />
        <Input aria-label="Payment ID" placeholder="Payment ID" value={paymentText} onChange={(e) => setPaymentText(e.target.value)} className="max-w-[240px] flex-[1_1_180px] font-mono" />
        <label className="flex items-center gap-1.5">
          <span className="text-muted">From</span>
          <Input type="date" aria-label="From" value={from} max={to || undefined} onChange={(e) => update({ from: e.target.value })} className="w-auto" />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted">to</span>
          <Input type="date" aria-label="To" value={to} min={from || undefined} onChange={(e) => update({ to: e.target.value })} className="w-auto" />
        </label>
        {filtered ? (
          <Button variant="outline" onClick={() => update(Object.fromEntries(FILTERS.map((f) => [f, undefined])))}>
            Clear the filters
          </Button>
        ) : null}
      </div>
      <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface', query.isFetching && !query.isPending && 'opacity-70')} aria-busy={query.isFetching}>
        {list}
        {total > 0 ? <Pager page={page} size={size} total={total} onPage={(p) => update({ page: p })} onSize={(s) => update({ size: s })} /> : null}
      </section>
    </div>
  );
}

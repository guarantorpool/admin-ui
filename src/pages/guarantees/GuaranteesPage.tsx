import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { errorMessage } from '@/api/errors';
import type { Page } from '@/api/members';
import { listGuarantees, listQuotes, type Guarantee, type GuaranteeQuery, type Quote } from '@/api/guarantees';
import { PageHeader } from '@/components/shell/AppShell';
import { Badge, Banner } from '@/components/ui/badge';
import { Chip } from '@/components/ui/chip';
import { Pager, PAGE_SIZES } from '@/components/ui/pager';
import { StatusPill } from '@/components/ui/parts';
import { Rows, type Column } from '@/components/ui/rows';
import { Sheet } from '@/components/ui/sheet';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { formatDate, formatDateTime, formatNumber, formatUsdt } from '@/lib/format';
import { guaranteeStatus, quoteStatus } from '@/lib/labels';
import { can } from '@/lib/permissions';
import { useMedia, WIDE_QUERY } from '@/lib/useMedia';
import { cn } from '@/lib/utils';
import { NoAccess } from '@/pages/Placeholders';
import { useGrants } from '@/session/SessionProvider';
import { FindBox } from './FindBox';
import { GuaranteeDetail } from './GuaranteeDetail';
import { QuoteDetail } from './QuoteDetail';

// Screens 6 and 7. Both lists come newest first. Rows are named by business ID (GPG-…, GPQ-…); a guarantee
// row carries its member's ID only, so the member is chosen in the find box rather than shown per row.

const PAGE_TABS = [
  { value: 'guarantees', label: 'Guarantees' },
  { value: 'quotes', label: 'Quotes' }
] as const;

interface Filter {
  value: string;
  label: string;
}

// "flagged" is its own filter in the API (premium below expected loss); here it's one of the chips
const GUARANTEE_FILTERS: Filter[] = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'in_claim', label: 'In claim' },
  { value: 'closed', label: 'Closed' },
  { value: 'flagged', label: 'Flagged' }
];

const QUOTE_FILTERS: Filter[] = [
  { value: '', label: 'All' },
  { value: 'quoted', label: 'Open' },
  { value: 'paid', label: 'Paid' },
  { value: 'replaced', label: 'Replaced' },
  { value: 'expired', label: 'Expired' },
  { value: 'flagged', label: 'Flagged' }
];

const DEFAULT_SIZE = 25;
const usdt = (v: string | undefined) => formatUsdt(v);
const flag = (flagged: boolean | undefined) => (flagged ? <Badge tone="bad">Flagged</Badge> : null);

function GuaranteeStatusCell({ g }: { g: Guarantee }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StatusPill label={guaranteeStatus(g.status)} />
      {g.pendingClose ? <Badge tone="warn">Close entered</Badge> : null}
      {flag(g.flagged)}
    </span>
  );
}

const GUARANTEE_COLUMNS: Column<Guarantee>[] = [
  { header: 'Guarantee', cell: (g) => g.guaranteeId },
  { header: 'Amount', cell: (g) => usdt(g.amount), figure: true },
  { header: 'Tenure', cell: (g) => `${formatNumber(g.tenureMonths)} months` },
  { header: 'Premium', cell: (g) => usdt(g.premiumAmount), figure: true },
  { header: 'Active from', cell: (g) => formatDate(g.activatedAt) },
  { header: 'Status', cell: (g) => <GuaranteeStatusCell g={g} /> }
];

const QUOTE_COLUMNS: Column<Quote>[] = [
  { header: 'Quote', cell: (q) => q.quoteId },
  { header: 'Member number', cell: (q) => q.memberId },
  { header: 'Guarantee amount', cell: (q) => usdt(q.guaranteeAmount), figure: true },
  { header: 'Amount due', cell: (q) => usdt(q.invoice?.amountDue), figure: true },
  { header: 'Ends', cell: (q) => formatDateTime(q.validUntil) },
  {
    header: 'Status',
    cell: (q) => (
      <span className="flex flex-wrap items-center gap-1.5">
        <StatusPill label={quoteStatus(q.status)} />
        {flag(q.flagged)}
      </span>
    )
  }
];

export function GuaranteesPage() {
  const grants = useGrants();
  if (!can(grants, 'GUARANTEES.READ')) return <NoAccess />;
  return <Guarantees />;
}

function Guarantees() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { guaranteeId, quoteId } = useParams();
  const wide = useMedia(WIDE_QUERY);
  const [params, setParams] = useSearchParams();
  const pageTab = pathname === '/guarantees/quotes' || pathname.startsWith('/guarantees/quotes/') ? 'quotes' : 'guarantees';
  const base = pageTab === 'quotes' ? '/guarantees/quotes' : '/guarantees';
  const filters = pageTab === 'quotes' ? QUOTE_FILTERS : GUARANTEE_FILTERS;

  const filter = filters.find((f) => f.value && f.value === params.get('status'))?.value ?? '';
  const memberId = params.get('member') ?? undefined;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const sizeParam = Number(params.get('size'));
  const size = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : DEFAULT_SIZE;
  const tab = params.get('tab') ?? 'overview';

  /** Changes some values; any change but the page or the open record's tab goes back to page 1. */
  const update = (changes: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === undefined || v === '' || (k === 'page' && v === 1) || (k === 'size' && v === DEFAULT_SIZE) || (k === 'tab' && v === 'overview')) next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in changes) && !('tab' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  /** The list's own values, without the open record's tab, for links that keep the list as it is. */
  const listSearch = (keep = params) => {
    const next = new URLSearchParams(keep);
    next.delete('tab');
    const s = next.toString();
    return s ? `?${s}` : '';
  };

  const q: GuaranteeQuery = { page, size, memberId, status: filter === 'flagged' ? undefined : filter || undefined, flagged: filter === 'flagged' || undefined };
  const query = useQuery<Page<Guarantee | Quote>>({
    queryKey: [pageTab, 'list', q],
    queryFn: () => (pageTab === 'quotes' ? listQuotes(q) : listGuarantees(q)),
    placeholderData: keepPreviousData
  });

  // switching between guarantees and quotes keeps the member, but not the status or the page
  const switchTab = (t: string) => {
    const keep = new URLSearchParams();
    if (memberId) keep.set('member', memberId);
    navigate(`${t === 'quotes' ? '/guarantees/quotes' : '/guarantees'}${listSearch(keep)}`);
  };

  const total = query.data?.totalResults ?? 0;
  const empty = pageTab === 'quotes' ? 'No quotes match.' : 'No guarantees match.';
  const list = query.isPending ? (
    <p className="m-0 px-4 py-5 text-muted">Loading…</p>
  ) : query.isError ? (
    <div className="p-3.5">
      <Banner tone="bad">{errorMessage(query.error)}</Banner>
    </div>
  ) : !query.data.results?.length ? (
    <p className="m-0 px-4 py-5 text-muted">{empty}</p>
  ) : pageTab === 'quotes' ? (
    <Rows<Quote>
      label="Quotes"
      rows={query.data.results as Quote[]}
      rowKey={(r) => r.quoteId!}
      columns={QUOTE_COLUMNS}
      grid="grid-cols-[0.9fr_0.9fr_1fr_0.9fr_1fr_1fr]"
      minWidth={820}
      linkFor={(r) => `/guarantees/quotes/${r.quoteId}${listSearch()}`}
      sub={(r) => `${r.memberId} · ${usdt(r.guaranteeAmount)} · ${usdt(r.invoice?.amountDue)} due · ends ${formatDateTime(r.validUntil)}`}
    />
  ) : (
    <Rows<Guarantee>
      label="Guarantees"
      rows={query.data.results as Guarantee[]}
      rowKey={(r) => r.guaranteeId!}
      columns={GUARANTEE_COLUMNS}
      grid="grid-cols-[1.1fr_1fr_0.7fr_0.8fr_0.8fr_1.2fr]"
      minWidth={820}
      linkFor={(r) => `/guarantees/${r.guaranteeId}${listSearch()}`}
      sub={(r) => `${usdt(r.amount)} · ${formatNumber(r.tenureMonths)} months · ${usdt(r.premiumAmount)} premium`}
    />
  );

  const open = pageTab === 'quotes' ? quoteId : guaranteeId;

  return (
    <>
      <PageHeader />
      <Tabs label="Guarantees and quotes" idPrefix="guarantees-page" tabs={PAGE_TABS} value={pageTab} onChange={switchTab} />
      <TabPanel idPrefix="guarantees-page" value={pageTab} className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-start gap-2">
          <FindBox key={pageTab} kind={pageTab === 'quotes' ? 'quote' : 'guarantee'} memberId={memberId} onMember={(id) => update({ member: id })} onOpen={(path) => navigate(path)} />
          <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
            {filters.map((f) => (
              <Chip key={f.label} on={filter === f.value} onClick={() => update({ status: f.value })}>
                {f.label}
              </Chip>
            ))}
          </div>
        </div>
        <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface', query.isFetching && !query.isPending && 'opacity-70')} aria-busy={query.isFetching}>
          {list}
          {total > 0 ? <Pager page={page} size={size} total={total} onPage={(p) => update({ page: p })} onSize={(s) => update({ size: s })} /> : null}
        </section>
      </TabPanel>

      <Sheet open={!!open} onClose={() => navigate(`${base}${listSearch()}`)} title={pageTab === 'quotes' ? 'Quote details' : 'Guarantee details'} wide={wide}>
        {pageTab === 'quotes' && quoteId ? <QuoteDetail quoteId={quoteId} tab={tab} onTab={(t) => update({ tab: t })} /> : null}
        {pageTab === 'guarantees' && guaranteeId ? <GuaranteeDetail guaranteeId={guaranteeId} tab={tab} onTab={(t) => update({ tab: t })} /> : null}
      </Sheet>
    </>
  );
}

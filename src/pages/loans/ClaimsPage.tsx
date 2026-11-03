import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { errorMessage } from '@/api/errors';
import { getClaimLiquidity, listClaims, listLoans, type Claim, type Loan, type LoanQuery } from '@/api/loans';
import { PageHeader } from '@/components/shell/AppShell';
import { Badge, Banner } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { Pager, PAGE_SIZES } from '@/components/ui/pager';
import { Bars, Muted, StatTiles } from '@/components/ui/parts';
import { Rows, type Column } from '@/components/ui/rows';
import { Sheet } from '@/components/ui/sheet';
import { Tabs } from '@/components/ui/tabs';
import { formatDate, formatNumber, formatUsdt } from '@/lib/format';
import { stepName } from '@/lib/labels';
import { can } from '@/lib/permissions';
import { useMedia, WIDE_QUERY } from '@/lib/useMedia';
import { cn } from '@/lib/utils';
import { NoAccess } from '@/pages/Placeholders';
import { useGrants } from '@/session/SessionProvider';
import { LoanDetail } from './LoanDetail';
import { LoanStatusCell } from './LoansPage';

// Screen 9. Claims are paid from Liquid Funds only, never from members' backing assets, and only once the default
// is verified and claim_waiting_days have passed. Each claim opens its loan, where it's verified, paid and recovered.

const PAGE_TABS = [
  { value: 'waiting', label: 'Waiting for payout' },
  { value: 'defaults', label: 'Every default' }
];

const DEFAULT_SIZE = 25;

/** Where a waiting claim is: not verified, in its waiting period, ready to pay, or with a step entered. */
function ClaimStatus({ c }: { c: Claim }) {
  const ready = c.payableFrom && new Date(c.payableFrom).getTime() <= Date.now();
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {!c.verified ? <Badge tone="bad">Not verified</Badge> : ready ? <Badge tone="warn">Ready to pay</Badge> : <Badge tone="neutral">In waiting period</Badge>}
      {c.pendingAction ? <Badge tone="warn">{stepName(c.pendingAction)}: waiting</Badge> : null}
    </span>
  );
}

const WAITING_COLUMNS: Column<Claim>[] = [
  { header: 'Guarantee', cell: (c) => c.guaranteeId ?? '—' },
  { header: 'Lender', cell: (c) => c.lender ?? '—' },
  { header: 'Default', cell: (c) => `${formatDate(c.defaultedAt)}, ${formatNumber(c.daysWaiting)} days ago` },
  { header: 'Claim', cell: (c) => formatUsdt(c.claim), figure: true },
  { header: 'Can be paid from', cell: (c) => formatDate(c.payableFrom) },
  { header: 'Status', cell: (c) => <ClaimStatus c={c} /> }
];

const DEFAULT_COLUMNS: Column<Loan>[] = [
  { header: 'Guarantee', cell: (l) => l.guaranteeId ?? '—' },
  { header: 'Lender', cell: (l) => l.lender ?? '—' },
  { header: 'Default', cell: (l) => formatDate(l.defaultedAt) },
  { header: 'Claim paid', cell: (l) => (l.claimPaid ? formatUsdt(l.claimPaid) : 'Not yet'), figure: true },
  { header: 'Recovered', cell: (l) => (l.claimPaid ? formatUsdt(l.recovered ?? '0') : '—'), figure: true },
  { header: 'Status', cell: (l) => <LoanStatusCell l={l} /> }
];

export function ClaimsPage() {
  const grants = useGrants();
  if (!can(grants, 'GUARANTEES.READ')) return <NoAccess />;
  return <Claims />;
}

function Claims() {
  const navigate = useNavigate();
  const { loanId } = useParams();
  const wide = useMedia(WIDE_QUERY);
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'defaults' ? 'defaults' : 'waiting';
  const tab = params.get('tab') ?? '';

  const update = (changes: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === undefined || v === '' || (k === 'page' && v === 1) || (k === 'size' && v === DEFAULT_SIZE) || (k === 'tab' && v === 'overview') || (k === 'view' && v === 'waiting')) next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in changes) && !('tab' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  const listParams = new URLSearchParams(params);
  listParams.delete('tab');
  const search = listParams.toString() ? `?${listParams.toString()}` : '';

  return (
    <>
      <PageHeader />
      <div className="flex flex-col gap-3.5">
        <Muted>Claims are paid from Liquid Funds only, never from members' backing assets. A claim is paid once its default is verified and the waiting period has passed.</Muted>
        <Tabs label="Claims" idPrefix="claims" tabs={PAGE_TABS} value={view} onChange={(v) => update({ view: v, page: undefined })} />
        <div role="tabpanel" id={`claims-panel-${view}`} aria-labelledby={`claims-tab-${view}`} className="flex flex-col gap-3.5">
          {view === 'waiting' ? <Waiting search={search} /> : <Defaults search={search} params={params} update={update} />}
        </div>
      </div>
      <Sheet open={!!loanId} onClose={() => navigate(`/claims${search}`)} title="Claim details" wide={wide}>
        {loanId ? <LoanDetail loanId={loanId} tab={tab} onTab={(t) => update({ tab: t })} /> : null}
      </Sheet>
    </>
  );
}

function Waiting({ search }: { search: string }) {
  const claims = useQuery({ queryKey: ['claims', 'list'], queryFn: listClaims });
  const liquidity = useQuery({ queryKey: ['claims', 'liquidity'], queryFn: getClaimLiquidity });
  const lf = liquidity.data;
  const total = Number(lf?.totalClaims ?? 0);
  const funds = Number(lf?.liquidFunds ?? 0);
  // both bars on one scale, the larger of the two, so a shortfall shows as the gap between them
  const scale = Math.max(total, funds);

  return (
    <>
      <div className="grid gap-3.5 lg:grid-cols-[5fr_7fr]">
        <Card>
          <CardHeader title="Waiting claims against Liquid Funds" />
          {liquidity.isError ? (
            <Banner tone="bad">{errorMessage(liquidity.error)}</Banner>
          ) : !lf ? (
            <Muted>Loading…</Muted>
          ) : (
            <>
              <StatTiles
                tiles={[
                  { label: 'Waiting claims', value: formatNumber(lf.totalClaims, 2), unit: 'USDT', note: `${formatNumber(lf.claimsWaiting)} ${lf.claimsWaiting === 1 ? 'claim' : 'claims'}` },
                  { label: 'Liquid Funds', value: formatNumber(lf.liquidFunds, 2), unit: 'USDT', note: lf.covered ? 'Enough to pay every waiting claim' : 'Not enough to pay every waiting claim' }
                ]}
              />
              {!lf.covered ? <Banner tone="bad">Short by {formatUsdt(lf.shortfall)}. Record a top-up of Liquid Funds under Pool health before paying every claim.</Banner> : null}
            </>
          )}
        </Card>
        <Card>
          <CardHeader title="Waiting claims next to Liquid Funds" />
          {lf ? (
            <Bars
              bars={[
                { label: 'Waiting claims', value: formatUsdt(lf.totalClaims), pct: scale > 0 ? (total / scale) * 100 : 0 },
                { label: 'Liquid Funds', value: formatUsdt(lf.liquidFunds), pct: scale > 0 ? (funds / scale) * 100 : 0 }
              ]}
            />
          ) : (
            <Muted>Loading…</Muted>
          )}
        </Card>
      </div>
      <section className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface">
        <h2 className="m-0 border-b border-line px-4 py-3 font-heading text-[15px] font-bold">Oldest default first</h2>
        {claims.isPending ? (
          <p className="m-0 px-4 py-5 text-muted">Loading…</p>
        ) : claims.isError ? (
          <div className="p-3.5">
            <Banner tone="bad">{errorMessage(claims.error)}</Banner>
          </div>
        ) : !claims.data.length ? (
          <p className="m-0 px-4 py-5 text-muted">No claims are waiting.</p>
        ) : (
          <Rows<Claim>
            label="Waiting claims"
            rows={claims.data}
            rowKey={(c) => c.loanId!}
            columns={WAITING_COLUMNS}
            grid="grid-cols-[1.2fr_1fr_1.1fr_0.9fr_0.9fr_1.3fr]"
            minWidth={900}
            linkFor={(c) => `/claims/${c.loanId}${search}`}
            sub={(c) => `${c.lender ?? '—'} · ${formatUsdt(c.claim)} · payable from ${formatDate(c.payableFrom)}`}
          />
        )}
      </section>
    </>
  );
}

/** Every defaulted guaranteed loan, newest first: claims waiting, paid and recovering, recovered or written off. */
function Defaults({ search, params, update }: { search: string; params: URLSearchParams; update: (c: Record<string, string | number | undefined>) => void }) {
  const page = Math.max(1, Number(params.get('page')) || 1);
  const sizeParam = Number(params.get('size'));
  const size = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : DEFAULT_SIZE;
  const q: LoanQuery = { page, size, status: 'defaulted', source: 'guaranteed' };
  const query = useQuery({ queryKey: ['loans', 'list', q], queryFn: () => listLoans(q), placeholderData: keepPreviousData });
  const total = query.data?.totalResults ?? 0;
  return (
    <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface', query.isFetching && !query.isPending && 'opacity-70')} aria-busy={query.isFetching}>
      {query.isPending ? (
        <p className="m-0 px-4 py-5 text-muted">Loading…</p>
      ) : query.isError ? (
        <div className="p-3.5">
          <Banner tone="bad">{errorMessage(query.error)}</Banner>
        </div>
      ) : !query.data.results?.length ? (
        <p className="m-0 px-4 py-5 text-muted">No loan has defaulted.</p>
      ) : (
        <Rows<Loan>
          label="Defaults"
          rows={query.data.results}
          rowKey={(l) => l.loanId!}
          columns={DEFAULT_COLUMNS}
          grid="grid-cols-[1.2fr_1fr_0.8fr_0.9fr_0.9fr_1.4fr]"
          minWidth={900}
          linkFor={(l) => `/claims/${l.loanId}${search}`}
          sub={(l) => `${l.lender ?? '—'} · ${l.claimPaid ? `${formatUsdt(l.claimPaid)} paid, ${formatUsdt(l.recovered ?? '0')} recovered` : 'claim not paid yet'}`}
        />
      )}
      {total > 0 ? <Pager page={page} size={size} total={total} onPage={(p) => update({ page: p })} onSize={(s) => update({ size: s })} /> : null}
    </section>
  );
}

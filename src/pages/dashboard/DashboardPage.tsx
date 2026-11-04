import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listAlerts } from '@/api/alerts';
import { approvalCountKey, getApprovalCount, listApprovals } from '@/api/approvals';
import { errorMessage } from '@/api/errors';
import { listGuarantees, listQuotes } from '@/api/guarantees';
import { getClaimLiquidity } from '@/api/loans';
import { listPayments } from '@/api/payments';
import { getBookRatio, getPoolCharts, getUnderwritingInputs, getUtilization, type Figure, type PoolCharts } from '@/api/pool';
import { listRefunds } from '@/api/refunds';
import { PageHeader } from '@/components/shell/AppShell';
import { findScreen } from '@/components/shell/nav';
import { Banner } from '@/components/ui/badge';
import { Muted } from '@/components/ui/parts';
import { dayInZone, formatDateTime, formatNumber, formatUsdt } from '@/lib/format';
import { alertLevel, approvalKind, guaranteeStatus, percent } from '@/lib/labels';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { useGrants } from '@/session/SessionProvider';
import { BarList, ChartTable, ColumnChart, Legend, SERIES_COLORS, TimeChart, type Series } from './charts';

// Screen 2, built last (Phase D): what needs attention and the pool at a glance. Every figure is one the other
// screens show, and each opens its screen. A part the admin's role can't read is left out, not shown empty. The
// charts come from GET /pool/charts, over the last 12 months.

const REFUSED_DAYS = 30;
// the wireframe's mosaic on a 12-column grid when wide, two columns in between, one on a phone
const span = {
  attention: 'md:col-span-12 min-[1200px]:col-span-8',
  pool: 'md:col-span-6 min-[1200px]:col-span-4 min-[1200px]:row-span-2',
  liquid: 'md:col-span-6 min-[1200px]:col-span-8',
  risk: 'md:col-span-6 min-[1200px]:col-span-4',
  money: 'md:col-span-6 min-[1200px]:col-span-4',
  premiums: 'md:col-span-12 min-[1200px]:col-span-4',
  waiting: 'md:col-span-6 min-[1200px]:col-span-7',
  status: 'md:col-span-6 min-[1200px]:col-span-5',
  backing: 'md:col-span-6 min-[1200px]:col-span-5',
  alerts: 'md:col-span-6 min-[1200px]:col-span-7'
};
const smallCaps = 'text-[11px] font-semibold uppercase tracking-[0.1em] text-muted';

const num = (v: string | number | null | undefined) => Number(v ?? 0) || 0;
const usdt = (v: number) => `${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
// days and months come as Nairobi calendar dates; read them as UTC so no zone moves them
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const dayTick = (d: string) => utc(d).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const dayTitle = (d: string) => utc(d).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const monthTick = (m: string) => utc(`${m}-01`).toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'short' });
const monthTitle = (m: string) => utc(`${m}-01`).toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });

function Section({ title, className, actions, children }: { title: string; className?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className={cn('flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="m-0 text-base font-bold">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

interface Metric {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  to: string;
  tone?: 'bad' | 'warn';
}

/** A figure that opens its screen, or just the figure when the role can't open that screen. */
function MetricLink({ m, linked }: { m: Metric; linked: boolean }) {
  const tile = 'flex min-w-0 flex-col gap-0.5 rounded-ctl border border-line px-3 py-2.5';
  const inner = (
    <>
      <span className={smallCaps}>{m.label}</span>
      <span className="flex flex-wrap items-baseline gap-1.5">
        <span className={cn('font-heading text-[22px] font-semibold text-ink-strong', m.tone === 'bad' && 'text-bad-fg', m.tone === 'warn' && 'text-warn-fg')}>{m.value}</span>
        {m.unit ? <span className="text-xs text-muted">{m.unit}</span> : null}
      </span>
      {m.note ? <span className="text-xs text-muted">{m.note}</span> : null}
    </>
  );
  if (!linked) return <div className={tile}>{inner}</div>;
  return (
    <Link to={m.to} title={m.note} className={cn(tile, 'text-inherit no-underline hover:border-line-2 hover:bg-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary')}>
      {inner}
    </Link>
  );
}

function Metrics({ items, columns = 'grid-cols-[repeat(auto-fit,minmax(160px,1fr))]' }: { items: (Metric | null)[]; columns?: string }) {
  const grants = useGrants();
  const shown = items.filter((m): m is Metric => !!m);
  const opens = (to: string) => {
    const screen = findScreen(to.split('?')[0]!)?.screen;
    return !!screen && can(grants, screen.access);
  };
  return (
    <div className={cn('grid gap-2.5', columns)}>
      {shown.map((m) => (
        <MetricLink key={m.label} m={m} linked={opens(m.to)} />
      ))}
    </div>
  );
}

const loading = (label: string, to: string): Metric => ({ label, value: '…', to });

/** A chart card with a switch to its table. */
function ChartCard({ title, sub, aside, className, table, empty, children }: { title: string; sub?: string; aside?: React.ReactNode; className?: string; table: React.ReactNode; empty?: string; children: React.ReactNode }) {
  const [asTable, setAsTable] = React.useState(false);
  return (
    <Section
      title={title}
      className={className}
      actions={
        <div className="flex flex-wrap items-center gap-3">
          {aside ? <span className="text-[13px] text-muted">{aside}</span> : null}
          {empty ? null : (
            <button type="button" aria-pressed={asTable} onClick={() => setAsTable((t) => !t)} className="rounded-ctl border border-ctl px-2.5 py-1 text-[13px] font-medium text-ink-strong hover:bg-chip">
              {asTable ? 'Show the chart' : 'Show as a table'}
            </button>
          )}
        </div>
      }
    >
      {sub ? <Muted>{sub}</Muted> : null}
      {empty ? <p className="m-0 rounded-ctl bg-page px-3 py-6 text-center text-muted">{empty}</p> : asTable ? table : children}
    </Section>
  );
}

export function DashboardPage() {
  const grants = useGrants();
  const pool = can(grants, 'POOL.READ');
  const guarantees = can(grants, 'GUARANTEES.READ');
  const alerts = can(grants, 'ALERTS.READ');
  const refunds = can(grants, 'REFUNDS.READ');

  return (
    <>
      <PageHeader />
      <div className="grid grid-cols-1 items-start gap-3.5 md:grid-cols-12">
        <NeedsAttention className={span.attention} guarantees={guarantees} alerts={alerts} />
        {pool ? <PoolHealth className={span.pool} /> : null}
        {pool ? <PoolChartsCards /> : null}
        {pool ? <RiskChecks className={span.risk} /> : null}
        {pool || guarantees || refunds ? <GuaranteesAndMoney className={span.money} pool={pool} guarantees={guarantees} refunds={refunds} /> : null}
        {pool ? <PremiumsChart className={span.premiums} /> : null}
        <WaitingList className={span.waiting} />
        {pool ? <StatusChart className={span.status} guarantees={guarantees} /> : null}
        {pool ? <BackingChart className={span.backing} /> : null}
        {alerts ? <AlertList className={span.alerts} /> : null}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ needs attention

function NeedsAttention({ className, guarantees, alerts }: { className: string; guarantees: boolean; alerts: boolean }) {
  const count = useQuery({ queryKey: approvalCountKey, queryFn: getApprovalCount, refetchInterval: 60_000 });
  const openQ = { page: 1, size: 1, status: 'open' };
  const open = useQuery({ queryKey: ['alerts', 'list', openQ], queryFn: () => listAlerts(openQ), enabled: alerts, refetchInterval: 60_000 });
  const claims = useQuery({ queryKey: ['claims', 'liquidity'], queryFn: getClaimLiquidity, enabled: guarantees });
  const since = dayInZone(new Date(Date.now() - REFUSED_DAYS * 86_400_000));
  const refusedQ = { page: 1, size: 1, status: 'failed', method: 'lipa', from: since };
  const refused = useQuery({ queryKey: ['payments', 'list', refusedQ], queryFn: () => listPayments(refusedQ), enabled: guarantees });

  const c = count.data;
  const l = claims.data;
  const items: (Metric | null)[] = [
    c
      ? { label: 'Waiting for approval', value: formatNumber(c.waiting ?? 0), unit: 'items', note: `${formatNumber(c.forYou ?? 0)} for you to decide`, to: '/approvals', tone: (c.forYou ?? 0) > 0 ? 'warn' : undefined }
      : loading('Waiting for approval', '/approvals'),
    !alerts ? null : open.data ? { label: 'Open alerts', value: formatNumber(open.data.totalResults ?? 0), unit: 'open', note: 'Problems the system reported', to: '/alerts', tone: (open.data.totalResults ?? 0) > 0 ? 'bad' : undefined } : loading('Open alerts', '/alerts'),
    !guarantees
      ? null
      : l
        ? {
            label: 'Claims waiting',
            value: formatNumber(l.claimsWaiting ?? 0),
            unit: formatUsdt(l.totalClaims),
            note: l.covered === false ? `Liquid Funds are ${formatUsdt(l.shortfall)} short` : 'USDT owed to lenders',
            to: '/claims',
            tone: l.covered === false ? 'bad' : (l.claimsWaiting ?? 0) > 0 ? 'warn' : undefined
          }
        : loading('Claims waiting', '/claims'),
    !guarantees
      ? null
      : refused.data
        ? {
            label: 'Refused Lipa payments',
            value: formatNumber(refused.data.totalResults ?? 0),
            unit: `last ${REFUSED_DAYS} days`,
            note: 'Lipa API payments that failed',
            to: `/payments?status=failed&method=lipa&from=${since}`,
            tone: (refused.data.totalResults ?? 0) > 0 ? 'bad' : undefined
          }
        : loading('Refused Lipa payments', `/payments?status=failed&method=lipa&from=${since}`)
  ];
  const failed = [count, open, claims, refused].find((q) => q.isError);
  return (
    <Section title="Needs attention" className={className}>
      {failed ? <Banner tone="bad">{errorMessage(failed.error)}</Banner> : null}
      <Metrics items={items} />
    </Section>
  );
}

// ------------------------------------------------------------------ pool health and risk checks

function PoolHealth({ className }: { className: string }) {
  const util = useQuery({ queryKey: ['pool', 'utilization'], queryFn: getUtilization });
  const inputs = useQuery({ queryKey: ['pool', 'inputs'], queryFn: getUnderwritingInputs });
  const u = util.data;
  const backing = num(u?.totalBackingUsdt);
  const outstanding = num(u?.totalOutstandingGuarantees);
  const items: Metric[] = [
    inputs.data ? { label: 'Liquid Funds', value: formatNumber(inputs.data.liquidFunds?.total, 2), unit: 'USDT', note: 'USDT available to pay claims', to: '/pool/health' } : loading('Liquid Funds', '/pool/health'),
    u
      ? u.valued
        ? { label: 'Total backing', value: formatNumber(u.totalBackingUsdt, 2), unit: 'USDT', note: 'Backing after haircuts', to: '/backing' }
        : { label: 'Total backing', value: '—', note: 'Not valued yet: no prices read', to: '/backing', tone: 'warn' }
      : loading('Total backing', '/backing'),
    u ? { label: 'Outstanding guarantees', value: formatNumber(u.totalOutstandingGuarantees ?? 0, 2), unit: 'USDT', note: 'Active and in-claim guarantees', to: '/guarantees' } : loading('Outstanding guarantees', '/guarantees'),
    u
      ? {
          label: 'Pool utilization',
          value: u.valued && backing > 0 ? percent(outstanding / backing) : '—',
          unit: u.utilizationThreshold ? `target ${percent(u.utilizationThreshold)}` : undefined,
          note: u.valued && backing > 0 ? `${usdt(outstanding)} outstanding against ${usdt(backing)} backing` : 'No backing valued yet',
          to: '/pool/health'
        }
      : loading('Pool utilization', '/pool/health')
  ];
  const failed = [util, inputs].find((q) => q.isError);
  return (
    <Section title="Pool health" className={className}>
      {failed ? <Banner tone="bad">{errorMessage(failed.error)}</Banner> : null}
      <Metrics items={items} columns="grid-cols-1 sm:grid-cols-2 min-[1200px]:grid-cols-1" />
    </Section>
  );
}

function ratio(label: string, f: Figure | undefined): Metric {
  return {
    label,
    value: percent(f?.calculated),
    unit: `setting ${percent(f?.staticValue)}`,
    note: f?.fallback ? 'Not enough data yet, so this is the setting' : f?.toggleOn ? `Quotes use ${percent(f.applied)}` : 'Quotes use the setting',
    to: '/pool/health'
  };
}

function RiskChecks({ className }: { className: string }) {
  const book = useQuery({ queryKey: ['pool', 'book-ratio'], queryFn: getBookRatio });
  const inputs = useQuery({ queryKey: ['pool', 'inputs'], queryFn: getUnderwritingInputs });
  const b = book.data;
  const i = inputs.data;
  const items: Metric[] = [
    b
      ? {
          label: 'Solvency check',
          value: !b.guaranteesCounted ? '—' : b.belowTarget ? 'Below target' : 'Passing',
          unit: b.guaranteesCounted ? `${formatNumber(b.bookRatioShown, 2)} against ${formatNumber(b.target, 2)}` : undefined,
          note: b.guaranteesCounted ? 'Premiums against expected loss, book-wide' : 'No guarantee is active',
          to: '/pool/health',
          tone: b.belowTarget ? 'bad' : undefined
        }
      : loading('Solvency check', '/pool/health'),
    i ? ratio('Base default rate', i.baseDefaultRate) : loading('Base default rate', '/pool/health'),
    i ? ratio('Recovery rate', i.recoveryRate) : loading('Recovery rate', '/pool/health'),
    i ? ratio('Liquidity ratio', i.liquidityRatio) : loading('Liquidity ratio', '/pool/health')
  ];
  const failed = [book, inputs].find((q) => q.isError);
  return (
    <Section title="Risk checks" className={className}>
      {failed ? <Banner tone="bad">{errorMessage(failed.error)}</Banner> : null}
      <Metrics items={items} columns="grid-cols-1 sm:grid-cols-2" />
    </Section>
  );
}

// ------------------------------------------------------------------ guarantees and money

const usePoolCharts = (enabled = true) => useQuery({ queryKey: ['pool', 'charts'], queryFn: getPoolCharts, enabled, staleTime: 5 * 60_000 });

function GuaranteesAndMoney({ className, pool, guarantees, refunds }: { className: string; pool: boolean; guarantees: boolean; refunds: boolean }) {
  const activeQ = { page: 1, size: 1, status: 'active' };
  const active = useQuery({ queryKey: ['guarantees', 'list', activeQ], queryFn: () => listGuarantees(activeQ), enabled: guarantees });
  const flaggedQ = { page: 1, size: 1, flagged: true };
  const flagged = useQuery({ queryKey: ['quotes', 'list', flaggedQ], queryFn: () => listQuotes(flaggedQ), enabled: guarantees });
  const owedQ = { page: 1, size: 1, status: 'owed' };
  const owed = useQuery({ queryKey: ['refunds', 'list', owedQ], queryFn: () => listRefunds(owedQ), enabled: refunds });
  const charts = usePoolCharts(pool);
  const month = charts.data?.months?.at(-1);
  const items: (Metric | null)[] = [
    !guarantees ? null : active.data ? { label: 'Active guarantees', value: formatNumber(active.data.totalResults ?? 0), note: 'Guarantees now active', to: '/guarantees?status=active' } : loading('Active guarantees', '/guarantees'),
    !guarantees
      ? null
      : flagged.data
        ? { label: 'Flagged quotes', value: formatNumber(flagged.data.totalResults ?? 0), note: 'Premium below expected loss', to: '/guarantees/quotes?status=flagged', tone: (flagged.data.totalResults ?? 0) > 0 ? 'warn' : undefined }
        : loading('Flagged quotes', '/guarantees/quotes'),
    !pool ? null : month ? { label: 'Premiums this month', value: formatNumber(month.premiumsReceived, 2), unit: 'USDT', note: `${formatNumber(month.payments ?? 0)} payments in ${monthTitle(month.month!)}`, to: '/payments' } : loading('Premiums this month', '/payments'),
    !refunds ? null : owed.data ? { label: 'Refunds owed', value: formatNumber(owed.data.totalResults ?? 0), note: 'Money owed back to members', to: '/refunds?status=owed', tone: (owed.data.totalResults ?? 0) > 0 ? 'warn' : undefined } : loading('Refunds owed', '/refunds')
  ];
  const failed = [active, flagged, owed, charts].find((q) => q.isError);
  return (
    <Section title="Guarantees and money" className={className}>
      {failed ? <Banner tone="bad">{errorMessage(failed.error)}</Banner> : null}
      <Metrics items={items} columns="grid-cols-1 sm:grid-cols-2" />
    </Section>
  );
}

// ------------------------------------------------------------------ charts

function chartError(q: { isError: boolean; error: unknown; data?: PoolCharts }) {
  return q.isError ? errorMessage(q.error) : !q.data ? 'Loading…' : undefined;
}

function PoolChartsCards() {
  const charts = usePoolCharts();
  const points = charts.data?.liquidFunds ?? [];
  const last = points.at(-1);
  const series: Series[] = [{ label: 'Liquid Funds', color: SERIES_COLORS[0]! }];
  return (
    <ChartCard
      title="Liquid Funds"
      className={span.liquid}
      aside={last ? `${formatUsdt(last.liquidFunds)} on ${dayTitle(last.day!)}` : undefined}
      sub="As each night's calculation stored them: what claims are paid from."
      empty={chartError(charts) ?? (points.length ? undefined : "No night's figure stored yet. Liquid Funds are worked out each night at 03:05.")}
      table={<ChartTable caption="Liquid Funds each night" head={['Day', 'Liquid Funds']} rows={[...points].reverse().map((p) => [dayTitle(p.day!), formatUsdt(p.liquidFunds)])} />}
    >
      <TimeChart label={`Liquid Funds each night over the last 12 months${last ? `, ${formatUsdt(last.liquidFunds)} on ${dayTitle(last.day!)}` : ''}`} series={series} format={usdt} points={points.map((p) => ({ tick: dayTick(p.day!), title: dayTitle(p.day!), values: [num(p.liquidFunds)] }))} />
    </ChartCard>
  );
}

function PremiumsChart({ className }: { className: string }) {
  const charts = usePoolCharts();
  const months = charts.data?.months ?? [];
  const series: Series[] = [
    { label: 'Premiums received', color: SERIES_COLORS[0]! },
    { label: 'Claims paid', color: SERIES_COLORS[1]! }
  ];
  return (
    <ChartCard
      title="Premiums and claims, USDT"
      className={className}
      empty={chartError(charts)}
      table={<ChartTable caption="Premiums received and claims paid each month" head={['Month', 'Premiums', 'Claims paid']} rows={[...months].reverse().map((m) => [monthTitle(m.month!), formatUsdt(m.premiumsReceived), formatUsdt(m.claimsPaid)])} />}
    >
      <Legend series={series} />
      <ColumnChart
        label="Premiums received and claims paid each month over the last 12 months"
        series={series}
        format={usdt}
        groups={months.map((m) => ({ tick: monthTick(m.month!), title: monthTitle(m.month!), values: [num(m.premiumsReceived), num(m.claimsPaid)] }))}
      />
    </ChartCard>
  );
}

const ALWAYS = ['active', 'in_claim', 'closed'];
const LISTED = new Set(['active', 'in_claim', 'closed']);

function StatusChart({ className, guarantees }: { className: string; guarantees: boolean }) {
  const charts = usePoolCharts();
  const navigate = useNavigate();
  // statuses from before Lipa-only payments show only while a guarantee still has one
  const rows = (charts.data?.guaranteesByStatus ?? []).filter((s) => ALWAYS.includes(s.status!) || (s.count ?? 0) > 0);
  return (
    <ChartCard
      title="Guarantees by status"
      className={className}
      sub="How many guarantees have each status now."
      empty={chartError(charts)}
      table={<ChartTable caption="Guarantees by status" head={['Status', 'Guarantees']} rows={rows.map((s) => [guaranteeStatus(s.status).text, formatNumber(s.count ?? 0)])} />}
    >
      <BarList
        label="Guarantees by status"
        rows={rows.map((s) => ({
          label: guaranteeStatus(s.status).text,
          value: s.count ?? 0,
          display: formatNumber(s.count ?? 0),
          onOpen: guarantees && LISTED.has(s.status!) ? () => navigate(`/guarantees?status=${s.status}`) : undefined
        }))}
      />
    </ChartCard>
  );
}

function BackingChart({ className }: { className: string }) {
  const charts = usePoolCharts();
  const days = charts.data?.backing ?? [];
  const last = days.at(-1);
  const series: Series[] = [
    { label: 'Locked BLOCKS', color: SERIES_COLORS[0]! },
    { label: 'KES deposits', color: SERIES_COLORS[1]! },
    { label: 'USDT vault', color: SERIES_COLORS[2]! }
  ];
  const parts = (d: (typeof days)[number]) => [num(d.lockedBlocks), num(d.kesDeposits), num(d.vaultSavings)];
  return (
    <ChartCard
      title="Backing by asset, USDT value"
      className={className}
      aside={last ? `${formatUsdt(last.total)} on ${dayTitle(last.day!)}` : undefined}
      sub="Each asset after its haircut, from each day's last pool calculation."
      empty={chartError(charts) ?? (days.length ? undefined : 'Not kept yet: the split by asset starts with the next pool calculation.')}
      table={<ChartTable caption="Backing by asset each day" head={['Day', 'Locked BLOCKS', 'KES deposits', 'USDT vault', 'Total']} rows={[...days].reverse().map((d) => [dayTitle(d.day!), formatUsdt(d.lockedBlocks), formatUsdt(d.kesDeposits), formatUsdt(d.vaultSavings), formatUsdt(d.total)])} />}
    >
      <Legend series={series} values={last ? [formatUsdt(last.lockedBlocks), formatUsdt(last.kesDeposits), formatUsdt(last.vaultSavings)] : undefined} />
      {days.length > 1 ? (
        <TimeChart label={`Backing by asset each day over the last 12 months${last ? `, ${formatUsdt(last.total)} on ${dayTitle(last.day!)}` : ''}`} series={series} stacked format={usdt} points={days.map((d) => ({ tick: dayTick(d.day!), title: dayTitle(d.day!), values: parts(d) }))} />
      ) : last ? (
        <BarList label="Backing by asset" rows={series.map((s, i) => ({ label: s.label, value: parts(last)[i]!, display: axisCompact(parts(last)[i]!) }))} />
      ) : null}
    </ChartCard>
  );
}

const axisCompact = (v: number) => (v >= 10_000 ? `${Number((v / 1000).toFixed(1)).toLocaleString('en-US')}K` : v.toLocaleString('en-US', { maximumFractionDigits: 2 }));

// ------------------------------------------------------------------ lists

function WaitingList({ className }: { className: string }) {
  const q = { page: 1, size: 4 };
  const list = useQuery({ queryKey: ['approvals', 'list', q], queryFn: () => listApprovals(q), refetchInterval: 60_000 });
  const items = list.data?.results ?? [];
  return (
    <Section title="Waiting for approval" className={className} actions={<Link to="/approvals" className="text-[13px] font-medium text-ink-strong underline underline-offset-4">Open the inbox</Link>}>
      {list.isError ? (
        <Banner tone="bad">{errorMessage(list.error)}</Banner>
      ) : !list.data ? (
        <Muted>Loading…</Muted>
      ) : !items.length ? (
        <Muted>Nothing is waiting for a second admin.</Muted>
      ) : (
        <ul aria-label="Waiting for approval, longest waiting first" className="m-0 flex list-none flex-col p-0">
          {items.map((a) => (
            <li key={`${a.kind}-${a.id}`} className="border-t border-line first:border-t-0">
              <Link to={`/approvals/${a.kind}/${encodeURIComponent(a.id ?? '')}`} className="flex flex-col gap-0.5 rounded-ctl px-1 py-2 text-inherit no-underline hover:bg-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{approvalKind(a.kind)}</span>
                  <span className="text-xs text-muted">{a.canDecide ? 'You can decide' : a.yours ? 'Entered by you' : ''}</span>
                </span>
                <span className="text-muted [overflow-wrap:anywhere]">{a.summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function AlertList({ className }: { className: string }) {
  const q = { page: 1, size: 3, status: 'open' };
  const list = useQuery({ queryKey: ['alerts', 'list', q], queryFn: () => listAlerts(q), refetchInterval: 60_000 });
  const items = list.data?.results ?? [];
  return (
    <Section title="Open alerts" className={className} actions={<Link to="/alerts" className="text-[13px] font-medium text-ink-strong underline underline-offset-4">See every alert</Link>}>
      {list.isError ? (
        <Banner tone="bad">{errorMessage(list.error)}</Banner>
      ) : !list.data ? (
        <Muted>Loading…</Muted>
      ) : !items.length ? (
        <Muted>No open alerts.</Muted>
      ) : (
        <ul aria-label="The latest open alerts" className="m-0 flex list-none flex-col p-0">
          {items.map((a) => (
            <li key={a.id} className="border-t border-line first:border-t-0">
              <Link to={`/alerts/${encodeURIComponent(a.id ?? '')}`} className="flex flex-col gap-0.5 rounded-ctl px-1 py-2 text-inherit no-underline hover:bg-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold [overflow-wrap:anywhere]">{a.summary}</span>
                  <span className="text-xs text-muted">{alertLevel(a.severity).text}</span>
                </span>
                <span className="text-muted">Last seen {formatDateTime(a.lastSeenAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

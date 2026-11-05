import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '@/api/errors';
import { downloadReconciliation, getReconciliation, reconciliationKey, type Flow, type Reconciliation, type ReconciliationItem } from '@/api/pool';
import { PageHeader } from '@/components/shell/AppShell';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Pager } from '@/components/ui/pager';
import { Muted, SectionTitle, StatTiles, StatusPill, type Tile } from '@/components/ui/parts';
import { Rows, type Column } from '@/components/ui/rows';
import { dayInZone, formatAmount, formatDateTime, formatIn, formatNumber, zoneLabel } from '@/lib/format';
import { matchKind, matchStatus } from '@/lib/labels';
import { can } from '@/lib/permissions';
import { NoAccess } from '@/pages/Placeholders';
import { useGrants } from '@/session/SessionProvider';
import { shortAddress } from './PoolWalletsPage';

// #142 Phase E2. Each month, in Nairobi time, what the records say happened (premiums, late payments, refunds, claims,
// sweeps) beside what moved through the pool wallets, read on-chain: a summary with each token's balances, and a
// match list of every premium, late payment and approved sweep, matched or missing on-chain, and every transfer no
// record names. The month can be saved as CSV or XLSX.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const PAGE_SIZE = 25;

type Show = 'all' | 'missing_on_chain' | 'no_record' | 'matched';
const SHOWS: { value: Show; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'missing_on_chain', label: 'Missing on-chain' },
  { value: 'no_record', label: 'No record' },
  { value: 'matched', label: 'Matched' }
];

/** This month in Nairobi, yyyy-MM. */
const thisMonth = () => dayInZone().slice(0, 7);

/** The month a number of months from `month`. */
function shift(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const plural = (n: number | undefined, one: string, many: string) => `${formatNumber(n ?? 0)} ${n === 1 ? one : many}`;

export function ReconciliationPage() {
  const grants = useGrants();
  if (!can(grants, 'POOL.READ')) return <NoAccess />;
  return <ReconciliationScreen />;
}

function ReconciliationScreen() {
  const [params, setParams] = useSearchParams();
  const latest = thisMonth();
  const asked = params.get('month') ?? '';
  const month = MONTH.test(asked) && asked <= latest ? asked : latest;
  const show = (SHOWS.find((s) => s.value === params.get('show'))?.value ?? 'all') as Show;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const query = useQuery({ queryKey: reconciliationKey(month), queryFn: () => getReconciliation(month) });
  const [saving, setSaving] = React.useState<'csv' | 'xlsx' | null>(null);

  const update = (next: { month?: string; show?: Show; page?: number }) => {
    const p = new URLSearchParams(params);
    const set = (k: string, v: string | undefined) => (v ? p.set(k, v) : p.delete(k));
    if (next.month !== undefined) set('month', next.month === latest ? undefined : next.month);
    if (next.show !== undefined) set('show', next.show === 'all' ? undefined : next.show);
    set('page', next.page && next.page > 1 ? String(next.page) : undefined);
    setParams(p, { replace: true });
  };

  const save = async (format: 'csv' | 'xlsx') => {
    setSaving(format);
    try {
      await downloadReconciliation(month, format);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(null);
    }
  };

  const ready = query.isSuccess;
  return (
    <>
      <PageHeader
        actions={
          <>
            <Button variant="outline" disabled={!ready || !!saving} onClick={() => save('csv')}>
              <Download /> {saving === 'csv' ? 'Saving…' : 'Download CSV'}
            </Button>
            <Button variant="outline" disabled={!ready || !!saving} onClick={() => save('xlsx')}>
              <Download /> {saving === 'xlsx' ? 'Saving…' : 'Download XLSX'}
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-3.5">
        <Muted>
          Each month's records beside what moved through the pool wallets, read on-chain. Months run in Nairobi time ({zoneLabel()}). Anything missing on-chain or with no record needs a look.
        </Muted>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Choose the month">
          <Button variant="outline" size="icon" aria-label="Previous month" title="Previous month" onClick={() => update({ month: shift(month, -1) })}>
            <ChevronLeft />
          </Button>
          <Input
            type="month"
            aria-label="Month"
            value={month}
            max={latest}
            onChange={(e) => (MONTH.test(e.target.value) && e.target.value <= latest ? update({ month: e.target.value }) : undefined)}
            className="w-auto"
          />
          <Button variant="outline" size="icon" aria-label="Next month" title="Next month" disabled={month >= latest} onClick={() => update({ month: shift(month, 1) })}>
            <ChevronRight />
          </Button>
        </div>

        {query.isPending ? (
          <p className="m-0 text-muted">Loading the month…</p>
        ) : query.isError ? (
          <Banner tone="bad">{errorMessage(query.error)}</Banner>
        ) : (
          <Report report={query.data} show={show} page={page} onShow={(s) => update({ show: s })} onPage={(p) => update({ page: p })} />
        )}
      </div>
    </>
  );
}

function Report({ report: r, show, page, onShow, onPage }: { report: Reconciliation; show: Show; page: number; onShow: (s: Show) => void; onPage: (p: number) => void }) {
  const items = r.items ?? [];
  const counts: Record<Show, number> = {
    all: items.length,
    missing_on_chain: items.filter((i) => i.status === 'missing_on_chain').length,
    no_record: items.filter((i) => i.status === 'no_record').length,
    matched: items.filter((i) => i.status === 'matched').length
  };
  const shown = show === 'all' ? items : items.filter((i) => i.status === show);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const at = Math.min(page, pages);

  return (
    <>
      {r.complete ? null : (
        <Banner tone="warn">
          {r.readUpTo
            ? `Transfers are read up to ${formatDateTime(r.readUpTo, { zone: true })}, before this month's end. Until they're read past it, something missing on-chain may just not be read yet.`
            : "A pool wallet's transfers haven't been read yet, so this month isn't complete. Until they are, something missing on-chain may just not be read yet."}
        </Banner>
      )}
      <Summary report={r} />
      <section aria-label="Match list" className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface">
        <div className="flex flex-col gap-2.5 px-4 pb-3 pt-4">
          <SectionTitle>Match list</SectionTitle>
          <Muted>Each premium, late payment and approved sweep against the transaction it names, and every transfer through a pool wallet that no record names.</Muted>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
            {SHOWS.map((s) => (
              <Chip key={s.value} on={show === s.value} onClick={() => onShow(s.value)}>
                {s.label} ({formatNumber(counts[s.value])})
              </Chip>
            ))}
          </div>
        </div>
        {!shown.length ? (
          <p className="m-0 border-t border-line px-4 py-5 text-muted">{items.length ? 'Nothing here with this status.' : 'Nothing was recorded or moved through the pool wallets this month.'}</p>
        ) : (
          <>
            <Rows<ReconciliationItem>
              label="Match list"
              rows={shown.slice((at - 1) * PAGE_SIZE, at * PAGE_SIZE)}
              rowKey={(i) => `${i.kind}-${i.txHash}-${i.token}-${i.reference ?? ''}-${i.wallet ?? ''}-${i.direction ?? ''}`}
              columns={COLUMNS}
              grid="grid-cols-[0.8fr_1fr_1.2fr_0.9fr_0.9fr_0.9fr_1fr]"
              minWidth={920}
              sub={(i) => `${formatDateTime(i.at)} · ${what(i)} · ${amounts(i)}`}
            />
            <Pager page={at} size={PAGE_SIZE} total={shown.length} onPage={onPage} />
          </>
        )}
      </section>
    </>
  );
}

/** The quote or sweep a line is about, or for a transfer with no record, where it came from or went. */
function what(i: ReconciliationItem): string {
  if (i.kind === 'transfer') return `${i.direction === 'OUT' ? 'Out to' : 'In from'} ${shortAddress(i.counterparty ?? undefined)}`;
  if (i.kind === 'sweep') return `Sweep ${(i.reference ?? '').slice(0, 8)}`;
  return `Quote ${i.reference ?? '—'}`;
}

const amount = (v: string | null | undefined, token: string | undefined) => (v === null || v === undefined ? '—' : formatIn(v, token, { full: true }));

function amounts(i: ReconciliationItem): string {
  const read = i.onChain === null || i.onChain === undefined ? 'nothing read on-chain' : `${amount(i.onChain, i.token)} on-chain`;
  return i.kind === 'transfer' ? read : `${amount(i.recorded, i.token)} recorded, ${read}`;
}

const COLUMNS: Column<ReconciliationItem>[] = [
  { header: 'What', cell: (i) => matchKind(i.kind) },
  { header: 'When', cell: (i) => formatDateTime(i.at) },
  { header: 'Record', cell: what },
  { header: 'Transaction', cell: (i) => <span className="font-mono text-[13px]" title={i.txHash}>{shortAddress(i.txHash)}</span> },
  { header: 'Recorded', cell: (i) => amount(i.recorded, i.token), figure: true },
  { header: 'On-chain', cell: (i) => amount(i.onChain, i.token), figure: true },
  { header: 'Status', cell: (i) => <StatusPill label={matchStatus(i.status)} /> }
];

function Summary({ report: r }: { report: Reconciliation }) {
  const s = r.summary!;
  const usdt = (label: string, t: { count?: number; amount?: string } | undefined, one: string, many: string): Tile => ({
    label,
    value: formatNumber(t?.amount, 2),
    unit: 'USDT',
    note: plural(t?.count, one, many)
  });
  // refunds are kept apart by currency: one owed on an older KES payment is in KES
  const refunds = (label: string, r: { count?: number; amounts?: { currency?: string; amount?: string }[] } | undefined): Tile => {
    const amounts = r?.amounts ?? [];
    const only = amounts.length <= 1;
    return {
      label,
      value: only ? formatNumber(amounts[0]?.amount ?? '0', 2) : amounts.map((a) => formatIn(a.amount, a.currency)).join(' + '),
      unit: only ? (amounts[0]?.currency ?? 'USDT') : undefined,
      note: plural(r?.count, 'refund', 'refunds')
    };
  };
  const claims = s.claimsPaid;
  const tiles: Tile[] = [
    usdt('Premiums credited', s.premiums, 'payment', 'payments'),
    usdt('Premiums owed back', s.premiumsOwedBack, 'payment', 'payments'),
    usdt('Late payments', s.latePayments, 'to a retired wallet', 'to retired wallets'),
    refunds('Refunds owed', s.refundsOwed),
    refunds('Refunds paid', s.refundsPaid),
    {
      label: 'Claims paid',
      value: formatNumber(claims?.blocks, 2),
      unit: 'BLOCKS',
      note: [plural(claims?.count, 'claim', 'claims'), ...(claims?.payouts ?? []).map((p) => `${formatIn(p.amount, p.currency)} paid`)].join(' · ')
    },
    {
      label: 'Sweeps approved',
      value: formatNumber(s.sweeps?.count ?? 0),
      note: `${formatAmount(s.sweeps?.usdt, 'USDT')} and ${formatAmount(s.sweeps?.blocks, 'BLOCKS')}`
    }
  ];
  const flows: { token: 'USDT' | 'BLOCKS'; flow: Flow }[] = [
    { token: 'USDT', flow: s.usdt! },
    { token: 'BLOCKS', flow: s.blocks! }
  ];
  const col = (header: string, pick: (f: Flow) => string | undefined): Column<(typeof flows)[number]> => ({
    header,
    cell: (row) => formatAmount(pick(row.flow), row.token, { full: true }),
    figure: true
  });

  return (
    <>
      <section aria-label="What the records say" className="flex flex-col gap-3.5 rounded-card border border-line bg-surface p-4">
        <SectionTitle>What the records say</SectionTitle>
        <StatTiles tiles={tiles} />
      </section>
      <section aria-label="Through the pool wallets" className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface">
        <div className="flex flex-col gap-1 px-4 pb-3 pt-4">
          <SectionTitle>Through the pool wallets, read on-chain</SectionTitle>
          <Muted>A sweep from a retired wallet to the current one moves money between pool wallets, so it changes neither the balance nor what came in or went out.</Muted>
        </div>
        <Rows<(typeof flows)[number]>
          label="Balances"
          rows={flows}
          rowKey={(f) => f.token}
          columns={[
            { header: 'Token', cell: (f) => f.token },
            col('Opening', (f) => f.opening),
            col('In from outside', (f) => f.in),
            col('Out to outside', (f) => f.out),
            col('Between pool wallets', (f) => f.internal),
            col('Closing', (f) => f.closing)
          ]}
          grid="grid-cols-[0.6fr_1fr_1fr_1fr_1fr_1fr]"
          minWidth={760}
          sub={(f) =>
            `Opening ${formatAmount(f.flow.opening, f.token, { full: true })} · in ${formatAmount(f.flow.in, f.token, { full: true })} · out ${formatAmount(f.flow.out, f.token, { full: true })} · between pool wallets ${formatAmount(f.flow.internal, f.token, { full: true })}`
          }
        />
      </section>
    </>
  );
}

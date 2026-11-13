import * as React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@/api/errors';
import { listLoans, loanName, type Loan, type LoanQuery } from '@/api/loans';
import { PageHeader } from '@/components/shell/AppShell';
import { Badge, Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Pager, PAGE_SIZES } from '@/components/ui/pager';
import { Muted, StatusPill } from '@/components/ui/parts';
import { Rows, type Column } from '@/components/ui/rows';
import { Sheet } from '@/components/ui/sheet';
import { formatDate, formatIn } from '@/lib/format';
import { loanSource, loanStatus, stepName } from '@/lib/labels';
import { can } from '@/lib/permissions';
import { useMedia, WIDE_QUERY } from '@/lib/useMedia';
import { cn } from '@/lib/utils';
import { NoAccess } from '@/pages/Placeholders';
import { useGrants } from '@/session/SessionProvider';
import { LoanDetail } from './LoanDetail';
import { RecordLoanDialog } from './LoanForms';

// Screen 8. Loans, newest first: the loans guarantees back, as lenders report them, and the Lipa API's loans that
// feed the Trust Score. A loan carries its member's ID only, so the member is named in the detail.

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'repaid', label: 'Repaid' },
  { value: 'defaulted', label: 'Defaulted' },
  { value: 'pending', label: 'Waiting for approval' }
];

const SOURCES = [
  { value: '', label: 'Every source' },
  { value: 'guaranteed', label: 'Guaranteed' },
  { value: 'lipa_onchain', label: 'Lipa API' }
];

const DEFAULT_SIZE = 25;

/** Its status, and the step waiting on it for a second admin. */
export function LoanStatusCell({ l }: { l: Loan }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StatusPill label={loanStatus(l)} />
      {l.pendingAction ? <Badge tone="warn">{stepName(l.pendingAction)}: waiting</Badge> : null}
    </span>
  );
}

const COLUMNS: Column<Loan>[] = [
  { header: 'Loan on', cell: loanName },
  {
    header: 'Source',
    cell: (l) => (
      <span className="flex flex-wrap items-center gap-1.5">
        {loanSource(l.source)}
        {l.recordedVia === 'lender_api' ? <Badge>From lender</Badge> : null}
      </span>
    )
  },
  { header: 'Lender', cell: (l) => l.lender ?? '—' },
  { header: 'Amount', cell: (l) => formatIn(l.amount, l.currency), figure: true },
  { header: 'Due', cell: (l) => formatDate(l.dueAt) },
  { header: 'Status', cell: (l) => <LoanStatusCell l={l} /> }
];

export function LoansPage() {
  const grants = useGrants();
  if (!can(grants, 'GUARANTEES.READ')) return <NoAccess />;
  return <Loans />;
}

function Loans() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { loanId } = useParams();
  const wide = useMedia(WIDE_QUERY);
  const [params, setParams] = useSearchParams();
  const [recording, setRecording] = React.useState(false);
  const canManage = can(useGrants(), 'GUARANTEES.MANAGE');

  const status = STATUS_FILTERS.find((f) => f.value && f.value === params.get('status'))?.value ?? '';
  const source = SOURCES.find((f) => f.value && f.value === params.get('source'))?.value ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const sizeParam = Number(params.get('size'));
  const size = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : DEFAULT_SIZE;
  const tab = params.get('tab') ?? '';

  /** Changes some values; any change but the page or the detail's tab goes back to page 1. */
  const update = (changes: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === undefined || v === '' || (k === 'page' && v === 1) || (k === 'size' && v === DEFAULT_SIZE) || (k === 'tab' && v === 'overview')) next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in changes) && !('tab' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  const listParams = new URLSearchParams(params);
  listParams.delete('tab');
  const search = listParams.toString() ? `?${listParams.toString()}` : '';
  const q: LoanQuery = { page, size, status: status === 'pending' ? undefined : status || undefined, pending: status === 'pending' || undefined, source: source || undefined };
  const query = useQuery({ queryKey: ['loans', 'list', q], queryFn: () => listLoans(q), placeholderData: keepPreviousData });

  const total = query.data?.totalResults ?? 0;
  const list = query.isPending ? (
    <p className="m-0 px-4 py-5 text-muted">Loading…</p>
  ) : query.isError ? (
    <div className="p-3.5">
      <Banner tone="bad">{errorMessage(query.error)}</Banner>
    </div>
  ) : !query.data.results?.length ? (
    <p className="m-0 px-4 py-5 text-muted">No loans match.</p>
  ) : (
    <Rows<Loan>
      label="Loans"
      rows={query.data.results}
      rowKey={(l) => l.loanId!}
      columns={COLUMNS}
      grid="grid-cols-[1.3fr_0.8fr_1fr_1fr_0.8fr_1.4fr]"
      minWidth={900}
      linkFor={(l) => `/loans/${l.loanId}${search}`}
      sub={(l) => `${l.lender ?? loanSource(l.source)}${l.recordedVia === 'lender_api' ? ' (sent by the lender)' : ''} · ${formatIn(l.amount, l.currency)} · due ${formatDate(l.dueAt)}`}
    />
  );

  return (
    <>
      <PageHeader actions={canManage ? <Button onClick={() => setRecording(true)}>Record a loan</Button> : undefined} />
      <div className="flex flex-col gap-3.5">
        <Muted>A lender's system can send its new loans with its own service key; admins enter every other loan and everything lenders report afterwards. Each report or claim step needs a second admin to approve it.</Muted>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((f) => (
              <Chip key={f.label} on={status === f.value} onClick={() => update({ status: f.value })}>
                {f.label}
              </Chip>
            ))}
          </div>
          <select aria-label="Source" value={source} onChange={(e) => update({ source: e.target.value })} className="min-h-9 rounded-ctl border border-ctl bg-surface px-2 text-ink">
            {SOURCES.map((s) => (
              <option key={s.label} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface', query.isFetching && !query.isPending && 'opacity-70')} aria-busy={query.isFetching}>
          {list}
          {total > 0 ? <Pager page={page} size={size} total={total} onPage={(p) => update({ page: p })} onSize={(s) => update({ size: s })} /> : null}
        </section>
      </div>

      <Sheet open={!!loanId} onClose={() => navigate(`/loans${search}`)} title="Loan details" wide={wide}>
        {loanId ? <LoanDetail loanId={loanId} tab={tab} onTab={(t) => update({ tab: t })} /> : null}
      </Sheet>
      <RecordLoanDialog
        open={recording}
        onClose={() => setRecording(false)}
        onSaved={(d) => {
          qc.setQueryData(['loans', d.loan!.loanId], d);
          void qc.invalidateQueries({ queryKey: ['loans', 'list'] });
          navigate(`/loans/${d.loan!.loanId}${search}`);
        }}
      />
    </>
  );
}

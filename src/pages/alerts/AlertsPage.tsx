import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';
import { errorMessage } from '@/api/errors';
import { listAlerts, type Alert, type AlertQuery } from '@/api/alerts';
import { PageHeader } from '@/components/shell/AppShell';
import { Banner } from '@/components/ui/badge';
import { Chip } from '@/components/ui/chip';
import { Pager, PAGE_SIZES } from '@/components/ui/pager';
import { Muted, StatusPill } from '@/components/ui/parts';
import { Rows, type Column } from '@/components/ui/rows';
import { Sheet } from '@/components/ui/sheet';
import { formatDateTime, formatNumber } from '@/lib/format';
import { ALERT_LEVELS, ALERT_TYPES, alertLevel, alertStatus, alertType } from '@/lib/labels';
import { can } from '@/lib/permissions';
import { useMedia, WIDE_QUERY } from '@/lib/useMedia';
import { cn } from '@/lib/utils';
import { NoAccess } from '@/pages/Placeholders';
import { useGrants } from '@/session/SessionProvider';
import { AlertDetail } from './AlertDetail';

// Screen 16. Pool alerts, most recently seen first, opening on the open ones. An alert is raised by the GP API,
// acknowledged by an admin with what was done, and resolved by the GP API once its condition clears.

const STATUS_FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' }
];

const DEFAULT_SIZE = 25;

/** When it was last seen, and how many times it has been. */
const seen = (a: Alert) => `${formatDateTime(a.lastSeenAt)}${(a.count ?? 1) > 1 ? ` · ${formatNumber(a.count)} times` : ''}`;

const COLUMNS: Column<Alert>[] = [
  { header: 'Alert', cell: (a) => a.summary ?? alertType(a.type) },
  { header: 'Level', cell: (a) => <StatusPill label={alertLevel(a.severity)} /> },
  { header: 'Triggered by', cell: (a) => alertType(a.type) },
  { header: 'Last seen', cell: seen },
  { header: 'Status', cell: (a) => <StatusPill label={alertStatus(a.status)} /> }
];

export function AlertsPage() {
  const grants = useGrants();
  if (!can(grants, 'ALERTS.READ')) return <NoAccess />;
  return <Alerts />;
}

function Alerts() {
  const navigate = useNavigate();
  const { alertId } = useParams();
  const wide = useMedia(WIDE_QUERY);
  const [params, setParams] = useSearchParams();

  const status = STATUS_FILTERS.find((f) => f.value === params.get('status'))?.value ?? 'open';
  const type = ALERT_TYPES.includes(params.get('type') ?? '') ? params.get('type')! : '';
  const severity = (ALERT_LEVELS as readonly string[]).includes(params.get('level') ?? '') ? params.get('level')! : '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const sizeParam = Number(params.get('size'));
  const size = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : DEFAULT_SIZE;

  /** Changes some values; any change but the page goes back to page 1. */
  const update = (changes: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === undefined || v === '' || (k === 'status' && v === 'open') || (k === 'page' && v === 1) || (k === 'size' && v === DEFAULT_SIZE)) next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  const search = params.toString() ? `?${params.toString()}` : '';
  const filters = { type: type || undefined, severity: severity || undefined };
  const q: AlertQuery = { page, size, status: status === 'all' ? undefined : status, ...filters };
  const query = useQuery({ queryKey: ['alerts', 'list', q], queryFn: () => listAlerts(q), placeholderData: keepPreviousData });
  // how many each status holds, with the type and level chosen
  const counts = useQueries({
    queries: STATUS_FILTERS.map((f) => {
      const cq: AlertQuery = { page: 1, size: 1, status: f.value === 'all' ? undefined : f.value, ...filters };
      return { queryKey: ['alerts', 'list', cq], queryFn: () => listAlerts(cq) };
    })
  });

  const total = query.data?.totalResults ?? 0;
  const list = query.isPending ? (
    <p className="m-0 px-4 py-5 text-muted">Loading…</p>
  ) : query.isError ? (
    <div className="p-3.5">
      <Banner tone="bad">{errorMessage(query.error)}</Banner>
    </div>
  ) : !query.data.results?.length ? (
    <p className="m-0 px-4 py-5 text-muted">No alerts here.</p>
  ) : (
    <Rows<Alert>
      label="Alerts"
      rows={query.data.results}
      rowKey={(a) => a.id!}
      columns={COLUMNS}
      grid="grid-cols-[2.4fr_0.8fr_1.3fr_1.3fr_1fr]"
      minWidth={900}
      linkFor={(a) => `/alerts/${a.id}${search}`}
      sub={(a) => `${alertLevel(a.severity).text} · ${alertType(a.type)} · seen ${seen(a)}`}
    />
  );

  return (
    <>
      <PageHeader />
      <div className="flex flex-col gap-3.5">
        <Muted>
          The GP API raises an alert when something puts pool money at risk, and resolves it once the condition clears. Acknowledge one to say what was done; it stays acknowledged, still counting
          repeats, until it resolves. Critical alerts are emailed too.
        </Muted>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((f, i) => {
              const count = counts[i]?.data?.totalResults;
              return (
                <Chip key={f.value} on={status === f.value} onClick={() => update({ status: f.value })}>
                  {f.label}
                  {count === undefined ? null : <span className="ml-1.5 tabular-nums opacity-80">{formatNumber(count)}</span>}
                </Chip>
              );
            })}
          </div>
          <select aria-label="Level" value={severity} onChange={(e) => update({ level: e.target.value })} className="min-h-9 rounded-ctl border border-ctl bg-surface px-2 text-ink">
            <option value="">All levels</option>
            {ALERT_LEVELS.map((l) => (
              <option key={l} value={l}>
                {alertLevel(l).text}
              </option>
            ))}
          </select>
          <select aria-label="Triggered by" value={type} onChange={(e) => update({ type: e.target.value })} className="min-h-9 rounded-ctl border border-ctl bg-surface px-2 text-ink">
            <option value="">Anything</option>
            {ALERT_TYPES.map((t) => (
              <option key={t} value={t}>
                {alertType(t)}
              </option>
            ))}
          </select>
        </div>
        <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface', query.isFetching && !query.isPending && 'opacity-70')} aria-busy={query.isFetching}>
          {list}
          {total > 0 ? <Pager page={page} size={size} total={total} onPage={(p) => update({ page: p })} onSize={(s) => update({ size: s })} /> : null}
        </section>
      </div>

      <Sheet open={!!alertId} onClose={() => navigate(`/alerts${search}`)} title="Alert details" wide={wide}>
        {alertId ? <AlertDetail alertId={alertId} listed={query.data?.results?.find((a) => a.id === alertId)} /> : null}
      </Sheet>
    </>
  );
}

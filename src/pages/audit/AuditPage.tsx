import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { listAdmins } from '@/api/admins';
import { listAuditLog, type AuditEntry, type AuditQuery } from '@/api/audit';
import { errorMessage } from '@/api/errors';
import { PageHeader } from '@/components/shell/AppShell';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pager, PAGE_SIZES } from '@/components/ui/pager';
import { Muted } from '@/components/ui/parts';
import { ACTION_GROUPS, actorKind, actorName, auditAction, KNOWN_ACTIONS, recordPath, RECORD_TYPES, recordType } from '@/lib/audit';
import { formatDateTime, zoneLabel } from '@/lib/format';
import { fullName } from '@/lib/names';
import { can } from '@/lib/permissions';
import { useCompact } from '@/lib/useMedia';
import { cn } from '@/lib/utils';
import { NoAccess } from '@/pages/Placeholders';
import { useGrants } from '@/session/SessionProvider';

// Screen 21. Everything admins do, and what members, service keys and the GP API itself do, newest first.
// Filters go in the address, so a filtered log can be shared as a link.

const DEFAULT_SIZE = 25;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const FILTERS = ['action', 'admin', 'type', 'record', 'from', 'to'] as const;
const selectClass = 'min-h-9 rounded-ctl border border-ctl bg-surface px-2 text-ink';

export function AuditPage() {
  const grants = useGrants();
  if (!can(grants, 'AUDIT.READ')) return <NoAccess />;
  return <Audit />;
}

function Audit() {
  const grants = useGrants();
  const [params, setParams] = useSearchParams();

  const action = params.get('action') ?? '';
  const admin = params.get('admin') ?? '';
  const type = params.get('type') ?? '';
  const record = params.get('record') ?? '';
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

  // the record id waits for a pause in typing, then goes in the address, which can change it too (back, a link);
  // any other change to the address while it waits starts the wait again, so it doesn't undo it
  const [recordText, setRecordText] = React.useState(record);
  React.useEffect(() => {
    if (recordText.trim() === record) return;
    const t = setTimeout(() => update({ record: recordText.trim() }), 300);
    return () => clearTimeout(t);
  }, [recordText, params.toString()]);
  React.useEffect(() => setRecordText(record), [record]);

  // the who filter lists the admins for a role that can read them; clicking a name in the log filters by anyone
  const admins = useQuery({ queryKey: ['admins', 'list', { page: 1, size: 100 }], queryFn: () => listAdmins({ page: 1, size: 100 }), enabled: can(grants, 'ADMINS.READ') });

  const q: AuditQuery = { page, size, action: action || undefined, actorId: admin || undefined, targetType: type || undefined, targetId: record || undefined, from: from || undefined, to: to || undefined };
  const query = useQuery({ queryKey: ['audit', 'list', q], queryFn: () => listAuditLog(q), placeholderData: keepPreviousData });

  const byActor = (e: AuditEntry) => (e.actorId ? () => update({ admin: e.actorId }) : undefined);
  const byRecord = (e: AuditEntry) => (e.targetId ? () => update({ type: e.targetType, record: e.targetId }) : undefined);

  const total = query.data?.totalResults ?? 0;
  const list = query.isPending ? (
    <p className="m-0 px-4 py-5 text-muted">Loading the log…</p>
  ) : query.isError ? (
    <div className="p-3.5">
      <Banner tone="bad">{errorMessage(query.error)}</Banner>
    </div>
  ) : !query.data.results?.length ? (
    <p className="m-0 px-4 py-5 text-muted">{filtered ? 'Nothing in the log matches.' : 'Nothing in the log yet.'}</p>
  ) : (
    <AuditRows rows={query.data.results} byActor={byActor} byRecord={byRecord} />
  );

  // an admin or action from a link that the lists don't have still shows as chosen
  const adminList = admins.data?.results ?? [];
  const otherAdmin = admin && !adminList.some((a) => a.id === admin);
  const chosen = query.data?.results?.find((e) => e.actorId === admin);
  const otherAction = action && !KNOWN_ACTIONS.includes(action);
  const otherType = type && !RECORD_TYPES.includes(type);

  return (
    <>
      <PageHeader />
      <div className="flex flex-col gap-3.5">
        <Muted>Every action admins take, and what members, service keys and the GP API itself do, newest first. Times are in {zoneLabel()}.</Muted>
        <Banner tone="plan">Planned: Lipa API callbacks and status checks in the log, with a filter for them.</Banner>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Action" value={action} onChange={(e) => update({ action: e.target.value })} className={cn(selectClass, 'max-w-full')}>
            <option value="">All actions</option>
            {otherAction ? <option value={action}>{auditAction(action)}</option> : null}
            {ACTION_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.actions.map((a) => (
                  <option key={a} value={a}>
                    {auditAction(a)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {can(grants, 'ADMINS.READ') || admin ? (
            <select aria-label="Who" value={admin} onChange={(e) => update({ admin: e.target.value })} className={cn(selectClass, 'max-w-full')}>
              <option value="">Anyone</option>
              {otherAdmin ? <option value={admin}>{chosen ? actorName(chosen.actorType, chosen.actorLabel) : admins.isPending && can(grants, 'ADMINS.READ') ? 'Loading…' : 'The one chosen'}</option> : null}
              {adminList.map((a) => (
                <option key={a.id} value={a.id}>
                  {fullName(a) || a.email}
                </option>
              ))}
            </select>
          ) : null}
          <select aria-label="Record type" value={type} onChange={(e) => update({ type: e.target.value })} className={selectClass}>
            <option value="">All records</option>
            {otherType ? <option value={type}>{recordType(type)}</option> : null}
            {RECORD_TYPES.map((t) => (
              <option key={t} value={t}>
                {recordType(t)}
              </option>
            ))}
          </select>
          <Input aria-label="Record ID" placeholder="Record ID" value={recordText} onChange={(e) => setRecordText(e.target.value)} className="max-w-[300px] flex-[1_1_200px] font-mono" />
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
    </>
  );
}

const filterButton = 'text-left font-[inherit] text-ink-strong underline-offset-4 hover:underline [overflow-wrap:anywhere]';

function WhoCell({ e, filter }: { e: AuditEntry; filter?: () => void }) {
  const name = actorName(e.actorType, e.actorLabel);
  const kind = e.actorType === 'ADMIN' || e.actorType === 'SYSTEM' ? '' : actorKind(e.actorType);
  return (
    <span className="flex min-w-0 flex-col">
      {filter ? (
        <button type="button" className={cn(filterButton, 'font-semibold')} title="Show only what they did" onClick={filter}>
          {name}
        </button>
      ) : (
        <span className="font-semibold [overflow-wrap:anywhere]">{name}</span>
      )}
      {kind || e.ipAddress ? <span className="text-[12px] text-muted">{[kind, e.ipAddress].filter(Boolean).join(' · ')}</span> : null}
    </span>
  );
}

function RecordCell({ e, filter }: { e: AuditEntry; filter?: () => void }) {
  if (!e.targetType || e.targetType === 'none') return <span className="text-muted">—</span>;
  const path = recordPath(e.targetType, e.targetId);
  return (
    <span className="flex min-w-0 flex-col items-start">
      <span>{recordType(e.targetType)}</span>
      {e.targetId ? (
        <span className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
          {filter ? (
            <button type="button" className={cn(filterButton, 'font-mono')} title="Show only this record's entries" onClick={filter}>
              {e.targetId}
            </button>
          ) : null}
          {path ? (
            <Link to={path} className="font-medium text-ink-strong underline-offset-4 hover:underline">
              Open
            </Link>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

const COLUMNS = 'grid-cols-[0.8fr_1fr_1fr_1.1fr_1.4fr]';

function AuditRows({ rows, byActor, byRecord }: { rows: AuditEntry[]; byActor: (e: AuditEntry) => (() => void) | undefined; byRecord: (e: AuditEntry) => (() => void) | undefined }) {
  const compact = useCompact();
  if (compact) {
    return (
      <ul aria-label="Audit log" className="m-0 list-none p-0">
        {rows.map((e) => (
          <li key={e.id} className="flex flex-col gap-1 border-b border-line px-3.5 py-2.5 last:border-b-0">
            <span className="flex flex-wrap items-baseline justify-between gap-1.5">
              <span className="font-semibold">{auditAction(e.action)}</span>
              <span className="text-[12px] text-muted">{formatDateTime(e.occurredAt)}</span>
            </span>
            <WhoCell e={e} filter={byActor(e)} />
            <RecordCell e={e} filter={byRecord(e)} />
            {e.details ? <span className="text-ink-3 [overflow-wrap:anywhere]">{e.details}</span> : null}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[960px]" role="table" aria-label="Audit log">
        <div role="row" className={cn('grid gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted', COLUMNS)}>
          {['When', 'Who', 'What', 'Record', 'Details'].map((h) => (
            <span key={h} role="columnheader">
              {h}
            </span>
          ))}
        </div>
        {rows.map((e) => (
          <div key={e.id} role="row" className={cn('grid min-h-11 items-start gap-3 border-t border-line px-4 py-2', COLUMNS)}>
            <span role="cell" className="min-w-0 tabular-nums">{formatDateTime(e.occurredAt)}</span>
            <span role="cell" className="min-w-0">
              <WhoCell e={e} filter={byActor(e)} />
            </span>
            <span role="cell" className="min-w-0 [overflow-wrap:anywhere]">{auditAction(e.action)}</span>
            <span role="cell" className="min-w-0">
              <RecordCell e={e} filter={byRecord(e)} />
            </span>
            <span role="cell" className="min-w-0 text-ink-3 [overflow-wrap:anywhere]">{e.details || '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@/api/errors';
import { importFacts, listFacts, type Fact, type FactQuery, type ImportResult } from '@/api/facts';
import { PageHeader } from '@/components/shell/AppShell';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { FormDialog } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Pager, PAGE_SIZES } from '@/components/ui/pager';
import { Muted } from '@/components/ui/parts';
import { Rows, type Column } from '@/components/ui/rows';
import { formatDateTime, formatIn } from '@/lib/format';
import { FACT_TYPES, factType, factVia, IMPORTABLE_FACT_TYPES } from '@/lib/labels';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { NoAccess } from '@/pages/Placeholders';
import { useGrants } from '@/session/SessionProvider';

// Screen 17. The activity records outside systems send about members (the ledger's fact inbox), which feed the
// Trust Score. A record has no page of its own, so its row shows everything about it.

const SORTS = [
  { value: '', label: 'Latest to happen first' },
  { value: 'receivedAt:desc', label: 'Latest received first' }
];

const DEFAULT_SIZE = 25;

const CSV_HEADER = 'source,externalId,memberNumber,type,amount,occurredAt';

const amount = (f: Fact) => formatIn(f.amount, f.unit);

const COLUMNS: Column<Fact>[] = [
  { header: 'Member number', cell: (f) => f.memberNumber ?? '—' },
  { header: 'What happened', cell: (f) => factType(f.type) },
  { header: 'Amount', cell: amount, figure: true },
  {
    header: 'Source',
    cell: (f) => (
      <span className="flex flex-col">
        {f.source}
        <span className="font-mono text-[12px] text-muted">{f.externalId}</span>
      </span>
    )
  },
  {
    header: 'Received',
    cell: (f) => (
      <span className="flex flex-col">
        {formatDateTime(f.receivedAt)}
        <span className="text-[12px] text-muted">{factVia(f.receivedVia)}</span>
      </span>
    )
  },
  { header: 'Happened', cell: (f) => formatDateTime(f.occurredAt) }
];

export function ActivityPage() {
  const grants = useGrants();
  if (!can(grants, 'LEDGER.READ')) return <NoAccess />;
  return <Activity />;
}

function Activity() {
  const grants = useGrants();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [importing, setImporting] = React.useState(false);
  const [imported, setImported] = React.useState('');

  const member = params.get('member') ?? '';
  const source = params.get('source') ?? '';
  const type = FACT_TYPES.includes(params.get('type') ?? '') ? params.get('type')! : '';
  const sort = SORTS.find((s) => s.value && s.value === params.get('sort'))?.value ?? '';
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

  // the typed filters wait for a pause in typing, then go in the address, which can change them too (back, a link)
  const [memberText, setMemberText] = React.useState(member);
  const [sourceText, setSourceText] = React.useState(source);
  React.useEffect(() => {
    if (memberText.trim() === member && sourceText.trim() === source) return;
    const t = setTimeout(() => update({ member: memberText.trim(), source: sourceText.trim() }), 300);
    return () => clearTimeout(t);
  }, [memberText, sourceText]);
  React.useEffect(() => setMemberText(member), [member]);
  React.useEffect(() => setSourceText(source), [source]);

  const q: FactQuery = { page, size, memberNumber: member || undefined, type: type || undefined, source: source || undefined, sortBy: sort || undefined };
  const query = useQuery({ queryKey: ['facts', 'list', q], queryFn: () => listFacts(q), placeholderData: keepPreviousData });

  const total = query.data?.totalResults ?? 0;
  const list = query.isPending ? (
    <p className="m-0 px-4 py-5 text-muted">Loading…</p>
  ) : query.isError ? (
    <div className="p-3.5">
      <Banner tone="bad">{errorMessage(query.error)}</Banner>
    </div>
  ) : !query.data.results?.length ? (
    <p className="m-0 px-4 py-5 text-muted">{member || type || source ? 'No records match.' : 'No activity records yet.'}</p>
  ) : (
    <Rows<Fact>
      label="Activity records"
      rows={query.data.results}
      rowKey={(f) => f.id!}
      columns={COLUMNS}
      grid="grid-cols-[0.8fr_1.2fr_1fr_1.2fr_1fr_1fr]"
      minWidth={900}
      sub={(f) => `${factType(f.type)} · ${amount(f)} · ${f.source} · ${factVia(f.receivedVia)}`}
    />
  );

  return (
    <>
      <PageHeader actions={can(grants, 'LEDGER.IMPORT') ? <Button onClick={() => setImporting(true)}>Import a CSV file</Button> : undefined} />
      <div className="flex flex-col gap-3.5">
        <Muted>What outside systems tell the GP API about members: deposits, loans and BLOCKS. Each record counts toward the member's Trust Score.</Muted>
        <Banner tone="plan">Planned: KES activity read from the Lipa API for each wallet, with its status.</Banner>
        {imported ? <Banner tone="ok">{imported}</Banner> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Input type="search" aria-label="Member number" placeholder="Member number" value={memberText} onChange={(e) => setMemberText(e.target.value)} className="max-w-[200px] flex-[1_1_160px]" />
          <select aria-label="Type" value={type} onChange={(e) => update({ type: e.target.value })} className="min-h-9 rounded-ctl border border-ctl bg-surface px-2 text-ink">
            <option value="">All types</option>
            {FACT_TYPES.map((t) => (
              <option key={t} value={t}>
                {factType(t)}
              </option>
            ))}
          </select>
          <Input type="search" aria-label="Source" placeholder="Source" value={sourceText} onChange={(e) => setSourceText(e.target.value)} className="max-w-[200px] flex-[1_1_160px]" />
          <select aria-label="Order" value={sort} onChange={(e) => update({ sort: e.target.value })} className="min-h-9 rounded-ctl border border-ctl bg-surface px-2 text-ink">
            {SORTS.map((s) => (
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

      <ImportDialog
        open={importing}
        onClose={() => setImporting(false)}
        onSaved={(name, r) => {
          setImported(importedLine(name, r));
          void qc.invalidateQueries({ queryKey: ['facts'] });
        }}
      />
    </>
  );
}

const records = (n: number) => `${n} record${n === 1 ? '' : 's'}`;

/** What an import did: the records added, and those already in. */
function importedLine(name: string, r: ImportResult): string {
  const added = r.accepted ?? 0;
  const skipped = r.duplicates ?? 0;
  return `${name}: ${records(added)} added` + (skipped ? `, ${records(skipped)} already in and skipped.` : '.');
}

function ImportDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (name: string, r: ImportResult) => void }) {
  const [file, setFile] = React.useState<File | null>(null);
  React.useEffect(() => setFile(null), [open]);
  return (
    <FormDialog
      open={open}
      title="Import activity records"
      description="Each row becomes one activity record and counts toward the member's Trust Score. The file goes in whole or not at all; a row already imported, with the same source and ID, is skipped."
      confirm="Import"
      onClose={onClose}
      check={() => (file ? '' : 'Choose the file.')}
      send={() => importFacts(file!)}
      saved={(r) => onSaved(file!.name, r)}
      done="File imported."
    >
      <Field
        id="facts-file"
        label="CSV file"
        hint={
          <>
            The first line must be <span className="font-mono">{CSV_HEADER}</span>. The type is one of {IMPORTABLE_FACT_TYPES.join(', ')}; occurredAt is a time such as 2026-09-01T08:00:00Z. At most 5,000 rows.
          </>
        }
      >
        <Input id="facts-file" type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-describedby="facts-file-hint" />
      </Field>
    </FormDialog>
  );
}

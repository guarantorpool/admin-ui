import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage } from '@/api/errors';
import {
  addEntries,
  addEntry,
  allEntries,
  approveRequest,
  BULK_MAX,
  changeEntry,
  listEntries,
  listRequests,
  NAME_MAX,
  pendingRequestsKey,
  PICK_LISTS,
  pickList,
  rejectRequest,
  type ListEntry,
  type ListRequest,
  type PickList
} from '@/api/lists';
import { PageHeader } from '@/components/shell/AppShell';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { DecisionDialog, NOTE_HINT, type Decision } from '@/components/ui/decision-dialog';
import { Field } from '@/components/ui/field';
import { FormDialog, selectClass, textareaClass } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Pager, PAGE_SIZES } from '@/components/ui/pager';
import { Muted, StatusPill } from '@/components/ui/parts';
import { RowMenu, type RowAction } from '@/components/ui/row-menu';
import { Tabs } from '@/components/ui/tabs';
import { formatDateTime } from '@/lib/format';
import { entryType, listRequestStatus } from '@/lib/labels';
import { fullName } from '@/lib/names';
import { can } from '@/lib/permissions';
import { useCompact } from '@/lib/useMedia';
import { cn } from '@/lib/utils';
import { NoAccess } from '@/pages/Placeholders';
import { useGrants } from '@/session/SessionProvider';

// The lists members pick their location and background from, for connection suggestions (BlockCoop D-043), and
// members' requests for a missing community, organisation or school. Admins with LISTS.MANAGE add entries one at a
// time or many at once (a public list of schools or SACCOs), rename and retire them, and approve, merge or reject
// requests. Counties and sub-counties are the official ones and can't be changed. Entries are never deleted.

const VIEWS = ['requests', 'entries'] as const;
type View = (typeof VIEWS)[number];
const DEFAULT_SIZE = 25;
const DEFAULT_LIST = 'communities';

const STATUS_CHIPS = [
  { value: undefined, label: 'Waiting' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'WITHDRAWN', label: 'Withdrawn' },
  { value: 'all', label: 'All' }
] as const;

export function ListsPage() {
  const grants = useGrants();
  if (!can(grants, 'LISTS.READ')) return <NoAccess />;
  return <Lists />;
}

function useListParams() {
  const [params, setParams] = useSearchParams();
  const viewParam = params.get('view');
  const view: View = (VIEWS as readonly string[]).includes(viewParam ?? '') ? (viewParam as View) : 'requests';
  const list = pickList(params.get('list')) ?? pickList(DEFAULT_LIST)!;
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
  return {
    view,
    list,
    status: params.get('status') ?? undefined,
    q: params.get('q') ?? '',
    parent: params.get('parent') ?? undefined,
    retired: params.get('show') === 'retired',
    page,
    size,
    update
  };
}

const usePendingCount = () =>
  useQuery({ queryKey: pendingRequestsKey, queryFn: () => listRequests({ status: 'PENDING', page: 1, size: 1 }), select: (p) => p.totalResults ?? 0 });

/** Every county and sub-county, for the town and sub-county filters and to name an entry's place. */
const usePlaces = (enabled: boolean) => {
  const counties = useQuery({ queryKey: ['lists', 'all', 'counties'], queryFn: () => allEntries('counties'), staleTime: Infinity, enabled });
  const subCounties = useQuery({ queryKey: ['lists', 'all', 'sub-counties'], queryFn: () => allEntries('sub-counties'), staleTime: Infinity, enabled });
  return React.useMemo(() => {
    const county = new Map((counties.data ?? []).map((c) => [c.id!, c]));
    const subCounty = new Map((subCounties.data ?? []).map((s) => [s.id!, s]));
    return { counties: counties.data ?? [], subCounties: subCounties.data ?? [], county, subCounty, error: counties.error ?? subCounties.error };
  }, [counties.data, subCounties.data, counties.error, subCounties.error]);
};
type Places = ReturnType<typeof usePlaces>;

function Lists() {
  const p = useListParams();
  const pending = usePendingCount();
  const manage = can(useGrants(), 'LISTS.MANAGE');
  const [adding, setAdding] = React.useState<'one' | 'many' | null>(null);
  const tabs = [
    { value: 'requests', label: "Members' requests", count: pending.data },
    { value: 'entries', label: 'Lists' }
  ];
  const canAdd = manage && p.view === 'entries' && p.list.kept;
  return (
    <>
      <PageHeader
        actions={
          canAdd ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setAdding('many')}>
                Add many
              </Button>
              <Button onClick={() => setAdding('one')}>Add {p.list.one}</Button>
            </div>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-3.5">
        <Muted>
          Members pick their location and background from these lists, and are suggested to members who share them. A member who can't find their community, workplace or school asks for it to be added; until it is approved it
          suggests no one.
        </Muted>
        <Tabs label="Suggestion lists" idPrefix="lists" tabs={tabs} value={p.view} onChange={(v) => p.update({ view: v === 'requests' ? undefined : v, status: undefined, q: undefined, parent: undefined, show: undefined, size: undefined })} />
        <div role="tabpanel" id={`lists-panel-${p.view}`} aria-labelledby={`lists-tab-${p.view}`} className="flex flex-col gap-3.5">
          {p.view === 'requests' ? <Requests params={p} manage={manage} /> : <Entries key={p.list.path} params={p} manage={manage} />}
        </div>
      </div>
      {canAdd ? (
        <>
          <AddEntry open={adding === 'one'} list={p.list} onClose={() => setAdding(null)} />
          <AddMany open={adding === 'many'} list={p.list} onClose={() => setAdding(null)} />
        </>
      ) : null}
    </>
  );
}

type Params = ReturnType<typeof useListParams>;

// ------------------------------------------------------------------ the lists

function Entries({ params: p, manage }: { params: Params; manage: boolean }) {
  const qc = useQueryClient();
  const [text, setText] = React.useState(p.q);
  const [changing, setChanging] = React.useState<ListEntry | null>(null);
  const [decision, setDecision] = React.useState<Decision | null>(null);
  const list = p.list;
  const places = usePlaces(!!list.parent);

  // the search is applied to the URL as it is when the typing stops, so a filter changed meanwhile is kept
  const update = React.useRef(p.update);
  update.current = p.update;
  React.useEffect(() => {
    if (text.trim() === p.q) return;
    const t = setTimeout(() => update.current({ q: text.trim() }), 300);
    return () => clearTimeout(t);
  }, [text]);
  React.useEffect(() => setText(p.q), [p.q]);

  const query = useQuery({
    queryKey: ['lists', 'entries', list.path, { parent: p.parent, q: p.q, retired: p.retired, page: p.page, size: p.size }],
    queryFn: () => listEntries(list.path, { parentId: p.parent, search: p.q || undefined, includeRetired: p.retired, page: p.page, size: p.size }),
    placeholderData: keepPreviousData
  });

  const changed = () => void qc.invalidateQueries({ queryKey: ['lists'] });
  const place = (e: ListEntry) => placeName(list, e.parentId, places);

  const menuFor = (e: ListEntry): RowAction[] => {
    if (!manage || !list.kept) return [];
    const rows = entryRows(list, e, places);
    return [
      { label: 'Change', why: '', run: () => setChanging(e) },
      e.retiredAt
        ? {
            label: 'Bring back',
            why: '',
            run: () =>
              setDecision({
                title: `Bring back ${e.name}?`,
                description: 'Members can pick it again, and members who kept it are suggested to each other again.',
                confirm: 'Bring it back',
                rows,
                run: () => changeEntry(list.path, e.id!, { retired: false }),
                done: () => {
                  toast.success(`${e.name} is back on the list.`);
                  changed();
                }
              })
          }
        : {
            label: 'Retire',
            why: '',
            run: () =>
              setDecision({
                title: `Retire ${e.name}?`,
                description: "It is no longer offered and no longer suggests anyone. Members who picked it keep it on their background. It isn't deleted, and can be brought back.",
                confirm: 'Retire',
                danger: true,
                rows,
                run: () => changeEntry(list.path, e.id!, { retired: true }),
                done: () => {
                  toast.success(`${e.name} is retired.`);
                  changed();
                }
              })
          }
    ];
  };

  const rows = query.data?.results ?? [];
  const total = query.data?.totalResults ?? 0;
  const columns: Column<ListEntry>[] = [
    { header: 'Name', cell: (e) => e.name },
    ...(list.types.length ? [{ header: 'Type', cell: (e: ListEntry) => entryType(e.type) }] : []),
    ...(list.parent ? [{ header: list.parent === 'counties' ? 'County' : 'Sub-county', cell: place }] : []),
    { header: 'Status', cell: (e) => <StatusPill label={e.retiredAt ? { text: 'Retired', tone: 'neutral' } : { text: 'Offered', tone: 'ok' }} /> }
  ];

  const body = query.isPending ? (
    <p className="m-0 px-4 py-5 text-muted">Loading the list…</p>
  ) : query.isError ? (
    <div className="p-3.5">
      <Banner tone="bad">{errorMessage(query.error)}</Banner>
    </div>
  ) : !rows.length ? (
    <p className="m-0 px-4 py-5 text-muted">{p.q || p.parent ? 'Nothing on this list matches.' : list.kept ? `No ${list.label.toLowerCase()} yet.` : 'Nothing on this list.'}</p>
  ) : (
    <MenuRows label={list.label} rows={rows} rowKey={(e) => e.id!} columns={columns} grid={grid(columns.length)} menuFor={menuFor} sub={(e) => [list.types.length ? entryType(e.type) : '', list.parent ? place(e) : ''].filter(Boolean).join(' · ')} />
  );

  return (
    <>
      <div role="group" aria-label="List" className="flex flex-wrap gap-2">
        {PICK_LISTS.map((l) => (
          <Chip key={l.path} on={l.path === list.path} onClick={() => p.update({ list: l.path === DEFAULT_LIST ? undefined : l.path, parent: undefined, q: undefined })}>
            {l.label}
          </Chip>
        ))}
      </div>
      {!list.kept ? <Muted>The official {list.label.toLowerCase()} of Kenya, loaded with the GP API. They can't be added to, renamed or retired.</Muted> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Input type="search" aria-label={`Search ${list.label.toLowerCase()}`} placeholder="Search by name" value={text} onChange={(e) => setText(e.target.value)} className="max-w-[380px] flex-[1_1_240px]" />
        {list.parent ? <PlaceFilter list={list} places={places} value={p.parent} onChange={(v) => p.update({ parent: v })} /> : null}
        {list.kept ? (
          <div role="group" aria-label="Retired entries" className="flex flex-wrap gap-2">
            <Chip on={!p.retired} onClick={() => p.update({ show: undefined })}>
              Offered
            </Chip>
            <Chip on={p.retired} onClick={() => p.update({ show: 'retired' })}>
              With retired
            </Chip>
          </div>
        ) : null}
      </div>
      {places.error ? <Banner tone="bad">{errorMessage(places.error)}</Banner> : null}
      <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface', query.isFetching && !query.isPending && 'opacity-70')} aria-busy={query.isFetching}>
        {body}
        {total > 0 ? <Pager page={p.page} size={p.size} total={total} onPage={(n) => p.update({ page: n })} onSize={(s) => p.update({ size: s })} /> : null}
      </section>

      <ChangeEntry list={list} entry={changing} rows={changing ? entryRows(list, changing, places) : []} onClose={() => setChanging(null)} />
      <DecisionDialog decision={decision} onClose={() => setDecision(null)} />
    </>
  );
}

/** The county or sub-county an entry sits in. */
function placeName(list: PickList, parentId: string | undefined, places: Places): string {
  if (!parentId) return '—';
  if (list.parent === 'counties') return places.county.get(parentId)?.name ?? '…';
  const sub = places.subCounty.get(parentId);
  if (!sub) return '…';
  const county = sub.parentId ? places.county.get(sub.parentId)?.name : undefined;
  return county ? `${sub.name}, ${county}` : sub.name ?? '…';
}

function entryRows(list: PickList, e: ListEntry, places: Places) {
  return [
    { k: 'List', v: list.label },
    { k: 'Name', v: e.name },
    ...(list.types.length ? [{ k: 'Type', v: entryType(e.type) }] : []),
    ...(list.parent ? [{ k: 'In', v: placeName(list, e.parentId, places) }] : [])
  ];
}

/** Narrows sub-counties to a county, and towns to a sub-county (grouped by county). */
function PlaceFilter({ list, places, value, onChange }: { list: PickList; places: Places; value: string | undefined; onChange: (v: string | undefined) => void }) {
  return (
    <select aria-label={list.parent === 'counties' ? 'County' : 'Sub-county'} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} className="min-h-9 max-w-[280px] rounded-ctl border border-ctl bg-surface px-2 text-ink">
      <option value="">{list.parent === 'counties' ? 'Every county' : 'Every sub-county'}</option>
      <PlaceOptions list={list} places={places} />
    </select>
  );
}

function PlaceOptions({ list, places }: { list: PickList; places: Places }) {
  if (list.parent === 'counties')
    return (
      <>
        {places.counties.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </>
    );
  return (
    <>
      {places.counties.map((c) => (
        <optgroup key={c.id} label={c.name}>
          {places.subCounties
            .filter((s) => s.parentId === c.id)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}

function TypeSelect({ id, list, value, onChange }: { id: string; list: PickList; value: string; onChange: (v: string) => void }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
      <option value="">Choose a type</option>
      {list.types.map((t) => (
        <option key={t} value={t}>
          {entryType(t)}
        </option>
      ))}
    </select>
  );
}

function AddEntry({ open, list, onClose }: { open: boolean; list: PickList; onClose: () => void }) {
  const qc = useQueryClient();
  const places = usePlaces(open && !!list.parent);
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState('');
  const [parent, setParent] = React.useState('');
  React.useEffect(() => {
    setName('');
    setType('');
    setParent('');
  }, [open, list.path]);
  return (
    <FormDialog
      open={open}
      title={`Add ${list.one}`}
      description={`Members can pick it at once. A name already on the list, in any case, is refused.`}
      confirm="Add it"
      onClose={onClose}
      check={() => (!name.trim() ? 'Enter the name.' : list.types.length && !type ? 'Choose its type.' : list.parent && !parent ? 'Choose its sub-county.' : '')}
      send={() => addEntry(list.path, { name: name.trim(), type: type || undefined, parentId: parent || undefined })}
      saved={() => void qc.invalidateQueries({ queryKey: ['lists'] })}
      done={`${name.trim()} is added.`}
    >
      <Field id="entry-name" label="Name">
        <Input id="entry-name" value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} />
      </Field>
      {list.types.length ? (
        <Field id="entry-type" label="Type">
          <TypeSelect id="entry-type" list={list} value={type} onChange={setType} />
        </Field>
      ) : null}
      {list.parent ? (
        <Field id="entry-parent" label="Sub-county">
          <select id="entry-parent" value={parent} onChange={(e) => setParent(e.target.value)} className={selectClass}>
            <option value="">Choose a sub-county</option>
            <PlaceOptions list={list} places={places} />
          </select>
        </Field>
      ) : null}
    </FormDialog>
  );
}

/** The names in pasted text: one a line, trimmed, blank lines and repeats left out. */
export function namesIn(text: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const name = line.trim().replace(/\s+/g, ' ');
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

function AddMany({ open, list, onClose }: { open: boolean; list: PickList; onClose: () => void }) {
  const qc = useQueryClient();
  const places = usePlaces(open && !!list.parent);
  const [text, setText] = React.useState('');
  const [type, setType] = React.useState('');
  const [parent, setParent] = React.useState('');
  React.useEffect(() => {
    setText('');
    setType('');
    setParent('');
  }, [open, list.path]);
  const names = namesIn(text);
  const tooLong = names.find((n) => n.length > NAME_MAX);
  return (
    <FormDialog
      open={open}
      wide
      title={`Add many ${list.label.toLowerCase()}`}
      description={`Paste one name a line, such as a public list${list.types.length ? '; all of them get the type chosen here, so add each type separately' : ''}. Names already on the list are skipped.`}
      confirm={names.length ? `Add ${names.length}` : 'Add them'}
      onClose={onClose}
      check={() =>
        !names.length
          ? 'Paste at least one name.'
          : names.length > BULK_MAX
            ? `That is ${names.length} names; add at most ${BULK_MAX} at a time.`
            : tooLong
              ? `“${tooLong.slice(0, 40)}…” is longer than ${NAME_MAX} characters.`
              : list.types.length && !type
                ? 'Choose their type.'
                : list.parent && !parent
                  ? 'Choose their sub-county.'
                  : ''
      }
      send={() => addEntries(list.path, names.map((name) => ({ name, type: type || undefined, parentId: parent || undefined })))}
      saved={() => void qc.invalidateQueries({ queryKey: ['lists'] })}
      done={(r) => `${r.added ?? 0} added${r.skipped ? `, ${r.skipped} skipped as already on the list` : ''}.`}
    >
      <Field id="bulk-names" label="Names" hint={`${names.length} name${names.length === 1 ? '' : 's'}, blank lines and repeats left out. Up to ${BULK_MAX} at a time.`}>
        <textarea id="bulk-names" rows={10} value={text} onChange={(e) => setText(e.target.value)} aria-describedby="bulk-names-hint" className={textareaClass} />
      </Field>
      {list.types.length ? (
        <Field id="bulk-type" label="Type of all of them">
          <TypeSelect id="bulk-type" list={list} value={type} onChange={setType} />
        </Field>
      ) : null}
      {list.parent ? (
        <Field id="bulk-parent" label="Sub-county of all of them">
          <select id="bulk-parent" value={parent} onChange={(e) => setParent(e.target.value)} className={selectClass}>
            <option value="">Choose a sub-county</option>
            <PlaceOptions list={list} places={places} />
          </select>
        </Field>
      ) : null}
    </FormDialog>
  );
}

function ChangeEntry({ list, entry, rows, onClose }: { list: PickList; entry: ListEntry | null; rows: { k: string; v: React.ReactNode }[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState('');
  React.useEffect(() => {
    setName(entry?.name ?? '');
    setType(entry?.type ?? '');
  }, [entry]);
  const newName = name.trim() !== entry?.name ? name.trim() : undefined;
  const newType = list.types.length && type !== (entry?.type ?? '') ? type : undefined;
  return (
    <FormDialog
      open={!!entry}
      title={`Change ${entry?.name ?? ''}`}
      description="Members who picked it see the new name. A name already on the list, in any case, is refused."
      rows={rows}
      confirm="Save"
      onClose={onClose}
      check={() => (!name.trim() ? 'Enter the name.' : newName === undefined && newType === undefined ? 'Nothing is changed.' : '')}
      send={() => changeEntry(list.path, entry!.id!, { name: newName, type: newType })}
      saved={() => void qc.invalidateQueries({ queryKey: ['lists'] })}
      done="The entry is changed."
    >
      <Field id="change-name" label="Name">
        <Input id="change-name" value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} />
      </Field>
      {list.types.length ? (
        <Field id="change-type" label="Type">
          <TypeSelect id="change-type" list={list} value={type} onChange={setType} />
        </Field>
      ) : null}
    </FormDialog>
  );
}

// ------------------------------------------------------------------ members' requests

function Requests({ params: p, manage }: { params: Params; manage: boolean }) {
  const qc = useQueryClient();
  const [approving, setApproving] = React.useState<ListRequest | null>(null);
  const [merging, setMerging] = React.useState<ListRequest | null>(null);
  const [decision, setDecision] = React.useState<Decision | null>(null);
  const status = p.status === 'all' ? undefined : p.status ?? 'PENDING';

  const query = useQuery({
    queryKey: ['lists', 'requests', { status, page: p.page, size: p.size }],
    queryFn: () => listRequests({ status, page: p.page, size: p.size }),
    placeholderData: keepPreviousData
  });

  const menuFor = (r: ListRequest): RowAction[] => {
    if (!manage || r.status !== 'PENDING') return [];
    return [
      { label: 'Approve as a new entry', why: '', run: () => setApproving(r) },
      { label: 'Approve as an entry already on the list', why: '', run: () => setMerging(r) },
      {
        label: 'Reject',
        why: '',
        run: () =>
          setDecision({
            title: `Reject “${r.name}”?`,
            description: "It isn't added, and comes off the member's background. The member sees your note.",
            confirm: 'Reject',
            danger: true,
            rows: requestRows(r),
            note: { label: 'Note to the member', hint: NOTE_HINT },
            run: (note) => rejectRequest(r.requestId!, note),
            done: () => {
              toast.success(`“${r.name}” is rejected.`);
              void qc.invalidateQueries({ queryKey: ['lists'] });
            }
          })
      }
    ];
  };

  const rows = query.data?.results ?? [];
  const total = query.data?.totalResults ?? 0;
  const columns: Column<ListRequest>[] = [
    { header: 'Asked for', cell: (r) => r.name },
    { header: 'List', cell: listCell },
    { header: 'Member', cell: memberCell },
    { header: 'Asked', cell: (r) => formatDateTime(r.requestedAt) },
    { header: 'Outcome', cell: outcome },
    { header: 'Status', cell: (r) => <StatusPill label={listRequestStatus(r.status)} /> }
  ];

  const body = query.isPending ? (
    <p className="m-0 px-4 py-5 text-muted">Loading requests…</p>
  ) : query.isError ? (
    <div className="p-3.5">
      <Banner tone="bad">{errorMessage(query.error)}</Banner>
    </div>
  ) : !rows.length ? (
    <p className="m-0 px-4 py-5 text-muted">{status === 'PENDING' ? 'No requests are waiting.' : 'No requests match.'}</p>
  ) : (
    <MenuRows label="Requests" rows={rows} rowKey={(r) => r.requestId!} columns={columns} grid="grid-cols-[1.2fr_1fr_1fr_0.9fr_1.2fr_0.7fr]" minWidth={980} menuFor={menuFor} sub={(r) => (
        <>
          {`${listLabel(r)} · ${fullName(r.member)} · ${formatDateTime(r.requestedAt)}`}
          {r.status !== 'PENDING' ? <span className="mt-0.5 block text-ink">{outcome(r)}</span> : null}
        </>
      )} />
  );

  return (
    <>
      <Muted>Newest first. Approve a request as a new entry, correcting its name or type if needed, or as an entry already on the list when it is a duplicate under another spelling. Either way the member's pick then counts.</Muted>
      <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
        {STATUS_CHIPS.map((c) => (
          <Chip key={c.label} on={p.status === c.value} onClick={() => p.update({ status: c.value })}>
            {c.label}
          </Chip>
        ))}
      </div>
      <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface', query.isFetching && !query.isPending && 'opacity-70')} aria-busy={query.isFetching}>
        {body}
        {total > 0 ? <Pager page={p.page} size={p.size} total={total} onPage={(n) => p.update({ page: n })} onSize={(s) => p.update({ size: s })} /> : null}
      </section>

      <ApproveNew request={approving} onClose={() => setApproving(null)} />
      <ApproveExisting request={merging} onClose={() => setMerging(null)} />
      <DecisionDialog decision={decision} onClose={() => setDecision(null)} />
    </>
  );
}

const listLabel = (r: ListRequest) => {
  const list = pickList(r.list);
  const name = list ? list.label : r.list ?? '—';
  return r.type ? `${name}: ${entryType(r.type)}` : name;
};
const listCell = (r: ListRequest) => listLabel(r);
const memberCell = (r: ListRequest) =>
  r.member?.memberId ? (
    <Link to={`/members/${r.member.memberId}`} className="text-primary">
      {fullName(r.member) || 'The member'}
    </Link>
  ) : (
    '—'
  );
function outcome(r: ListRequest): React.ReactNode {
  if (r.status === 'APPROVED') return <span className="flex flex-col">As {r.entry?.name ?? '—'}<Reviewed r={r} /></span>;
  if (r.status === 'REJECTED') return <span className="flex flex-col">{r.note ? `“${r.note}”` : 'No note'}<Reviewed r={r} /></span>;
  if (r.status === 'WITHDRAWN') return 'The member removed it';
  return '—';
}
const Reviewed = ({ r }: { r: ListRequest }) => (r.reviewedAt ? <span className="text-[12px] text-muted">{formatDateTime(r.reviewedAt)}</span> : null);

const requestRows = (r: ListRequest) => [
  { k: 'Asked for', v: r.name },
  { k: 'List', v: listLabel(r) },
  { k: 'Member', v: fullName(r.member) || '—' },
  { k: 'Asked', v: formatDateTime(r.requestedAt) }
];

function ApproveNew({ request, onClose }: { request: ListRequest | null; onClose: () => void }) {
  const qc = useQueryClient();
  const list = pickList(request?.list);
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState('');
  React.useEffect(() => {
    setName(request?.name ?? '');
    setType(request?.type ?? '');
  }, [request]);
  return (
    <FormDialog
      open={!!request}
      title="Approve as a new entry"
      description="It is added to the list, and the member's pick counts. Correct the name or type first if needed: every member sees it as written here."
      rows={request ? requestRows(request) : []}
      confirm="Approve and add"
      onClose={onClose}
      check={() => (!name.trim() ? 'Enter the name.' : list?.types.length && !type ? 'Choose its type.' : '')}
      send={() => approveRequest(request!.requestId!, { name: name.trim(), type: type || undefined })}
      saved={() => void qc.invalidateQueries({ queryKey: ['lists'] })}
      done={`${name.trim()} is added and the request approved.`}
    >
      <Field id="approve-name" label="Name">
        <Input id="approve-name" value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} />
      </Field>
      {list?.types.length ? (
        <Field id="approve-type" label="Type">
          <TypeSelect id="approve-type" list={list} value={type} onChange={setType} />
        </Field>
      ) : null}
    </FormDialog>
  );
}

function ApproveExisting({ request, onClose }: { request: ListRequest | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [chosen, setChosen] = React.useState<ListEntry | null>(null);
  React.useEffect(() => {
    setText(request?.name ?? '');
    setSearch(request?.name ?? '');
    setChosen(null);
  }, [request]);
  React.useEffect(() => {
    const t = setTimeout(() => setSearch(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const found = useQuery({
    queryKey: ['lists', 'entries', request?.list, { q: search, pick: true }],
    queryFn: () => listEntries(request!.list!, { search: search || undefined, page: 1, size: 10 }),
    enabled: !!request?.list
  });
  const entries = found.data?.results ?? [];
  // only an entry still among the results counts, so a search that hides it leaves nothing chosen
  const picked = chosen && entries.some((e) => e.id === chosen.id) ? chosen : null;
  return (
    <FormDialog
      open={!!request}
      title="Approve as an entry already on the list"
      description="For a duplicate under another spelling. The member's pick becomes this entry, and nothing new is added."
      rows={request ? requestRows(request) : []}
      confirm="Approve"
      onClose={onClose}
      check={() => (!picked ? 'Choose the entry it is.' : '')}
      send={() => approveRequest(request!.requestId!, { entryId: picked!.id })}
      saved={() => void qc.invalidateQueries({ queryKey: ['lists'] })}
      done={`The request is approved as ${picked?.name ?? 'that entry'}.`}
    >
      <Field id="merge-search" label="Find the entry">
        <Input id="merge-search" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Part of its name" />
      </Field>
      <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
        <legend className="mb-1.5 p-0 text-sm font-medium text-ink">Entries</legend>
        {found.isError ? (
          <Banner tone="bad">{errorMessage(found.error)}</Banner>
        ) : found.isPending ? (
          <span className="text-muted">Searching…</span>
        ) : !entries.length ? (
          <span className="text-muted">Nothing on the list matches. Try a shorter part of the name.</span>
        ) : (
          entries.map((e) => (
            <label key={e.id} className="flex items-center gap-2">
              <input type="radio" name="merge-entry" className="size-4 accent-primary" checked={picked?.id === e.id} onChange={() => setChosen(e)} />
              {e.name}
              {e.type ? <span className="text-muted">· {entryType(e.type)}</span> : null}
            </label>
          ))
        )}
        {(found.data?.totalResults ?? 0) > entries.length ? <span className="text-[13px] text-muted">The first {entries.length} of {found.data?.totalResults}; type more of the name to narrow them.</span> : null}
      </fieldset>
    </FormDialog>
  );
}

// ------------------------------------------------------------------ rows with an options menu

interface Column<T> {
  header: string;
  cell: (row: T) => React.ReactNode;
}

const GRIDS: Record<number, string> = { 2: 'grid-cols-[2fr_0.6fr]', 3: 'grid-cols-[2fr_1.2fr_0.6fr]', 4: 'grid-cols-[2fr_1fr_1.2fr_0.6fr]' };
const grid = (n: number) => GRIDS[n] ?? GRIDS[4]!;

/** A table with each row's options at its end; at phone width a list with the first column, the last beside it and `sub` below. */
function MenuRows<T>({ label, rows, rowKey, columns, grid, minWidth = 640, menuFor, sub }: { label: string; rows: T[]; rowKey: (row: T) => string; columns: Column<T>[]; grid: string; minWidth?: number; menuFor: (row: T) => RowAction[]; sub: (row: T) => React.ReactNode }) {
  const compact = useCompact();
  const anyMenu = rows.some((r) => menuFor(r).length > 0);
  const first = columns[0]!;
  const last = columns.at(-1)!;
  if (compact) {
    return (
      <ul aria-label={label} className="m-0 list-none p-0">
        {rows.map((r) => (
          <li key={rowKey(r)} className="flex items-center border-b border-line last:border-b-0">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-3.5 py-2">
              <span className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="font-semibold [overflow-wrap:anywhere]">{first.cell(r)}</span>
                {last.cell(r)}
              </span>
              <span className="text-ink-3 [overflow-wrap:anywhere]">{sub(r)}</span>
            </div>
            <RowMenu name={String(first.cell(r))} actions={menuFor(r)} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth }} role="table" aria-label={label}>
        <div role="row" className={cn('grid gap-3 py-2 pl-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted', grid, anyMenu ? 'pr-[52px]' : 'pr-4')}>
          {columns.map((c) => (
            <span key={c.header} role="columnheader">
              {c.header}
            </span>
          ))}
        </div>
        {rows.map((r) => {
          const actions = menuFor(r);
          return (
            <div key={rowKey(r)} role="row" className="flex items-center border-t border-line">
              <div className={cn('grid min-h-11 min-w-0 flex-1 items-center gap-3 py-1.5 pl-4', grid, actions.length ? 'pr-0' : anyMenu ? 'pr-[52px]' : 'pr-4')}>
                {columns.map((c, i) => (
                  <span key={c.header} role="cell" className={cn('min-w-0 [overflow-wrap:anywhere]', i === 0 && 'font-semibold')}>
                    {c.cell(r)}
                  </span>
                ))}
              </div>
              <RowMenu name={String(first.cell(r))} actions={actions} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

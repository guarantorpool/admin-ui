import * as React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { errorMessage } from '@/api/errors';
import { getParameter, listChanges, listParameters, type Parameter } from '@/api/parameters';
import { PageHeader } from '@/components/shell/AppShell';
import { Badge, Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Pager } from '@/components/ui/pager';
import { Fields, Muted, SectionTitle } from '@/components/ui/parts';
import { Rows, type Column } from '@/components/ui/rows';
import { Sheet } from '@/components/ui/sheet';
import { Tabs } from '@/components/ui/tabs';
import { formatDateTime, formatNumber } from '@/lib/format';
import { can } from '@/lib/permissions';
import { groupSettings, PILLAR_WEIGHTS, settingValue } from '@/lib/settings';
import { NoAccess } from '@/pages/Placeholders';
import { useGrants } from '@/session/SessionProvider';
import { ChangeHistory, ChangeItems, useWaiting, WaitingChanges } from './SettingChanges';
import { ChangeDialog, ChangeSetDialog } from './SettingForms';

// Screen 14. Every pool setting in its group, with its value and how it changes: most need a second admin, and
// five apply at once. One can be changed on its own, or several proposed as one change set that applies together;
// the four pillar weights must total 1, so they always change as a set. Then what's waiting, and the history.

const VIEWS = ['current', 'waiting', 'history'] as const;
type View = (typeof VIEWS)[number];
const DEFAULT_SIZE = 25;
// settings on a group's card at a time
const GROUP_SIZE = 6;

/** A setting's key, breaking only after an underscore when it doesn't fit: pillar_weight_ / relationship. */
function KeyName({ name }: { name: string | undefined }) {
  const parts = (name ?? '').split('_');
  return (
    <>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {part}
          {i < parts.length - 1 ? (
            <>
              _<wbr />
            </>
          ) : null}
        </React.Fragment>
      ))}
    </>
  );
}

/** How a setting changes, or that a change to it is waiting. */
function howItChanges(p: Parameter) {
  if (p.changePending) return <Badge tone="warn">Waiting for approval</Badge>;
  return <Badge>{p.type === 'dynamic' ? 'Applies at once' : 'Two admins'}</Badge>;
}

const COLUMNS: Column<Parameter>[] = [
  {
    header: 'Setting',
    cell: (p) => (
      <span className="flex flex-col gap-0.5">
        <span className="font-mono text-[13px] [overflow-wrap:normal]">
          <KeyName name={p.key} />
        </span>
        <span className="text-[13px] font-normal text-muted">{p.description}</span>
      </span>
    )
  },
  { header: 'Value', cell: (p) => <span className="font-mono">{settingValue(p.key, p.value)}</span>, figure: true },
  { header: 'Status', cell: howItChanges }
];

export function PoolSettingsPage() {
  const grants = useGrants();
  if (!can(grants, 'PARAMETERS.READ')) return <NoAccess />;
  return <PoolSettings />;
}

function PoolSettings() {
  const navigate = useNavigate();
  const { key } = useParams();
  const [params, setParams] = useSearchParams();
  const view: View = VIEWS.find((v) => v === params.get('view')) ?? 'current';
  const canPropose = can(useGrants(), 'PARAMETERS.PROPOSE');
  const settings = useQuery({ queryKey: ['parameters', 'list'], queryFn: listParameters });
  const all = settings.data ?? [];
  const { waiting } = useWaiting();
  // the settings a change set opens with, or null while it's closed
  const [setStart, setSetStart] = React.useState<readonly string[] | null>(null);
  const [changing, setChanging] = React.useState<Parameter | null>(null);

  const update = (changes: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === undefined || v === '' || (k === 'page' && v === 1) || (k === 'size' && v === DEFAULT_SIZE) || (k === 'view' && v === 'current')) next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  const tabs = [
    { value: 'current', label: 'Current settings' },
    { value: 'waiting', label: 'Waiting for approval', count: waiting.length },
    { value: 'history', label: 'History' }
  ];

  return (
    <>
      <PageHeader actions={canPropose && view === 'current' ? <Button onClick={() => setSetStart(PILLAR_WEIGHTS)}>Propose a change set</Button> : undefined} />
      <div className="flex flex-col gap-3.5">
        <Tabs label="Pool settings" idPrefix="settings" tabs={tabs} value={view} onChange={(v) => update({ view: v, status: undefined, key: undefined, size: undefined })} />
        <div role="tabpanel" id={`settings-panel-${view}`} aria-labelledby={`settings-tab-${view}`} className="flex flex-col gap-3.5">
          {settings.isError ? (
            <Banner tone="bad">{errorMessage(settings.error)}</Banner>
          ) : view === 'current' ? (
            <Current settings={all} loading={settings.isPending} />
          ) : view === 'waiting' ? (
            <WaitingChanges />
          ) : (
            <ChangeHistory settings={all} params={params} update={update} />
          )}
        </div>
      </div>

      <Sheet open={!!key} onClose={() => navigate({ pathname: '/pool/settings', search: params.toString() })} title="Pool setting" wide={false}>
        {key ? <SettingDetail settingKey={key} onChange={setChanging} onChangeSet={setSetStart} /> : null}
      </Sheet>
      <ChangeDialog setting={changing} onClose={() => setChanging(null)} />
      <ChangeSetDialog open={!!setStart} start={setStart ?? []} settings={all} onClose={() => setSetStart(null)} />
    </>
  );
}

function Current({ settings, loading }: { settings: Parameter[]; loading: boolean }) {
  const [params] = useSearchParams();
  if (loading) return <Muted>Loading…</Muted>;
  const search = params.toString();
  return (
    <>
      <Muted>Most settings take two admins: one proposes a change and a different one approves it. The five under "Applies at once" change straight away when changed on their own. Open a setting to change it or see its history.</Muted>
      <div className="grid items-start gap-3.5 xl:grid-cols-2">
        {groupSettings(settings).map((g) => (
          <SettingGroup key={g.title} title={g.title} settings={g.settings} search={search} />
        ))}
      </div>
    </>
  );
}

/**
 * One group's card, a page of settings at a time; it opens on the setting open. Every card is one height whatever it
 * holds, and a page of long descriptions scrolls inside it.
 */
function SettingGroup({ title, settings, search }: { title: string; settings: Parameter[]; search: string }) {
  const { key } = useParams();
  const [page, setPage] = React.useState(() => Math.floor(Math.max(0, settings.findIndex((p) => p.key === key)) / GROUP_SIZE) + 1);
  const pages = Math.ceil(settings.length / GROUP_SIZE);
  // a group can shrink under the page shown, when a setting moves to "Applies at once"
  const shown = Math.min(page, Math.max(1, pages));
  return (
    <section aria-label={title} className="flex h-[30rem] min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface">
      <h2 className="m-0 px-4 pb-1 pt-3.5 text-base font-bold">{title}</h2>
      {/* a styled scrollbar is always drawn, where an overlay one (Chrome on Windows 11) hides that rows are cut off */}
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:var(--ctl)_transparent] [scrollbar-width:thin]">
        <Rows<Parameter>
          label={title}
          rows={settings.slice((shown - 1) * GROUP_SIZE, shown * GROUP_SIZE)}
          rowKey={(p) => p.key!}
          columns={COLUMNS}
          grid="grid-cols-[minmax(0,1fr)_5.5rem_10rem]"
          minWidth={480}
          linkFor={(p) => `/pool/settings/${encodeURIComponent(p.key!)}${search ? `?${search}` : ''}`}
          sub={(p) => `Value ${settingValue(p.key, p.value)}`}
        />
      </div>
      {pages > 1 ? <Pager page={shown} size={GROUP_SIZE} total={settings.length} onPage={setPage} /> : null}
    </section>
  );
}

function SettingDetail({ settingKey, onChange, onChangeSet }: { settingKey: string; onChange: (p: Parameter) => void; onChangeSet: (keys: readonly string[]) => void }) {
  const canPropose = can(useGrants(), 'PARAMETERS.PROPOSE');
  const query = useQuery({ queryKey: ['parameters', 'one', settingKey], queryFn: () => getParameter(settingKey) });
  const historyQuery = { page: 1, size: 10, key: settingKey };
  const history = useQuery({ queryKey: ['parameters', 'changes', historyQuery], queryFn: () => listChanges(historyQuery) });
  const p = query.data;
  if (query.isPending) return <Muted>Loading the setting…</Muted>;
  if (query.isError) return <Banner tone="bad">{errorMessage(query.error)}</Banner>;
  if (!p) return null;
  const weight = PILLAR_WEIGHTS.includes(settingKey);
  const total = history.data?.totalResults ?? 0;

  return (
    <>
      <section className="flex flex-col gap-3.5 rounded-card border border-line bg-surface px-5 pb-4 pt-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="m-0 font-mono text-lg font-bold">
            <KeyName name={p.key} />
          </h2>
          {howItChanges(p)}
        </div>
        {p.description ? <p className="m-0">{p.description}</p> : null}
        <Fields
          rows={[
            { k: 'Value', v: <span className="font-mono">{settingValue(p.key, p.value)}</span> },
            { k: 'How it changes', v: p.type === 'dynamic' ? 'At once, when changed on its own' : 'Proposed, then approved by a second admin' },
            { k: 'Last changed', v: p.lastUpdatedBy ? `${p.lastUpdatedBy}, ${formatDateTime(p.lastUpdatedAt, { zone: true })}` : `Set up, ${formatDateTime(p.lastUpdatedAt, { zone: true })}` },
            { k: 'Version', v: formatNumber(p.version) }
          ]}
        />
        {p.changePending ? (
          <Banner tone="warn">
            A change to this setting is waiting for approval, so another can't be proposed until it's decided. <Link to="/pool/settings?view=waiting">See what's waiting</Link>
          </Banner>
        ) : weight ? (
          <Muted>The four pillar weights must total 1, so they change together as one change set.</Muted>
        ) : null}
        {canPropose && !p.changePending ? (
          <div className="flex flex-wrap justify-end gap-2.5">
            {weight ? (
              <Button onClick={() => onChangeSet(PILLAR_WEIGHTS)}>Change the four weights</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => onChangeSet([p.key!])}>
                  Add to a change set
                </Button>
                <Button onClick={() => onChange(p)}>Change this setting</Button>
              </>
            )}
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
        <SectionTitle>History of this setting</SectionTitle>
        {history.isPending ? (
          <Muted>Loading…</Muted>
        ) : history.isError ? (
          <Banner tone="bad">{errorMessage(history.error)}</Banner>
        ) : !history.data.results?.length ? (
          <Muted>It hasn't been changed since it was set up.</Muted>
        ) : (
          <>
            <ChangeItems changes={history.data.results} label="Changes to this setting" />
            {total > history.data.results.length ? (
              <Link to={`/pool/settings?view=history&key=${encodeURIComponent(settingKey)}`}>See all {formatNumber(total)} changes</Link>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}

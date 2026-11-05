import * as React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { errorMessage } from '@/api/errors';
import { getParameter, listChanges, listParameters, type Parameter } from '@/api/parameters';
import { PageHeader } from '@/components/shell/AppShell';
import { Badge, Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Fields, Muted, SectionTitle } from '@/components/ui/parts';
import { Rows, type Column } from '@/components/ui/rows';
import { Sheet } from '@/components/ui/sheet';
import { Tabs } from '@/components/ui/tabs';
import { formatDateTime, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
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

  // closing a setting opened by a link with no group keeps the setting's group in view
  const closingSearch = () => {
    const next = new URLSearchParams(params);
    const g = view === 'current' && !next.has('group') ? shownGroup(groupSettings(all), null, key) : undefined;
    if (g) next.set('group', groupSlug(g.title));
    return next.toString();
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

      <Sheet open={!!key} onClose={() => navigate({ pathname: '/pool/settings', search: closingSearch() })} title="Pool setting" wide={false}>
        {key ? <SettingDetail settingKey={key} onChange={setChanging} onChangeSet={setSetStart} /> : null}
      </Sheet>
      <ChangeDialog setting={changing} onClose={() => setChanging(null)} />
      <ChangeSetDialog open={!!setStart} start={setStart ?? []} settings={all} onClose={() => setSetStart(null)} />
    </>
  );
}

function Current({ settings, loading }: { settings: Parameter[]; loading: boolean }) {
  const { key } = useParams();
  const [params] = useSearchParams();
  const groups = groupSettings(settings);
  const shown = shownGroup(groups, params.get('group'), key);
  // on narrow screens the groups are a row that scrolls sideways; keep the one shown in view
  const currentRef = React.useRef<HTMLAnchorElement | null>(null);
  React.useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [shown?.title]);
  if (loading) return <Muted>Loading…</Muted>;
  if (!shown) return null;
  const search = params.toString();
  const groupLink = (title: string) => {
    const next = new URLSearchParams(params);
    next.set('group', groupSlug(title));
    return `/pool/settings?${next.toString()}`;
  };
  return (
    <>
      <Muted>Most settings take two admins: one proposes a change and a different one approves it. The five under "Applies at once" change straight away when changed on their own. Open a setting to change it or see its history.</Muted>
      <div className="grid items-start gap-3.5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* the groups; a column beside the one shown on wide screens, a row across the top on narrow ones */}
        <nav aria-label="Setting groups" className="flex min-w-0 gap-1 overflow-x-auto rounded-card border border-line bg-surface p-1.5 lg:flex-col lg:overflow-visible">
          {groups.map((g) => {
            const waitingIn = g.settings.filter((p) => p.changePending).length;
            const current = g.title === shown.title;
            return (
              <Link
                key={g.title}
                ref={current ? currentRef : undefined}
                to={groupLink(g.title)}
                replace
                aria-current={current ? 'true' : undefined}
                className={cn(
                  'flex min-h-9 shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-ctl px-2.5 no-underline lg:whitespace-normal',
                  current ? 'bg-selected font-semibold text-ink-strong' : 'text-ink hover:bg-page'
                )}
              >
                <span>{g.title}</span>
                <span className="flex items-center gap-1.5 text-[13px] tabular-nums text-muted">
                  {waitingIn ? (
                    <span title={`${waitingIn} waiting for approval`} className="rounded-full bg-warn-bg px-[7px] text-xs font-semibold leading-5 text-warn-fg">
                      {waitingIn}
                      <span className="sr-only"> waiting for approval</span>
                    </span>
                  ) : null}
                  <span>
                    {g.settings.length}
                    <span className="sr-only"> settings</span>
                  </span>
                </span>
              </Link>
            );
          })}
        </nav>
        <SettingGroup title={shown.title} settings={shown.settings} search={search} />
      </div>
    </>
  );
}

/** The group a setting group's link names, as it reads in the address: "trust-score-benchmarks". */
const groupSlug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The group shown: the one in the address, else the open setting's, else the first. */
function shownGroup<T extends { title: string; settings: Parameter[] }>(groups: T[], slug: string | null, key: string | undefined): T | undefined {
  return groups.find((g) => groupSlug(g.title) === slug) ?? groups.find((g) => g.settings.some((p) => p.key === key)) ?? groups[0];
}

/** One group's settings, all of them, with their descriptions; the page is as long as the group. */
function SettingGroup({ title, settings, search }: { title: string; settings: Parameter[]; search: string }) {
  return (
    <section aria-label={title} className="min-w-0 rounded-card border border-line bg-surface">
      <h2 className="m-0 px-4 pb-1 pt-3.5 text-base font-bold">{title}</h2>
      <Rows<Parameter>
        label={title}
        rows={settings}
        rowKey={(p) => p.key!}
        columns={COLUMNS}
        grid="grid-cols-[minmax(0,1fr)_5.5rem_10rem]"
        minWidth={480}
        linkFor={(p) => `/pool/settings/${encodeURIComponent(p.key!)}${search ? `?${search}` : ''}`}
        sub={(p) => `Value ${settingValue(p.key, p.value)}`}
      />
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

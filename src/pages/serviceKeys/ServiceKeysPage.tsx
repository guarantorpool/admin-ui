import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage } from '@/api/errors';
import { createServiceKey, listServiceKeys, revokeServiceKey, rotateServiceKey, SCOPES, type CreatedServiceKey, type ServiceKey } from '@/api/serviceKeys';
import { PageHeader } from '@/components/shell/AppShell';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { DecisionDialog, type Decision } from '@/components/ui/decision-dialog';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FormDialog } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Pager, PAGE_SIZES } from '@/components/ui/pager';
import { Muted, StatusPill } from '@/components/ui/parts';
import { RowMenu, type RowAction } from '@/components/ui/row-menu';
import { formatDateTime } from '@/lib/format';
import { keyStatus, scopeLabel } from '@/lib/labels';
import { can } from '@/lib/permissions';
import { useCompact } from '@/lib/useMedia';
import { cn } from '@/lib/utils';
import { NoAccess } from '@/pages/Placeholders';
import { useGrants } from '@/session/SessionProvider';

// Screen 19. The keys other systems use to call the GP API, such as the system that sends activity records.
// A key's secret is shown once, when it is created or rotated; the GP API keeps only its hash.

const DEFAULT_SIZE = 25;
const NAME_MAX = 100;

export function ServiceKeysPage() {
  const grants = useGrants();
  if (!can(grants, 'SERVICE_KEYS.READ')) return <NoAccess />;
  return <ServiceKeys />;
}

function ServiceKeys() {
  const grants = useGrants();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = React.useState(false);
  const [secret, setSecret] = React.useState<{ created: CreatedServiceKey; rotated: boolean } | null>(null);
  const [decision, setDecision] = React.useState<Decision | null>(null);
  const manage = can(grants, 'SERVICE_KEYS.MANAGE');

  const includeRevoked = params.get('show') === 'all';
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

  const query = useQuery({
    queryKey: ['service-keys', 'list', { page, size, includeRevoked }],
    queryFn: () => listServiceKeys({ page, size, includeRevoked }),
    placeholderData: keepPreviousData
  });

  const changed = () => void qc.invalidateQueries({ queryKey: ['service-keys'] });

  const menuFor = (k: ServiceKey): RowAction[] => {
    if (!manage || k.revokedAt) return [];
    const rows = [
      { k: 'Name', v: k.name ?? '—' },
      { k: 'Can', v: scopes(k) },
      { k: 'Starts with', v: <code className="font-mono">{k.keyPrefix}</code> }
    ];
    return [
      {
        label: 'Rotate',
        why: '',
        run: () =>
          setDecision({
            title: `Rotate ${k.name}?`,
            description: 'A new key with the same name and permissions is made, and shown to you once. This key stops working at once, so put the new one in the system that uses it straight away.',
            confirm: 'Rotate',
            rows,
            run: async () => setSecret({ created: await rotateServiceKey(k.id!), rotated: true }),
            done: changed
          })
      },
      {
        label: 'Revoke',
        why: '',
        run: () =>
          setDecision({
            title: `Revoke ${k.name}?`,
            description: "The key stops working at once and can't be used again. A system still using it is refused until it is given a new key.",
            confirm: 'Revoke',
            danger: true,
            rows,
            run: () => revokeServiceKey(k.id!),
            done: () => {
              toast.success(`${k.name} is revoked.`);
              changed();
            }
          })
      }
    ];
  };

  const total = query.data?.totalResults ?? 0;
  const list = query.isPending ? (
    <p className="m-0 px-4 py-5 text-muted">Loading keys…</p>
  ) : query.isError ? (
    <div className="p-3.5">
      <Banner tone="bad">{errorMessage(query.error)}</Banner>
    </div>
  ) : !query.data.results?.length ? (
    <p className="m-0 px-4 py-5 text-muted">{includeRevoked ? 'No keys yet.' : 'No keys in use.'}</p>
  ) : (
    <KeyRows rows={query.data.results} menuFor={menuFor} />
  );

  return (
    <>
      <PageHeader actions={manage ? <Button onClick={() => setCreating(true)}>Create a key</Button> : undefined} />
      <div className="flex flex-col gap-3.5">
        <Muted>Other systems call the GP API with these keys, such as the one that sends members' activity records. Each key can do only what it is given.</Muted>
        <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
          <Chip on={!includeRevoked} onClick={() => update({ show: undefined })}>
            In use
          </Chip>
          <Chip on={includeRevoked} onClick={() => update({ show: 'all' })}>
            All, with revoked
          </Chip>
        </div>
        <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface', query.isFetching && !query.isPending && 'opacity-70')} aria-busy={query.isFetching}>
          {list}
          {total > 0 ? <Pager page={page} size={size} total={total} onPage={(p) => update({ page: p })} onSize={(s) => update({ size: s })} /> : null}
        </section>
      </div>

      <CreateKey open={creating} onClose={() => setCreating(false)} onCreated={(created) => {
        setSecret({ created, rotated: false });
        changed();
      }} />
      <SecretDialog shown={secret} onClose={() => setSecret(null)} />
      <DecisionDialog decision={decision} onClose={() => setDecision(null)} />
    </>
  );
}

const scopes = (k: ServiceKey) => (k.scopes?.length ? k.scopes.map(scopeLabel).join(', ') : '—');
const lastUsed = (k: ServiceKey) => (k.lastUsedAt ? `${formatDateTime(k.lastUsedAt)}, ${k.useCount} use${k.useCount === 1 ? '' : 's'} in all` : 'Never used');
/** How a key stopped working: rotating it revokes it too, with the new key in replacedById. */
const stopped = (k: ServiceKey) => (k.replacedById ? 'replaced' : 'revoked');
const status = (k: ServiceKey) => keyStatus(k.revokedAt ? (k.replacedById ? 'rotated' : 'revoked') : 'active');
const COLUMNS = 'grid-cols-[1.1fr_1.3fr_0.8fr_0.6fr_1fr_1fr]';

function KeyRows({ rows, menuFor }: { rows: ServiceKey[]; menuFor: (k: ServiceKey) => RowAction[] }) {
  const compact = useCompact();
  const anyMenu = rows.some((k) => menuFor(k).length > 0);
  if (compact) {
    return (
      <ul aria-label="Service keys" className="m-0 list-none p-0">
        {rows.map((k) => (
          <li key={k.id} className="flex items-center border-b border-line last:border-b-0">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-3.5 py-2">
              <span className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="font-semibold [overflow-wrap:anywhere]">{k.name}</span>
                <StatusPill label={status(k)} />
              </span>
              <span className="text-ink-3 [overflow-wrap:anywhere]">
                {scopes(k)} · <code className="font-mono">{k.keyPrefix}…</code>
              </span>
              <span className="text-ink-3 [overflow-wrap:anywhere]">
                Made {formatDateTime(k.createdAt)} by {k.createdBy} · {k.revokedAt ? `${stopped(k)} ${formatDateTime(k.revokedAt)}` : lastUsed(k).toLowerCase()}
              </span>
            </div>
            <RowMenu name={k.name ?? 'this key'} actions={menuFor(k)} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[900px]" role="table" aria-label="Service keys">
        <div role="row" className={cn('grid gap-3 py-2 pl-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted', COLUMNS, anyMenu ? 'pr-[52px]' : 'pr-4')}>
          {['Name', 'Can', 'Starts with', 'Status', 'Made', 'Last used'].map((h) => (
            <span key={h} role="columnheader">
              {h}
            </span>
          ))}
        </div>
        {rows.map((k) => {
          const actions = menuFor(k);
          return (
            <div key={k.id} role="row" className="flex items-center border-t border-line">
              <div className={cn('grid min-h-11 min-w-0 flex-1 items-center gap-3 py-1.5 pl-4', COLUMNS, actions.length ? 'pr-0' : anyMenu ? 'pr-[52px]' : 'pr-4')}>
                <span role="cell" className="min-w-0 font-semibold [overflow-wrap:anywhere]">{k.name}</span>
                <span role="cell" className="min-w-0 [overflow-wrap:anywhere]">{scopes(k)}</span>
                <span role="cell" className="min-w-0">
                  <code className="font-mono text-[13px]">{k.keyPrefix}…</code>
                </span>
                <span role="cell"><StatusPill label={status(k)} /></span>
                <span role="cell" className="flex min-w-0 flex-col">
                  {formatDateTime(k.createdAt)}
                  <span className="text-[12px] text-muted [overflow-wrap:anywhere]">by {k.createdBy}</span>
                </span>
                <span role="cell" className="flex min-w-0 flex-col">
                  {k.revokedAt ? (
                    <>
                      {k.lastUsedAt ? formatDateTime(k.lastUsedAt) : 'Never used'}
                      <span className="text-[12px] text-muted">
                        {stopped(k)} {formatDateTime(k.revokedAt)}
                      </span>
                    </>
                  ) : k.lastUsedAt ? (
                    <>
                      {formatDateTime(k.lastUsedAt)}
                      <span className="text-[12px] text-muted">
                        {k.useCount} use{k.useCount === 1 ? '' : 's'} in all
                      </span>
                    </>
                  ) : (
                    'Never used'
                  )}
                </span>
              </div>
              <RowMenu name={k.name ?? 'this key'} actions={actions} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CreateKey({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (created: CreatedServiceKey) => void }) {
  const [name, setName] = React.useState('');
  const [granted, setGranted] = React.useState<string[]>([]);
  React.useEffect(() => {
    setName('');
    setGranted([]);
  }, [open]);
  return (
    <FormDialog
      open={open}
      title="Create a key"
      description="The new key is shown to you once, so have the system that will use it ready."
      confirm="Create the key"
      onClose={onClose}
      check={() => (!name.trim() ? 'Enter a name for the key.' : !granted.length ? 'Choose what the key can do.' : '')}
      send={() => createServiceKey({ name: name.trim(), scopes: granted })}
      saved={onCreated}
      done={`${name.trim()} is created.`}
    >
      <Field id="key-name" label="Name" hint="Say which system uses it, such as “Ledger sync”.">
        <Input id="key-name" value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} aria-describedby="key-name-hint" />
      </Field>
      <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
        <legend className="mb-1.5 p-0 text-sm font-medium text-ink">What it can do</legend>
        {SCOPES.map((s) => (
          <label key={s} className="flex items-center gap-2" title={s}>
            <input type="checkbox" className="size-4 accent-primary" checked={granted.includes(s)} onChange={(e) => setGranted((g) => (e.target.checked ? [...g, s] : g.filter((x) => x !== s)))} />
            {scopeLabel(s)}
          </label>
        ))}
      </fieldset>
    </FormDialog>
  );
}

/** The new key's secret, this once. */
function SecretDialog({ shown, onClose }: { shown: { created: CreatedServiceKey; rotated: boolean } | null; onClose: () => void }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown!.created.key!);
      toast.success('The key is copied.');
    } catch {
      toast.error("The key couldn't be copied. Select it and copy it yourself.");
    }
  };
  const name = shown?.created.details?.name;
  return (
    <Dialog open={!!shown} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        {shown ? (
          <div className="flex flex-col gap-3.5">
            <DialogTitle>{shown.rotated ? `The new key for ${name}` : `The key for ${name}`}</DialogTitle>
            <DialogDescription>Copy it now and put it in the system that uses it. This is the only time it is shown; if it is lost, rotate the key to get a new one.</DialogDescription>
            {shown.rotated ? <Banner tone="warn">The old key has stopped working.</Banner> : null}
            <Field id="new-key" label="Key">
              <Input id="new-key" readOnly value={shown.created.key} onFocus={(e) => e.target.select()} className="font-mono" />
            </Field>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => void copy()}>
                Copy the key
              </Button>
              <Button type="button" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

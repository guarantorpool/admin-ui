import * as React from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage } from '@/api/errors';
import { decideChange, decideChangeSet, getChangeSet, listChanges, type ChangeQuery, type ChangeStatus, type Parameter, type ParameterChange } from '@/api/parameters';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { DecisionDialog, NOTE_HINT, type Decision } from '@/components/ui/decision-dialog';
import { selectClass } from '@/components/ui/form-dialog';
import { Pager, PAGE_SIZES } from '@/components/ui/pager';
import { Item, Items, StatusPill } from '@/components/ui/parts';
import { formatDateTime, formatNumber } from '@/lib/format';
import { changeStatus } from '@/lib/labels';
import { can } from '@/lib/permissions';
import { settingValue } from '@/lib/settings';
import { cn } from '@/lib/utils';
import { useGrants, useSession } from '@/session/SessionProvider';

// The changes to pool settings: those waiting for a second admin, each change or change set with approve and
// reject, and the history of every change.

// one change at a time can wait per setting, so every waiting change fits on one page
const WAITING: ChangeQuery = { page: 1, size: 100, status: 'pending' };
const DEFAULT_SIZE = 25;

const STATUS_FILTERS: { value: ChangeStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Waiting for approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'applied', label: 'Applied at once' }
];

/** "operating_fee_rate: 0.02 to 0.03", in full. */
export const changeLine = (c: ParameterChange) => `${c.key}: ${settingValue(c.key, c.oldValue)} to ${settingValue(c.key, c.newValue)}`;

const isMine = (by: string | undefined, email: string | undefined) => !!by && by.toLowerCase() === email?.toLowerCase();

/** A single change, or the changes of one change set, as they wait together. */
export type Waiting = { kind: 'change'; change: ParameterChange } | { kind: 'set'; id: string; changes: ParameterChange[] };

export function groupWaiting(changes: readonly ParameterChange[]): Waiting[] {
  const out: Waiting[] = [];
  const sets = new Map<string, ParameterChange[]>();
  for (const c of changes) {
    if (!c.changeSetId) {
      out.push({ kind: 'change', change: c });
      continue;
    }
    const set = sets.get(c.changeSetId);
    if (set) set.push(c);
    else {
      const first = [c];
      sets.set(c.changeSetId, first);
      out.push({ kind: 'set', id: c.changeSetId, changes: first });
    }
  }
  return out;
}

/** What's waiting for approval, shared by the tab and its count. */
export function useWaiting() {
  const query = useQuery({ queryKey: ['parameters', 'changes', WAITING], queryFn: () => listChanges(WAITING) });
  return { query, waiting: groupWaiting(query.data?.results ?? []) };
}

export function WaitingChanges() {
  const qc = useQueryClient();
  const { session } = useSession();
  const canApprove = can(useGrants(), 'PARAMETERS.APPROVE');
  const { query, waiting } = useWaiting();
  const [decision, setDecision] = React.useState<Decision | null>(null);

  const finish = async () => {
    await qc.invalidateQueries({ queryKey: ['parameters'] });
    await qc.invalidateQueries({ queryKey: ['pool'] });
  };
  const note = { label: 'Note (optional)', hint: `${NOTE_HINT} Kept with the change and in the audit log.` };

  const decideOne = (c: ParameterChange, approve: boolean) =>
    setDecision({
      title: approve ? 'Approve this change?' : 'Reject this change?',
      description: approve ? 'It takes effect as soon as it is approved. The GP API checks the value against its range again, and refuses it if the setting has changed since.' : 'The setting keeps its value. The change can be proposed again.',
      confirm: approve ? 'Approve' : 'Reject',
      danger: !approve,
      rows: [
        { k: 'Setting', v: <span className="font-mono">{c.key}</span> },
        { k: 'Now', v: settingValue(c.key, c.oldValue) },
        { k: 'New value', v: settingValue(c.key, c.newValue) },
        { k: 'Reason', v: c.reason ?? '—' },
        { k: 'Proposed by', v: `${c.proposedBy ?? '—'}, ${formatDateTime(c.proposedAt, { zone: true })}` }
      ],
      note,
      run: async (n) => {
        await decideChange(c.id!, approve ? 'approve' : 'reject', n || undefined);
        await finish();
      },
      done: () => toast.success(`${approve ? 'Approved' : 'Rejected'}: ${changeLine(c)}.`)
    });

  // the set as the GP API holds it now, so what's approved is the whole set, not this page's copy of it
  const decideSet = async (id: string, approve: boolean) => {
    let set;
    try {
      set = await getChangeSet(id);
    } catch (err) {
      toast.error(errorMessage(err));
      return;
    }
    const changes = set.changes ?? [];
    const first = changes[0];
    setDecision({
      title: approve ? 'Approve this change set?' : 'Reject this change set?',
      description: approve ? 'Every value in the set takes effect together. The GP API refuses the whole set if any of these settings has changed since it was proposed.' : 'Every setting in the set keeps its value. The set can be proposed again.',
      confirm: approve ? 'Approve the set' : 'Reject the set',
      danger: !approve,
      rows: [
        ...changes.map((c) => ({ k: c.key ?? '—', v: `${settingValue(c.key, c.oldValue)} to ${settingValue(c.key, c.newValue)}` })),
        { k: 'Reason', v: first?.reason ?? '—' },
        { k: 'Proposed by', v: `${first?.proposedBy ?? '—'}, ${formatDateTime(first?.proposedAt, { zone: true })}` }
      ],
      note,
      run: async (n) => {
        await decideChangeSet(id, approve ? 'approve' : 'reject', n || undefined);
        await finish();
      },
      done: () => toast.success(`${approve ? 'Approved' : 'Rejected'}: the change set of ${formatNumber(changes.length)}.`)
    });
  };

  const buttons = (mine: boolean, approve: () => void, reject: () => void) =>
    canApprove ? (
      <>
        <Button variant="danger" size="sm" disabled={mine} onClick={reject}>
          Reject
        </Button>
        <Button size="sm" disabled={mine} onClick={approve}>
          Approve
        </Button>
      </>
    ) : undefined;

  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface">
      {query.isPending ? (
        <p className="m-0 px-4 py-5 text-muted">Loading…</p>
      ) : query.isError ? (
        <div className="p-3.5">
          <Banner tone="bad">{errorMessage(query.error)}</Banner>
        </div>
      ) : !waiting.length ? (
        <p className="m-0 px-4 py-5 text-muted">No setting changes are waiting.</p>
      ) : (
        <Items label="Waiting changes" inset>
          {waiting.map((w) => {
            const head = w.kind === 'change' ? w.change : w.changes[0]!;
            const mine = isMine(head.proposedBy, session?.email);
            const by = (
              <>
                Proposed by {mine ? 'you' : head.proposedBy}, {formatDateTime(head.proposedAt)}
                {mine && canApprove ? '. You proposed it, so a different admin approves or rejects it.' : ''}
              </>
            );
            return w.kind === 'change' ? (
              <Item
                key={w.change.id}
                title={changeLine(w.change)}
                sub={
                  <>
                    {w.change.reason ?? 'No reason given'}
                    <br />
                    {by}
                  </>
                }
                status={<StatusPill label={changeStatus(w.change.status)} />}
                actions={buttons(
                  mine,
                  () => decideOne(w.change, true),
                  () => decideOne(w.change, false)
                )}
              />
            ) : (
              <Item
                key={w.id}
                title={`Change set of ${formatNumber(w.changes.length)}`}
                sub={
                  <>
                    {w.changes.map((c) => (
                      <React.Fragment key={c.id}>
                        <span className="font-mono text-[13px]">{changeLine(c)}</span>
                        <br />
                      </React.Fragment>
                    ))}
                    {head.reason ?? 'No reason given'}
                    <br />
                    {by}
                  </>
                }
                status={<StatusPill label={changeStatus(head.status)} />}
                actions={buttons(
                  mine,
                  () => void decideSet(w.id, true),
                  () => void decideSet(w.id, false)
                )}
              />
            );
          })}
        </Items>
      )}
      <DecisionDialog decision={decision} onClose={() => setDecision(null)} />
    </section>
  );
}

/** Every change, newest proposal first, filtered by status and setting. */
export function ChangeHistory({ settings, params, update }: { settings: readonly Parameter[]; params: URLSearchParams; update: (c: Record<string, string | number | undefined>) => void }) {
  const status = STATUS_FILTERS.find((f) => f.value && f.value === params.get('status'))?.value ?? '';
  // as the address gives it, not checked against the settings, so the first request is already filtered
  const key = params.get('key')?.trim() ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const sizeParam = Number(params.get('size'));
  const size = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : DEFAULT_SIZE;
  const q: ChangeQuery = { page, size, status: status || undefined, key: key || undefined };
  const query = useQuery({ queryKey: ['parameters', 'changes', q], queryFn: () => listChanges(q), placeholderData: keepPreviousData });
  const total = query.data?.totalResults ?? 0;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => (
            <Chip key={f.label} on={status === f.value} onClick={() => update({ status: f.value })}>
              {f.label}
            </Chip>
          ))}
        </div>
        <select aria-label="Setting" value={key} onChange={(e) => update({ key: e.target.value })} className={cn(selectClass, 'w-auto min-w-[220px] font-mono text-[13px]')}>
          <option value="">Every setting</option>
          {[...settings]
            .sort((a, b) => (a.key ?? '').localeCompare(b.key ?? ''))
            .map((s) => (
              <option key={s.key} value={s.key}>
                {s.key}
              </option>
            ))}
        </select>
      </div>
      <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface', query.isFetching && !query.isPending && 'opacity-70')} aria-busy={query.isFetching}>
        {query.isPending ? (
          <p className="m-0 px-4 py-5 text-muted">Loading…</p>
        ) : query.isError ? (
          <div className="p-3.5">
            <Banner tone="bad">{errorMessage(query.error)}</Banner>
          </div>
        ) : !query.data.results?.length ? (
          <p className="m-0 px-4 py-5 text-muted">{status || key ? 'No changes match.' : 'No setting has been changed yet.'}</p>
        ) : (
          <ChangeItems changes={query.data.results} label="Setting changes" />
        )}
        {total > 0 ? <Pager page={page} size={size} total={total} onPage={(p) => update({ page: p })} onSize={(s) => update({ size: s })} /> : null}
      </section>
    </>
  );
}

/** Changes as history rows: what changed, who proposed it, who decided it and when. */
export function ChangeItems({ changes, label }: { changes: readonly ParameterChange[]; label: string }) {
  const { session } = useSession();
  return (
    <Items label={label} inset>
      {changes.map((c) => {
        const by = isMine(c.proposedBy, session?.email) ? 'you' : c.proposedBy;
        const decided =
          c.status === 'applied' ? null : c.decidedBy ? `; ${c.status === 'rejected' ? 'rejected' : 'approved'} by ${c.decidedBy}, ${formatDateTime(c.decidedAt)}` : '';
        return (
          <Item
            key={c.id}
            title={changeLine(c)}
            sub={
              <>
                {c.reason ?? 'No reason given'}
                <br />
                {c.status === 'applied' ? 'Changed' : 'Proposed'} by {by}, {formatDateTime(c.proposedAt)}
                {decided}
                {c.decisionNote ? `. Note: ${c.decisionNote}` : ''}
                {c.changeSetId ? '. Part of a change set' : ''}
              </>
            }
            status={<StatusPill label={changeStatus(c.status)} />}
          />
        );
      })}
    </Items>
  );
}

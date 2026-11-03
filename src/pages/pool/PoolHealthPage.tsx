import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage } from '@/api/errors';
import { decideMovement, enterMovement, getBookRatio, getUnderwritingInputs, getUtilization, listMovements, type Figure, type Movement, type MovementQuery, type MovementType } from '@/api/pool';
import { PageHeader } from '@/components/shell/AppShell';
import { Badge, Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, Lines } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { DecisionDialog, NOTE_HINT, type Decision } from '@/components/ui/decision-dialog';
import { Field } from '@/components/ui/field';
import { FormDialog, selectClass, textareaClass, useForm } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Pager, PAGE_SIZES } from '@/components/ui/pager';
import { Item, Items, Muted, StatTiles, StatusPill } from '@/components/ui/parts';
import { Tabs } from '@/components/ui/tabs';
import { formatDateTime, formatNumber, formatUsdt } from '@/lib/format';
import { factorTrigger, movementStatus, movementType, percent } from '@/lib/labels';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { NoAccess } from '@/pages/Placeholders';
import { useGrants, useSession } from '@/session/SessionProvider';

// Screen 12. The three underwriting ratios beside their settings, the book-wide solvency check, the Correction
// Factor and the totals behind it; and extra liquidity, the movements into and out of Liquid Funds that a second
// admin approves.

const PAGE_TABS = [
  { value: 'ratios', label: 'Ratios and solvency' },
  { value: 'liquidity', label: 'Extra liquidity' }
];

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Waiting for approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' }
];

const DEFAULT_SIZE = 25;
// the backend's limit on a note
const NOTE_MAX = 500;

export function PoolHealthPage() {
  const grants = useGrants();
  if (!can(grants, 'POOL.READ')) return <NoAccess />;
  return <PoolHealth />;
}

function PoolHealth() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'liquidity' ? 'liquidity' : 'ratios';
  const [entering, setEntering] = React.useState(false);
  const canManage = can(useGrants(), 'POOL.MANAGE');

  const update = (changes: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === undefined || v === '' || (k === 'page' && v === 1) || (k === 'size' && v === DEFAULT_SIZE) || (k === 'view' && v === 'ratios')) next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader actions={canManage && view === 'liquidity' ? <Button onClick={() => setEntering(true)}>Enter a movement</Button> : undefined} />
      <div className="flex flex-col gap-3.5">
        <Tabs label="Pool health" idPrefix="health" tabs={PAGE_TABS} value={view} onChange={(v) => update({ view: v, status: undefined, size: undefined })} />
        <div role="tabpanel" id={`health-panel-${view}`} aria-labelledby={`health-tab-${view}`} className="flex flex-col gap-3.5">
          {view === 'ratios' ? <Ratios /> : <Liquidity params={params} update={update} />}
        </div>
      </div>
      <MovementDialog open={entering} onClose={() => setEntering(false)} />
    </>
  );
}

// ------------------------------------------------------------------ ratios and solvency

/** One ratio's tile: the calculated value, its setting, and what a quote made now uses. */
function ratioTile(label: string, f: Figure | undefined) {
  const used = f?.toggleOn ? `Quotes use ${percent(f.applied)}` : 'Quotes use the setting';
  return {
    label,
    value: percent(f?.calculated),
    unit: `setting ${percent(f?.staticValue)}`,
    note: f?.fallback ? `Not enough data yet, so this is the setting. ${used}.` : `${used}.`
  };
}

function Ratios() {
  const inputs = useQuery({ queryKey: ['pool', 'inputs'], queryFn: getUnderwritingInputs });
  const book = useQuery({ queryKey: ['pool', 'book-ratio'], queryFn: getBookRatio });
  const util = useQuery({ queryKey: ['pool', 'utilization'], queryFn: getUtilization });
  const i = inputs.data;
  const b = book.data;
  const u = util.data;
  const lf = i?.liquidFunds;

  return (
    <div className="grid items-start gap-3.5 lg:grid-cols-[7fr_5fr]">
      <Card>
        <CardHeader title="Ratios against their settings" />
        {inputs.isError ? (
          <Banner tone="bad">{errorMessage(inputs.error)}</Banner>
        ) : !i ? (
          <Muted>Loading…</Muted>
        ) : (
          <>
            <StatTiles tiles={[ratioTile('Base default rate', i.baseDefaultRate), ratioTile('Recovery rate', i.recoveryRate), ratioTile('Liquidity ratio', i.liquidityRatio)]} />
            {!i.stored ? <Banner tone="warn">Not calculated overnight yet: these were worked out now, and quotes use the settings until the first night.</Banner> : null}
            <Lines
              rows={[
                { k: 'Loans ended in the last 12 months', v: `${formatNumber(i.loansDefaulted! + i.loansRepaidOnTime!)} (${formatNumber(i.loansDefaulted)} defaulted, ${formatNumber(i.loansRepaidOnTime)} repaid on time)` },
                { k: 'Share of those loans that defaulted', v: i.loanDefaultRate ? `${percent(i.loanDefaultRate)} (by count, not used for pricing)` : 'No loan has ended' },
                { k: 'Average strength × tenure of those loans', v: i.averageStrengthTenure ? formatNumber(i.averageStrengthTenure, 4) : '—' },
                { k: 'Recovered on claims closed in 12 months', v: `${formatUsdt(i.recoveredClosed)} of ${formatUsdt(i.claimsPaidClosed)} paid` },
                { k: 'Pool size', v: formatUsdt(i.poolSize) },
                { k: 'Worked out', v: formatDateTime(i.calculatedAt, { zone: true }) }
              ]}
            />
          </>
        )}
      </Card>

      <Card>
        <CardHeader title="Book-wide solvency check" />
        {book.isError ? (
          <Banner tone="bad">{errorMessage(book.error)}</Banner>
        ) : !b ? (
          <Muted>Loading…</Muted>
        ) : (
          <>
            <StatTiles
              tiles={[
                { label: 'Book ratio', value: b.guaranteesCounted ? formatNumber(b.bookRatioShown, 2) : '—', unit: `target ${formatNumber(b.target, 2)}`, note: b.guaranteesCounted ? (b.belowTarget ? <Badge tone="bad">Below target</Badge> : <Badge tone="ok">Passing</Badge>) : 'No guarantee is active' }
              ]}
            />
            <Muted>Premiums against their expected loss, across active and in-claim guarantees. Checked nightly; admins are emailed when it falls below the target.</Muted>
            <Lines
              rows={[
                { k: 'Premiums', v: formatUsdt(b.totalPremium) },
                { k: 'Expected loss over their tenures', v: formatUsdt(b.totalExpectedLoss) },
                { k: 'Guarantees counted', v: formatNumber(b.guaranteesCounted) },
                { k: 'Checked', v: formatDateTime(b.calculatedAt, { zone: true }) }
              ]}
            />
          </>
        )}
      </Card>

      <Card>
        <CardHeader title="Correction factor and the pool totals behind it" />
        {util.isError ? (
          <Banner tone="bad">{errorMessage(util.error)}</Banner>
        ) : !u ? (
          <Muted>Loading…</Muted>
        ) : !u.valued ? (
          <Banner tone="warn">No backing has been valued in USDT yet, so there's no correction factor. It's worked out once the first prices are read.</Banner>
        ) : (
          <>
            <StatTiles
              tiles={[
                { label: 'Correction factor', value: formatNumber(u.correctionFactor, 4), note: u.correctionApplied ? 'Every ceiling is trimmed by it' : 'Ceilings are not trimmed' },
                { label: 'Members counted', value: formatNumber(u.membersCounted) }
              ]}
            />
            <Lines
              rows={[
                { k: 'Total backing', v: formatUsdt(u.totalBackingUsdt) },
                { k: 'Outstanding guarantees', v: formatUsdt(u.totalOutstandingGuarantees) },
                { k: 'Net available', v: formatUsdt(u.netAvailableUsdt) },
                { k: 'Target utilization', v: percent(u.utilizationThreshold) },
                { k: 'Expected utilization', v: formatUsdt(u.expectedUtilization) },
                { k: 'Total Network Value', v: formatUsdt(u.totalNetworkValue) },
                { k: 'Last worked out', v: `${formatDateTime(u.calculatedAt, { zone: true })}${u.trigger ? `, ${factorTrigger(u.trigger).toLowerCase()}` : ''}` }
              ]}
            />
          </>
        )}
      </Card>

      <div className="flex flex-col gap-3.5">
        <Card>
          <CardHeader title="Liquid Funds" />
          {!lf ? (
            inputs.isError ? null : <Muted>Loading…</Muted>
          ) : (
            <>
              <StatTiles tiles={[{ label: 'Liquid Funds', value: formatNumber(lf.total, 2), unit: 'USDT', note: 'What claims are paid from' }]} />
              <Lines
                rows={[
                  { k: 'Premiums received', v: formatUsdt(lf.premiumsReceived) },
                  { k: 'Refunds paid', v: `− ${formatUsdt(lf.refundsPaid)}` },
                  { k: 'Claims paid', v: `− ${formatUsdt(lf.claimsPaid)}` },
                  { k: 'Recovered', v: `+ ${formatUsdt(lf.recovered)}` },
                  { k: 'Extra liquidity', v: `+ ${formatUsdt(lf.extraLiquidity)}` }
                ]}
              />
            </>
          )}
        </Card>
        <Card>
          <CardHeader title="No screen yet" />
          <Banner tone="plan">Planned: sweeping money sent to a retired pool wallet into the current one, and reconciliation reports and exports. Both need GP API work.</Banner>
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ extra liquidity

function Liquidity({ params, update }: { params: URLSearchParams; update: (c: Record<string, string | number | undefined>) => void }) {
  const status = STATUS_FILTERS.find((f) => f.value && f.value === params.get('status'))?.value ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const sizeParam = Number(params.get('size'));
  const size = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : DEFAULT_SIZE;
  const q: MovementQuery = { page, size, status: status || undefined };
  const query = useQuery({ queryKey: ['pool', 'movements', q], queryFn: () => listMovements(q), placeholderData: keepPreviousData });
  const inputs = useQuery({ queryKey: ['pool', 'inputs'], queryFn: getUnderwritingInputs });
  const lf = inputs.data?.liquidFunds;
  const total = query.data?.totalResults ?? 0;

  return (
    <>
      <Card>
        {inputs.isError ? (
          <Banner tone="bad">{errorMessage(inputs.error)}</Banner>
        ) : (
          <StatTiles
            tiles={[
              { label: 'Liquid Funds', value: lf ? formatNumber(lf.total, 2) : '…', unit: 'USDT', note: 'After every approved movement' },
              { label: 'Extra liquidity', value: lf ? formatNumber(lf.extraLiquidity, 2) : '…', unit: 'USDT', note: 'Approved movements in, less those out' }
            ]}
          />
        )}
      </Card>
      <Muted>A movement counts toward Liquid Funds only once a second admin approves it. If Liquid Funds are short of a claim, enter a top-up and have it approved before paying the claim.</Muted>
      <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <Chip key={f.label} on={status === f.value} onClick={() => update({ status: f.value })}>
            {f.label}
          </Chip>
        ))}
      </div>
      <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface', query.isFetching && !query.isPending && 'opacity-70')} aria-busy={query.isFetching}>
        {query.isPending ? (
          <p className="m-0 px-4 py-5 text-muted">Loading…</p>
        ) : query.isError ? (
          <div className="p-3.5">
            <Banner tone="bad">{errorMessage(query.error)}</Banner>
          </div>
        ) : !query.data.results?.length ? (
          <p className="m-0 px-4 py-5 text-muted">{status ? 'No movements match.' : 'No movement of extra liquidity has been entered.'}</p>
        ) : (
          <Movements rows={query.data.results} />
        )}
        {total > 0 ? <Pager page={page} size={size} total={total} onPage={(p) => update({ page: p })} onSize={(s) => update({ size: s })} /> : null}
      </section>
    </>
  );
}

/** Each movement, with approve and reject on those waiting, for an admin who didn't enter them. */
function Movements({ rows }: { rows: Movement[] }) {
  const qc = useQueryClient();
  const { session } = useSession();
  const canManage = can(useGrants(), 'POOL.MANAGE');
  const [decision, setDecision] = React.useState<Decision | null>(null);

  const decide = (m: Movement, approve: boolean) => {
    const what = `${movementType(m.type)}, ${formatUsdt(m.amount, { full: true })}`;
    setDecision({
      title: approve ? 'Approve this movement?' : 'Reject this movement?',
      description: approve ? `Liquid Funds go ${m.type === 'top_up' ? 'up' : 'down'} by this amount.` : 'Liquid Funds stay as they are. It can be entered afresh.',
      confirm: approve ? 'Approve' : 'Reject',
      danger: !approve,
      rows: [
        { k: 'Movement', v: movementType(m.type) },
        { k: 'Amount', v: formatUsdt(m.amount, { full: true }) },
        { k: 'Reason', v: m.note ?? '—' },
        { k: 'Entered by', v: `${m.createdBy ?? '—'}, ${formatDateTime(m.createdAt, { zone: true })}` }
      ],
      note: { label: 'Note (optional)', hint: `${NOTE_HINT} Shown on the movement and kept in the audit log.` },
      run: async (note) => {
        await decideMovement(m.adjustmentId!, approve ? 'approve' : 'reject', note || undefined);
        await qc.invalidateQueries({ queryKey: ['pool'] });
      },
      done: () => toast.success(approve ? `Approved: ${what}.` : `Rejected: ${what}.`)
    });
  };

  return (
    <>
      <Items label="Movements" inset>
        {rows.map((m) => {
          const waiting = m.status === 'pending';
          const mine = waiting && m.createdBy?.toLowerCase() === session?.email.toLowerCase();
          const decided = m.status === 'approved' ? `approved by ${m.approvedBy}, ${formatDateTime(m.approvedAt)}` : m.status === 'rejected' ? `rejected by ${m.rejectedBy}, ${formatDateTime(m.rejectedAt)}` : null;
          return (
            <Item
              key={m.adjustmentId}
              title={`${movementType(m.type)}: ${formatUsdt(m.amount, { full: waiting })}`}
              sub={
                <>
                  {m.note ?? 'No reason given'}
                  <br />
                  Entered by {mine ? 'you' : m.createdBy}, {formatDateTime(m.createdAt)}
                  {decided ? `; ${decided}` : ''}
                  {m.decisionNote ? `. Note: ${m.decisionNote}` : ''}
                  {mine && canManage ? '. You entered it, so a different admin approves or rejects it.' : ''}
                </>
              }
              status={<StatusPill label={movementStatus(m.status)} />}
              actions={
                waiting && canManage ? (
                  <>
                    <Button variant="danger" size="sm" disabled={mine} onClick={() => decide(m, false)}>
                      Reject
                    </Button>
                    <Button size="sm" disabled={mine} onClick={() => decide(m, true)}>
                      Approve
                    </Button>
                  </>
                ) : undefined
              }
            />
          );
        })}
      </Items>
      <DecisionDialog decision={decision} onClose={() => setDecision(null)} />
    </>
  );
}

/** Enters a movement of extra liquidity, in USDT, for a second admin to approve. */
function MovementDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, set] = useForm(open, { type: 'top_up', amount: '', note: '' });
  const amount = f.amount.trim() && Number(f.amount) > 0 ? Number(f.amount) : null;
  return (
    <FormDialog
      open={open}
      title="Enter a movement of extra liquidity"
      description="A second admin must approve it before Liquid Funds change."
      confirm="Enter the movement"
      onClose={onClose}
      check={() => (!amount ? 'Enter the amount, more than 0.' : !f.note.trim() ? 'Enter the reason for the movement.' : '')}
      send={() => enterMovement(f.type as MovementType, amount!, f.note.trim())}
      saved={() => void qc.invalidateQueries({ queryKey: ['pool', 'movements'] })}
      done="Movement entered. A second admin approves it."
    >
      <Field id="movement-type" label="Direction">
        <select id="movement-type" value={f.type} onChange={set('type')} className={selectClass}>
          <option value="top_up">Into Liquid Funds (a top-up)</option>
          <option value="withdrawal">Out of Liquid Funds (a withdrawal)</option>
        </select>
      </Field>
      <Field id="movement-amount" label="Amount, in USDT">
        <Input id="movement-amount" inputMode="decimal" value={f.amount} onChange={set('amount')} />
      </Field>
      <Field id="movement-note" label="Reason" hint={`${NOTE_HINT} Shown to the admin who approves it, and kept in the audit log.`}>
        <textarea id="movement-note" value={f.note} maxLength={NOTE_MAX} rows={2} onChange={set('note')} aria-describedby="movement-note-hint" className={textareaClass} />
      </Field>
    </FormDialog>
  );
}

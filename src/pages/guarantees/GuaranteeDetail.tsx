import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, errorMessage } from '@/api/errors';
import { decideClose, enterClose, getGuarantee, getPayments, type Guarantee, type Payment } from '@/api/guarantees';
import { getMember } from '@/api/members';
import { Badge, Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DecisionDialog, NOTE_HINT, type Decision } from '@/components/ui/decision-dialog';
import { Fields, Muted, StatusPill } from '@/components/ui/parts';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { formatAmount, formatDate, formatDateTime, formatNumber, formatUsdt } from '@/lib/format';
import { guaranteeStatus, paymentMethod, paymentStatus } from '@/lib/labels';
import { fullName } from '@/lib/names';
import { can } from '@/lib/permissions';
import { useGrants, useSession } from '@/session/SessionProvider';
import { PricingTrail } from './PricingTrail';

export const GUARANTEE_TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'pricing', label: 'Pricing trail' },
  { value: 'payments', label: 'Payment attempts' }
] as const;

const usdt = (v: string | undefined) => formatUsdt(v, { full: true });
/** An amount in a payment's own currency, at full precision. */
const inCurrency = (v: string | undefined, currency: string | undefined) =>
  currency === 'USDT' || currency === 'KES' || currency === 'BLOCKS' ? formatAmount(v, currency, { full: true }) : `${formatNumber(v)} ${currency ?? ''}`.trim();
const blocksPrice = (v: string | undefined) => (v ? `1 BLOCKS = ${formatNumber(v)} USDT` : '—');

/** The member's name and number, when this admin can read members; their ID otherwise. */
function useMemberName(memberId: string | undefined) {
  const grants = useGrants();
  const readable = !!memberId && can(grants, 'MEMBERS.READ');
  const query = useQuery({ queryKey: ['members', memberId], queryFn: () => getMember(memberId!), enabled: readable });
  if (!memberId) return { text: '—', link: null };
  if (!readable) return { text: memberId, link: null };
  if (!query.data) return { text: query.isError ? memberId : '…', link: null };
  return { text: `${fullName(query.data) || 'Unnamed member'}, ${query.data.member?.memberNumber ?? ''}`, link: `/members/${memberId}` };
}

/** One guarantee by its business ID: its terms, the pricing behind them, its payments and a manual close. */
export function GuaranteeDetail({ guaranteeId, tab, onTab }: { guaranteeId: string; tab: string; onTab: (t: string) => void }) {
  const query = useQuery({ queryKey: ['guarantees', guaranteeId], queryFn: () => getGuarantee(guaranteeId) });
  const payments = useQuery({ queryKey: ['guarantees', guaranteeId, 'payments'], queryFn: () => getPayments(guaranteeId) });
  const member = useMemberName(query.data?.memberId);

  if (query.isPending) return <Muted>Loading the guarantee…</Muted>;
  if (query.isError) {
    const gone = query.error instanceof ApiError && query.error.status === 404;
    return <Banner tone="bad">{gone ? `There's no guarantee ${guaranteeId}.` : errorMessage(query.error)}</Banner>;
  }

  const g = query.data;
  // the payment that activated it; a Lipa payment is confirmed as it's created
  const paid = payments.data?.find((p) => p.status === 'confirmed') ?? payments.data?.at(-1);
  const fee = payments.isPending ? '…' : paid?.operatingFee ? usdt(paid.operatingFee.amount) : '—';
  const current = GUARANTEE_TABS.some((t) => t.value === tab) ? tab : 'overview';

  return (
    <>
      <section className="flex flex-col gap-3.5 rounded-card border border-line bg-surface px-5 pb-4 pt-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="m-0 font-heading text-xl font-bold">{g.guaranteeId}</h2>
          <StatusPill label={guaranteeStatus(g.status)} />
          {g.pendingClose ? <Badge tone="warn">Close entered</Badge> : null}
          {g.flagged ? <Badge tone="bad">Flagged</Badge> : null}
        </div>
        <Tabs label="Guarantee" idPrefix="guarantee" tabs={GUARANTEE_TABS} value={current} onChange={onTab} />
        <TabPanel key={current} idPrefix="guarantee" value={current} className="flex flex-col gap-3.5">
          {current === 'pricing' ? (
            <PricingTrail priced={{ underwriting: g.underwriting, premium: g.premiumAmount, premiumRate: g.premiumRate, coverageRatio: g.coverageRatio, memberBacking: g.memberBackingUsdt, guaranteeToSavingsRatio: g.guaranteeToSavingsRatio }} />
          ) : current === 'payments' ? (
            <PaymentList query={payments} />
          ) : (
            <Fields
              rows={[
                {
                  k: 'Member',
                  v: member.link ? (
                    <Link to={member.link} className="font-medium text-ink-strong underline underline-offset-4">
                      {member.text}
                    </Link>
                  ) : (
                    member.text
                  )
                },
                { k: 'Amount', v: usdt(g.amount) },
                { k: 'Tenure', v: `${formatNumber(g.tenureMonths)} months` },
                { k: 'Premium', v: usdt(g.premiumAmount) },
                { k: 'Operating fee', v: fee },
                { k: 'Flagged', v: g.flagged ? 'Yes, premium below expected loss' : 'No' },
                { k: 'Quoted', v: formatDateTime(g.quotedAt, { zone: true }) },
                { k: 'Activated', v: formatDateTime(g.activatedAt, { zone: true }) },
                { k: 'Ends', v: formatDate(g.endsAt) },
                ...(g.closedAt ? [{ k: 'Closed', v: formatDateTime(g.closedAt, { zone: true }) }, { k: 'Why it closed', v: g.closeReason ?? '—' }] : []),
                { k: 'BLOCKS price when quoted', v: blocksPrice(g.blocksPrice?.quoteUsdtPerBlocks) },
                { k: 'BLOCKS price when activated', v: blocksPrice(g.blocksPrice?.activationUsdtPerBlocks) },
                ...(g.conversion ? [{ k: 'Converted to USDT at', v: `${blocksPrice(g.conversion.usdtPerBlocks)} (${g.conversion.source ?? '—'})` }] : [])
              ]}
            />
          )}
        </TabPanel>
      </section>
      <Close guarantee={g} memberName={member.text} />
    </>
  );
}

function PaymentList({ query }: { query: { isPending: boolean; isError: boolean; error: unknown; data?: Payment[] } }) {
  if (query.isPending) return <Muted>Loading the payments…</Muted>;
  if (query.isError) return <Banner tone="bad">{errorMessage(query.error)}</Banner>;
  const payments = query.data ?? [];
  if (!payments.length) return <Muted>No payment attempts yet.</Muted>;
  return (
    <ol aria-label="Payment attempts" className="m-0 flex list-none flex-col gap-3 p-0">
      {payments.map((p) => (
        <li key={p.paymentId} className="flex flex-col gap-3 rounded-card border border-line p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{paymentMethod(p.method)}</span>
            <StatusPill label={paymentStatus(p.status)} />
          </div>
          <Fields
            rows={[
              { k: 'Amount due', v: inCurrency(p.amountDue, p.currency) },
              { k: 'Received', v: inCurrency(p.amountReceived, p.currency) },
              { k: 'Operating fee', v: p.operatingFee ? inCurrency(p.operatingFee.amount, p.operatingFee.currency) : '—' },
              // a Lipa payment's reference is the transaction that paid the pool
              { k: p.method === 'lipa' ? 'Transaction hash' : 'Provider reference', v: <span className="font-mono text-[13px] [overflow-wrap:anywhere]">{p.providerReference ?? '—'}</span> },
              { k: 'Started', v: formatDateTime(p.initiatedAt, { zone: true }) },
              { k: 'Confirmed', v: formatDateTime(p.confirmedAt, { zone: true }) },
              ...(Number(p.amountRefunded) > 0 ? [{ k: 'Owed back', v: `${inCurrency(p.amountRefunded, p.currency)}, ${inCurrency(p.amountOwed, p.currency)} not paid yet` }] : [])
            ]}
          />
        </li>
      ))}
    </ol>
  );
}

/** A manual close: one admin enters it with a reason, and a different admin approves or rejects it. */
function Close({ guarantee: g, memberName }: { guarantee: Guarantee; memberName: string }) {
  const grants = useGrants();
  const { session } = useSession();
  const qc = useQueryClient();
  const [decision, setDecision] = React.useState<Decision | null>(null);
  const canManage = can(grants, 'GUARANTEES.MANAGE');
  const id = g.guaranteeId!;
  const pending = g.pendingClose;
  const mine = !!pending && pending.enteredBy?.toLowerCase() === session?.email.toLowerCase();

  const rows = [
    { k: 'Guarantee', v: id },
    { k: 'Member', v: memberName },
    { k: 'Amount', v: usdt(g.amount) }
  ];
  const saved = (updated: Guarantee) => {
    qc.setQueryData(['guarantees', id], updated);
    void qc.invalidateQueries({ queryKey: ['guarantees', 'list'] });
    if (g.memberId) void qc.invalidateQueries({ queryKey: ['members', g.memberId, 'guarantees'] });
  };

  const enter = () =>
    setDecision({
      title: 'Enter a manual close',
      description: 'A second admin must approve this before the guarantee closes.',
      confirm: 'Enter the close',
      rows,
      note: { label: 'Reason', hint: `${NOTE_HINT} Kept with the guarantee and in the audit log.`, required: 'Enter the reason for the close.' },
      run: async (reason) => saved(await enterClose(id, reason)),
      done: () => toast.success(`Close of ${id} entered. A second admin approves it.`)
    });

  const decide = (approve: boolean) =>
    setDecision({
      title: approve ? 'Approve this close?' : 'Reject this close?',
      description: approve ? 'The guarantee closes and leaves Total Outstanding.' : 'The guarantee stays active.',
      confirm: approve ? 'Approve' : 'Reject',
      danger: !approve,
      rows: [...rows, { k: 'Reason', v: pending?.reason ?? '—' }, { k: 'Entered by', v: `${pending?.enteredBy ?? '—'}, ${formatDateTime(pending?.enteredAt, { zone: true })}` }],
      note: { label: 'Note (optional)', hint: `${NOTE_HINT} Kept in the audit log.` },
      run: async (note) => saved(await decideClose(id, approve ? 'approve' : 'reject', note || undefined)),
      done: () => toast.success(approve ? `${id} is closed.` : `Close of ${id} rejected. It stays active.`)
    });

  return (
    <>
      {pending ? (
        <section aria-label="Waiting for approval" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
          <Banner tone="warn">
            Manual close waiting for approval. Entered by {mine ? 'you' : pending.enteredBy}, {formatDateTime(pending.enteredAt, { zone: true })}. Reason: {pending.reason}
          </Banner>
          {canManage ? (
            <>
              {mine ? <Muted>You entered it, so a different admin approves or rejects it.</Muted> : null}
              <div className="flex flex-wrap justify-end gap-2.5">
                <Button variant="danger" disabled={mine} onClick={() => decide(false)}>
                  Reject
                </Button>
                <Button disabled={mine} onClick={() => decide(true)}>
                  Approve
                </Button>
              </div>
            </>
          ) : null}
        </section>
      ) : canManage && g.status === 'active' ? (
        <Button className="self-start" onClick={enter}>
          Enter a manual close
        </Button>
      ) : null}
      <DecisionDialog decision={decision} onClose={() => setDecision(null)} />
    </>
  );
}

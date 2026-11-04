import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { LipaEvent } from '@/api/audit';
import { ApiError, errorMessage } from '@/api/errors';
import { getQuote, getQuoteLipaEvents } from '@/api/guarantees';
import { listMembers } from '@/api/members';
import { Badge, Banner } from '@/components/ui/badge';
import { Fields, Item, Items, Muted, SectionTitle, StatusPill } from '@/components/ui/parts';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { formatDateTime, formatNumber, formatUsdt } from '@/lib/format';
import { lipaSource, lipaStatus, quoteStatus } from '@/lib/labels';
import { fullName } from '@/lib/names';
import { can } from '@/lib/permissions';
import { useGrants } from '@/session/SessionProvider';
import { PricingTrail } from './PricingTrail';

export const QUOTE_TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'pricing', label: 'Pricing trail and invoice' },
  { value: 'lipa', label: 'Lipa API payments' }
] as const;

const usdt = (v: string | undefined) => formatUsdt(v, { full: true });
const link = 'font-medium text-ink-strong underline underline-offset-4';

/** A quote names its member by member number; this finds the member, when this admin can read members. */
function useMemberByNumber(number: string | undefined) {
  const grants = useGrants();
  const readable = !!number && can(grants, 'MEMBERS.READ');
  const query = useQuery({ queryKey: ['members', 'by-number', number], queryFn: () => listMembers({ page: 1, size: 1, search: number }), enabled: readable });
  const found = query.data?.results?.find((m) => m.member?.memberNumber === number);
  return found ? { text: `${fullName(found) || 'Unnamed member'}, ${number}`, link: `/members/${found.id}` } : { text: number ?? '—', link: null };
}

/** A link to another quote in the same panel, keeping the list behind it as it is. */
function QuoteLink({ id }: { id: string }) {
  const { search } = useLocation();
  const keep = new URLSearchParams(search);
  keep.delete('tab');
  const rest = keep.toString();
  return (
    <Link to={`/guarantees/quotes/${id}${rest ? `?${rest}` : ''}`} className={`font-mono text-[13px] ${link}`}>
      {id}
    </Link>
  );
}

/** Each attempt (a Lipa payment ID) with every status it reached, oldest first, as the backend lists them. */
function attempts(events: LipaEvent[]): [string, LipaEvent[]][] {
  const byPayment = new Map<string, LipaEvent[]>();
  for (const e of events) {
    const id = e.paymentId ?? '—';
    byPayment.set(id, [...(byPayment.get(id) ?? []), e]);
  }
  return [...byPayment];
}

function EventDetails({ e }: { e: LipaEvent }) {
  return (
    <span className="flex flex-col gap-0.5">
      {e.amount ? <span>{usdt(e.amount)}</span> : null}
      {e.txHash ? <span className="font-mono text-[12px] [overflow-wrap:anywhere]">{e.txHash}</span> : null}
      {e.status === 'FAILED' ? (
        <>
          <span>
            failureReason: <span className="font-mono text-[12px] text-ink">{e.failureReason ?? 'none given'}</span>
          </span>
          {e.failureMessage ? <span>Member told: {e.failureMessage}</span> : null}
        </>
      ) : null}
    </span>
  );
}

/** Every Lipa API attempt to pay the quote (C3), each with the statuses its callbacks and our status checks reported. */
function LipaAttempts({ quoteId }: { quoteId: string }) {
  const query = useQuery({ queryKey: ['quotes', quoteId, 'lipa-events'], queryFn: () => getQuoteLipaEvents(quoteId) });
  if (query.isPending) return <Muted>Loading the attempts…</Muted>;
  if (query.isError) return <Banner tone="bad">{errorMessage(query.error)}</Banner>;
  const all = attempts(query.data);
  return (
    <>
      <SectionTitle>{all.length > 1 ? `Every attempt (${all.length}, oldest first)` : 'Every attempt'}</SectionTitle>
      {!all.length ? <Muted>The Lipa API hasn't reported an attempt to pay this quote.</Muted> : null}
      {all.map(([paymentId, events], i) => (
        <div key={paymentId} className="flex flex-col gap-1">
          <span className="font-semibold">
            Attempt {i + 1} <span className="font-mono text-[13px] font-normal text-muted">{paymentId}</span>
          </span>
          <Items label={`Attempt ${i + 1}`}>
            {events.map((e) => (
              <Item key={e.id} title={`${lipaSource(e.source)}, ${formatDateTime(e.receivedAt, { zone: true })}`} sub={<EventDetails e={e} />} status={<StatusPill label={lipaStatus(e.status)} />} />
            ))}
          </Items>
        </div>
      ))}
    </>
  );
}

/** One quote by its quote ID: its terms, the pricing and invoice, and the latest payment through Lipa. */
export function QuoteDetail({ quoteId, tab, onTab }: { quoteId: string; tab: string; onTab: (t: string) => void }) {
  const query = useQuery({ queryKey: ['quotes', quoteId], queryFn: () => getQuote(quoteId) });
  const member = useMemberByNumber(query.data?.memberId);

  if (query.isPending) return <Muted>Loading the quote…</Muted>;
  if (query.isError) {
    const gone = query.error instanceof ApiError && query.error.status === 404;
    return <Banner tone="bad">{gone ? `There's no quote ${quoteId}.` : errorMessage(query.error)}</Banner>;
  }

  const q = query.data;
  const invoice = q.invoice ?? {};
  const current = QUOTE_TABS.some((t) => t.value === tab) ? tab : 'overview';
  const payment = q.payment;

  return (
    <>
      <section className="flex flex-col gap-3.5 rounded-card border border-line bg-surface px-5 pb-4 pt-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="m-0 font-heading text-xl font-bold">{q.quoteId}</h2>
          <StatusPill label={quoteStatus(q.status)} />
          {q.flagged ? <Badge tone="bad">Flagged</Badge> : null}
        </div>
        <Tabs label="Quote" idPrefix="quote" tabs={QUOTE_TABS} value={current} onChange={onTab} />
        <TabPanel key={current} idPrefix="quote" value={current} className="flex flex-col gap-3.5">
          {current === 'pricing' ? (
            <>
              <SectionTitle>Invoice</SectionTitle>
              <Fields
                rows={[
                  { k: 'Premium', v: usdt(invoice.amount) },
                  { k: 'Operating fee', v: usdt(invoice.operatingFee) },
                  { k: 'Amount due (amountDue)', v: usdt(invoice.amountDue) },
                  { k: 'Valid until', v: formatDateTime(invoice.validUntil, { zone: true }) },
                  { k: 'BLOCKS price when quoted', v: q.blocksPrice ? `1 BLOCKS = ${formatNumber(q.blocksPrice)} USDT` : '—' }
                ]}
              />
              <PricingTrail priced={{ underwriting: q.underwriting, premium: invoice.amount, premiumRate: q.premiumRate, coverageRatio: q.coverageRatio, memberBacking: q.memberBacking, guaranteeToSavingsRatio: q.guaranteeToSavingsRatio }} />
            </>
          ) : current === 'lipa' ? (
            <>
              <SectionTitle>Latest payment</SectionTitle>
              {payment ? (
                <Fields
                  rows={[
                    { k: 'Lipa payment ID', v: <span className="font-mono text-[13px]">{payment.paymentId ?? '—'}</span> },
                    { k: 'Status', v: <StatusPill label={lipaStatus(payment.status)} /> },
                    ...(payment.status === 'FAILED' ? [{ k: 'What the member was told (failureMessage)', v: payment.failureMessage ?? '—' }] : [])
                  ]}
                />
              ) : (
                <Muted>No Lipa API payment on this quote.</Muted>
              )}
              <LipaAttempts quoteId={quoteId} />
            </>
          ) : (
            <Fields
              rows={[
                {
                  k: 'Member',
                  v: member.link ? (
                    <Link to={member.link} className={link}>
                      {member.text}
                    </Link>
                  ) : (
                    member.text
                  )
                },
                { k: 'Guarantee amount', v: usdt(q.guaranteeAmount) },
                { k: 'Tenure', v: `${formatNumber(q.tenureMonths)} months` },
                { k: 'Amount due (amountDue)', v: usdt(invoice.amountDue) },
                { k: 'Quoted', v: formatDateTime(q.quotedAt, { zone: true }) },
                { k: 'Ends (validUntil)', v: formatDateTime(q.validUntil, { zone: true }) },
                { k: 'Flagged', v: q.flagged ? 'Yes, premium below expected loss' : 'No' },
                { k: 'Guarantee created', v: q.guaranteeId ?? 'None' },
                // a member has one open quote at a time, so asking again replaces it (C2)
                ...(q.replacedBy ? [{ k: 'Replaced by', v: <QuoteLink id={q.replacedBy} /> }] : []),
                ...(q.replaces?.length
                  ? [{
                      k: q.replaces.length === 1 ? 'Replaces' : `Replaces (${q.replaces.length}, oldest first)`,
                      v: (
                        <span className="flex flex-wrap gap-x-3 gap-y-1">
                          {q.replaces.map((r) => (
                            <QuoteLink key={r} id={r} />
                          ))}
                        </span>
                      )
                    }]
                  : [])
              ]}
            />
          )}
        </TabPanel>
      </section>
      {q.guaranteeId ? (
        <Link to={`/guarantees/${q.guaranteeId}`} className={`self-start ${link}`}>
          Open the guarantee it created
        </Link>
      ) : null}
    </>
  );
}

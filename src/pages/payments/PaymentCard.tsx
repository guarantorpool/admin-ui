import { Link } from 'react-router-dom';
import type { Payment } from '@/api/guarantees';
import { Fields, StatusPill } from '@/components/ui/parts';
import { formatDateTime, formatIn } from '@/lib/format';
import { paymentMethod, paymentStatus } from '@/lib/labels';
import { can } from '@/lib/permissions';
import { useGrants } from '@/session/SessionProvider';

/** An amount in a payment's own currency, at full precision. */
const inCurrency = (v: string | undefined, currency: string | undefined) => formatIn(v, currency, { full: true });

/** One attempt to pay a guarantee: its method and status, then what was due, received and owed back. */
export function PaymentCard({ payment: p }: { payment: Payment }) {
  const refunds = can(useGrants(), 'REFUNDS.READ');
  const waiting = p.status === 'needs_confirmation' ? p.needsConfirmation : undefined;
  return (
    <>
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
          ...(waiting ? [{ k: 'Needs confirmation', v: `${waiting.reason ?? 'No reason given'}, since ${formatDateTime(waiting.since, { zone: true })}` }] : []),
          ...(Number(p.amountRefunded) > 0 ? [{ k: 'Owed back', v: <OwedBack payment={p} link={refunds} /> }] : [])
        ]}
      />
    </>
  );
}

/** What's owed back on a payment, linked to its refunds for an admin who can read them. */
function OwedBack({ payment: p, link }: { payment: Payment; link: boolean }) {
  const text = `${inCurrency(p.amountRefunded, p.currency)}, ${inCurrency(p.amountOwed, p.currency)} not paid yet`;
  if (!link || !p.paymentId) return <>{text}</>;
  return (
    <Link to={`/refunds?payment=${p.paymentId}`} className="font-medium text-ink-strong underline underline-offset-4">
      {text}
    </Link>
  );
}

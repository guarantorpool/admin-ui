import * as React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { errorMessage } from '@/api/errors';
import { getGuarantee } from '@/api/guarantees';
import { getPayment, listPayments, type MemberPayment, type PaymentQuery } from '@/api/payments';
import { PageHeader } from '@/components/shell/AppShell';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Pager, PAGE_SIZES } from '@/components/ui/pager';
import { Fields, Muted, StatusPill } from '@/components/ui/parts';
import { Rows, type Column } from '@/components/ui/rows';
import { Sheet } from '@/components/ui/sheet';
import { formatDateTime, formatIn, zoneLabel } from '@/lib/format';
import { paymentMethod, paymentStatus } from '@/lib/labels';
import { can } from '@/lib/permissions';
import { useMedia, WIDE_QUERY } from '@/lib/useMedia';
import { cn } from '@/lib/utils';
import { useMemberName } from '@/pages/members/useMemberName';
import { NoAccess } from '@/pages/Placeholders';
import { useGrants } from '@/session/SessionProvider';
import { PaymentCard } from './PaymentCard';

// Screen 10. Every attempt to pay a premium, across guarantees, newest first. A payment has no business ID, so a
// row is named by its guarantee; its details open at /payments/<guarantee>/<payment>.

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'needs_confirmation', label: 'Needs confirmation' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Paid' },
  { value: 'failed', label: 'Failed' },
  { value: 'refunded', label: 'Refunded' }
];

// premiums are paid only through the Lipa API now (BlockCoop D-039); the other two are kept for older payments
const METHODS = [
  { value: 'lipa', label: 'Lipa API' },
  { value: 'wallet', label: 'Wallet (before Lipa only)' },
  { value: 'mobile_money', label: 'M-Pesa (before Lipa only)' }
];

const DEFAULT_SIZE = 25;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const FILTERS = ['status', 'method', 'search', 'from', 'to'] as const;
const selectClass = 'min-h-9 rounded-ctl border border-ctl bg-surface px-2 text-ink';
const linkClass = 'font-medium text-ink-strong underline underline-offset-4';

const COLUMNS: Column<MemberPayment>[] = [
  { header: 'Guarantee', cell: (r) => <span className="font-mono text-[13px]">{r.payment?.guaranteeId ?? '—'}</span> },
  { header: 'Member', cell: (r) => r.memberNumber ?? '—' },
  { header: 'Method', cell: (r) => paymentMethod(r.payment?.method) },
  { header: 'Amount due', cell: (r) => formatIn(r.payment?.amountDue, r.payment?.currency), figure: true },
  { header: 'Started', cell: (r) => formatDateTime(r.payment?.initiatedAt) },
  { header: 'Status', cell: (r) => <StatusPill label={paymentStatus(r.payment?.status)} /> }
];

export function PaymentsPage() {
  const grants = useGrants();
  if (!can(grants, 'GUARANTEES.READ')) return <NoAccess />;
  return <Payments />;
}

function Payments() {
  const navigate = useNavigate();
  const { guaranteeId, paymentId } = useParams();
  const wide = useMedia(WIDE_QUERY);
  const [params, setParams] = useSearchParams();

  const status = STATUS_FILTERS.find((f) => f.value && f.value === params.get('status'))?.value ?? '';
  const method = METHODS.find((m) => m.value === params.get('method'))?.value ?? '';
  const search = (params.get('search') ?? '').trim();
  const from = DAY.test(params.get('from') ?? '') ? params.get('from')! : '';
  const to = DAY.test(params.get('to') ?? '') ? params.get('to')! : '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const sizeParam = Number(params.get('size'));
  const size = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : DEFAULT_SIZE;
  const filtered = FILTERS.some((f) => params.get(f));

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

  // the guarantee ID waits for a pause in typing, then goes in the address, which can change it too (back, a link);
  // any other change to the address while it waits starts the wait again, so it doesn't undo it
  const [searchText, setSearchText] = React.useState(search);
  React.useEffect(() => {
    if (searchText.trim() === search) return;
    const t = setTimeout(() => update({ search: searchText.trim() }), 300);
    return () => clearTimeout(t);
  }, [searchText, params.toString()]);
  React.useEffect(() => setSearchText(search), [search]);

  const address = params.toString() ? `?${params.toString()}` : '';
  const q: PaymentQuery = { page, size, status: status || undefined, method: method || undefined, search: search || undefined, from: from || undefined, to: to || undefined };
  const query = useQuery({ queryKey: ['payments', 'list', q], queryFn: () => listPayments(q), placeholderData: keepPreviousData });

  const total = query.data?.totalResults ?? 0;
  const list = query.isPending ? (
    <p className="m-0 px-4 py-5 text-muted">Loading…</p>
  ) : query.isError ? (
    <div className="p-3.5">
      <Banner tone="bad">{errorMessage(query.error)}</Banner>
    </div>
  ) : !query.data.results?.length ? (
    <p className="m-0 px-4 py-5 text-muted">{filtered ? 'No payments match.' : 'No payments yet.'}</p>
  ) : (
    <Rows<MemberPayment>
      label="Payments"
      rows={query.data.results}
      rowKey={(r) => r.payment!.paymentId!}
      columns={COLUMNS}
      grid="grid-cols-[1.2fr_0.9fr_0.8fr_1fr_1.1fr_1.1fr]"
      minWidth={900}
      linkFor={(r) => `/payments/${r.payment!.guaranteeId}/${r.payment!.paymentId}${address}`}
      sub={(r) => `${r.memberNumber ?? '—'} · ${paymentMethod(r.payment?.method)} · ${formatIn(r.payment?.amountDue, r.payment?.currency)} · ${formatDateTime(r.payment?.initiatedAt)}`}
    />
  );

  return (
    <>
      <PageHeader />
      <div className="flex flex-col gap-3.5">
        <Muted>Every attempt to pay a premium, newest first. Times are in {zoneLabel()}. A Lipa transfer refused before a payment was made isn't here: it's under Alerts.</Muted>
        <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => (
            <Chip key={f.label} on={status === f.value} onClick={() => update({ status: f.value })}>
              {f.label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Method" value={method} onChange={(e) => update({ method: e.target.value })} className={selectClass}>
            <option value="">All methods</option>
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <Input aria-label="Guarantee ID" placeholder="Guarantee ID, or part of it" value={searchText} onChange={(e) => setSearchText(e.target.value)} className="max-w-[300px] flex-[1_1_200px] font-mono" />
          <label className="flex items-center gap-1.5">
            <span className="text-muted">Started from</span>
            <Input type="date" aria-label="From" value={from} max={to || undefined} onChange={(e) => update({ from: e.target.value })} className="w-auto" />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-muted">to</span>
            <Input type="date" aria-label="To" value={to} min={from || undefined} onChange={(e) => update({ to: e.target.value })} className="w-auto" />
          </label>
          {filtered ? (
            <Button variant="outline" onClick={() => update(Object.fromEntries(FILTERS.map((f) => [f, undefined])))}>
              Clear the filters
            </Button>
          ) : null}
        </div>
        <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface', query.isFetching && !query.isPending && 'opacity-70')} aria-busy={query.isFetching}>
          {list}
          {total > 0 ? <Pager page={page} size={size} total={total} onPage={(p) => update({ page: p })} onSize={(s) => update({ size: s })} /> : null}
        </section>
      </div>

      <Sheet open={!!(guaranteeId && paymentId)} onClose={() => navigate(`/payments${address}`)} title="Payment details" wide={wide}>
        {guaranteeId && paymentId ? <PaymentDetail guaranteeId={guaranteeId} paymentId={paymentId} listed={query.data?.results?.find((r) => r.payment?.paymentId === paymentId)} /> : null}
      </Sheet>
    </>
  );
}

/** One payment, read fresh, with links to its guarantee and its member. */
function PaymentDetail({ guaranteeId, paymentId, listed }: { guaranteeId: string; paymentId: string; listed?: MemberPayment }) {
  const query = useQuery({ queryKey: ['guarantees', guaranteeId, 'payments', paymentId], queryFn: () => getPayment(guaranteeId, paymentId), placeholderData: listed?.payment });
  // a payment opened from a link may not be in the list, so its member then comes from its guarantee
  const guarantee = useQuery({ queryKey: ['guarantees', guaranteeId], queryFn: () => getGuarantee(guaranteeId), enabled: !listed });
  const member = useMemberName(listed?.memberId ?? guarantee.data?.memberId);
  const memberText = member.link ? member.text : (listed?.memberNumber ?? member.text);

  if (query.isPending) return <Muted>Loading the payment…</Muted>;
  if (query.isError) return <Banner tone="bad">{errorMessage(query.error)}</Banner>;
  return (
    <div className="flex flex-col gap-4">
      <Fields
        rows={[
          {
            k: 'Guarantee',
            v: (
              <Link to={`/guarantees/${guaranteeId}`} className={cn(linkClass, 'font-mono text-[13px]')}>
                {guaranteeId}
              </Link>
            )
          },
          {
            k: 'Member',
            v: member.link ? (
              <Link to={member.link} className={linkClass}>
                {memberText}
              </Link>
            ) : (
              memberText
            )
          }
        ]}
      />
      <section aria-label="Payment" className="flex flex-col gap-3 rounded-card border border-line p-3.5">
        <PaymentCard payment={query.data} />
      </section>
    </div>
  );
}

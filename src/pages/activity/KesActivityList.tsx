import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { errorMessage } from '@/api/errors';
import { listKesActivities, type KesActivity, type KesActivityQuery } from '@/api/facts';
import { Banner } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Pager, PAGE_SIZES } from '@/components/ui/pager';
import { Muted, StatusPill } from '@/components/ui/parts';
import { Rows, type Column } from '@/components/ui/rows';
import { formatAmount, formatDateTime, formatNumber } from '@/lib/format';
import { KES_STATUSES, KES_TYPES, kesStatus, kesType } from '@/lib/labels';
import { cn } from '@/lib/utils';

// C4: each wallet's M-Pesa deposits and payments as the Lipa API's feed last reported them. The rows are read when the
// member signs in and before each quote, not from here, so the list says when each was read.

const DEFAULT_SIZE = 25;

const short = (v: string | undefined) => (v && v.length > 16 ? `${v.slice(0, 8)}…${v.slice(-6)}` : v ?? '—');

function Amount({ a }: { a: KesActivity }) {
  return (
    <span className="flex flex-col items-end">
      {formatAmount(a.amountKes, 'KES')}
      {a.amountUsd ? <span className="text-[12px] text-muted">{formatNumber(a.amountUsd, 2)} USD</span> : null}
    </span>
  );
}

function Reference({ a }: { a: KesActivity }) {
  return (
    <span className="flex flex-col font-mono text-[12px]">
      {a.mpesaReceipt ? <span title="M-Pesa receipt">{a.mpesaReceipt}</span> : null}
      {a.txHash ? <span title={a.txHash}>{short(a.txHash)}</span> : <span className="font-sans text-muted">Not on-chain</span>}
    </span>
  );
}

const COLUMNS: Column<KesActivity>[] = [
  { header: 'Member number', cell: (a) => a.memberId ?? '—' },
  {
    header: 'What happened',
    cell: (a) => (
      <span className="flex flex-col">
        {kesType(a.type)}
        {a.channel || a.recipientReference ? <span className="text-[12px] text-muted">{[a.channel, a.recipientType, a.recipientReference].filter(Boolean).join(' · ')}</span> : null}
      </span>
    )
  },
  { header: 'Amount', cell: (a) => <Amount a={a} />, figure: true },
  { header: 'Wallet', cell: (a) => <span className="font-mono text-[12px]" title={a.walletAddress}>{short(a.walletAddress)}</span> },
  { header: 'Reference', cell: (a) => <Reference a={a} /> },
  {
    header: 'Completed',
    cell: (a) => (
      <span className="flex flex-col">
        {a.completedAt ? formatDateTime(a.completedAt) : 'Not completed'}
        <span className="text-[12px] text-muted">read {formatDateTime(a.readAt)}</span>
      </span>
    )
  },
  { header: 'Status', cell: (a) => <StatusPill label={kesStatus(a.status)} /> }
];

export function KesActivityList() {
  const [params, setParams] = useSearchParams();
  const member = params.get('member') ?? '';
  const wallet = params.get('wallet') ?? '';
  const type = KES_TYPES.includes(params.get('type') ?? '') ? params.get('type')! : '';
  const status = KES_STATUSES.includes(params.get('status') ?? '') ? params.get('status')! : '';
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

  // as on the records tab: typed filters wait for a pause, then go in the address
  const [memberText, setMemberText] = React.useState(member);
  const [walletText, setWalletText] = React.useState(wallet);
  React.useEffect(() => {
    if (memberText.trim() === member && walletText.trim() === wallet) return;
    const t = setTimeout(() => update({ member: memberText.trim(), wallet: walletText.trim() }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberText, walletText, params.toString()]);
  React.useEffect(() => setMemberText(member), [member]);
  React.useEffect(() => setWalletText(wallet), [wallet]);

  const q: KesActivityQuery = { page, size, memberNumber: member || undefined, walletAddress: wallet || undefined, type: type || undefined, status: status || undefined };
  const query = useQuery({ queryKey: ['kes-activities', 'list', q], queryFn: () => listKesActivities(q), placeholderData: keepPreviousData });

  const total = query.data?.totalResults ?? 0;
  const list = query.isPending ? (
    <p className="m-0 px-4 py-5 text-muted">Loading…</p>
  ) : query.isError ? (
    <div className="p-3.5">
      <Banner tone="bad">{errorMessage(query.error)}</Banner>
    </div>
  ) : !query.data.results?.length ? (
    <p className="m-0 px-4 py-5 text-muted">{member || wallet || type || status ? 'No KES activity matches.' : 'No KES activity read from the Lipa API yet.'}</p>
  ) : (
    <Rows<KesActivity>
      label="KES activity"
      rows={query.data.results}
      rowKey={(a) => a.id!}
      columns={COLUMNS}
      grid="grid-cols-[0.8fr_1.1fr_0.9fr_1fr_1fr_1fr_0.8fr]"
      minWidth={1000}
      sub={(a) =>
        [
          `${kesType(a.type)} of ${formatAmount(a.amountKes, 'KES')}`,
          a.mpesaReceipt ? `receipt ${a.mpesaReceipt}` : null,
          `wallet ${short(a.walletAddress)}`,
          a.completedAt ? `completed ${formatDateTime(a.completedAt)}` : 'not completed',
          `read ${formatDateTime(a.readAt)}`
        ]
          .filter(Boolean)
          .join(' · ')
      }
    />
  );

  return (
    <div className="flex flex-col gap-3.5">
      <Muted>
        M-Pesa deposits and payments as the Lipa API last reported them for each wallet. A member's are read when they sign in and before each quote. A completed one counts toward the Trust Score unless an
        on-chain record has its transaction; a reversed one is taken back.
      </Muted>
      <div className="flex flex-wrap items-center gap-2">
        <Input type="search" aria-label="Member number" placeholder="Member number" value={memberText} onChange={(e) => setMemberText(e.target.value)} className="max-w-[200px] flex-[1_1_160px]" />
        <Input type="search" aria-label="Wallet address" placeholder="Wallet address (0x…)" value={walletText} onChange={(e) => setWalletText(e.target.value)} className="max-w-[300px] flex-[1_1_220px] font-mono" />
        <select aria-label="Type" value={type} onChange={(e) => update({ type: e.target.value })} className="min-h-9 rounded-ctl border border-ctl bg-surface px-2 text-ink">
          <option value="">Deposits and payments</option>
          {KES_TYPES.map((t) => (
            <option key={t} value={t}>
              {kesType(t)}s
            </option>
          ))}
        </select>
        <select aria-label="Status" value={status} onChange={(e) => update({ status: e.target.value })} className="min-h-9 rounded-ctl border border-ctl bg-surface px-2 text-ink">
          <option value="">Every status</option>
          {KES_STATUSES.map((s) => (
            <option key={s} value={s}>
              {kesStatus(s).text}
            </option>
          ))}
        </select>
      </div>
      <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface', query.isFetching && !query.isPending && 'opacity-70')} aria-busy={query.isFetching}>
        {list}
        {total > 0 ? <Pager page={page} size={size} total={total} onPage={(p) => update({ page: p })} onSize={(s) => update({ size: s })} /> : null}
      </section>
    </div>
  );
}

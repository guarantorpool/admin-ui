import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { errorMessage } from '@/api/errors';
import { listPendingBacking, pendingBackingKey, type BackingChange } from '@/api/members';
import { getPoolPrices, poolPricesKey } from '@/api/pool';
import { PageHeader } from '@/components/shell/AppShell';
import { Banner } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Pager, PAGE_SIZES } from '@/components/ui/pager';
import { Muted } from '@/components/ui/parts';
import { Rows, type Column } from '@/components/ui/rows';
import { formatAmount, formatDateTime, formatUsdt } from '@/lib/format';
import { can } from '@/lib/permissions';
import { MemberMatches } from '@/pages/members/MemberMatches';
import { cn } from '@/lib/utils';
import { useMemberName } from '@/pages/members/useMemberName';
import { NoAccess } from '@/pages/Placeholders';
import { useGrants } from '@/session/SessionProvider';
import { BackingPanel, PriceLines } from './BackingPanel';

// Screen 15. A member's backing, found by searching, with entering their KES deposits and vault savings and deciding
// a waiting change; the changes waiting for approval across members; and the prices and haircuts backing is valued at,
// the same for every member, so they show whether or not a member is open.

export function BackingPage() {
  const grants = useGrants();
  if (!can(grants, 'MEMBERS.READ')) return <NoAccess />;
  return <BackingScreen />;
}

function BackingScreen() {
  const { memberId } = useParams();
  const navigate = useNavigate();
  const name = useMemberName(memberId);

  return (
    <>
      <PageHeader />
      <div className="flex flex-col gap-3.5">
        <Muted>
          A member's backing counts toward their connections' guarantee limits. Locked BLOCKS are read from the member's wallet; until the Lipa API sends them, one admin enters the KES deposits and vault savings
          and a second admin approves them.
        </Muted>
        <MemberSearch onPick={(id) => navigate(`/backing/${id}`)} />
        <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          {memberId ? (
            <Card aria-label="Member's backing">
              <CardHeader
                title={name.text}
                actions={
                  name.link ? (
                    <Link to={`${name.link}?tab=backing`} className="font-medium text-ink-strong underline underline-offset-4">
                      Open the member
                    </Link>
                  ) : undefined
                }
              />
              <BackingPanel key={memberId} memberId={memberId} prices={false} />
            </Card>
          ) : (
            <Card aria-label="Member's backing">
              <CardHeader title="A member's backing" />
              <Muted>Find a member above to see their backing, enter new KES deposits and vault savings, or approve a change waiting for them.</Muted>
            </Card>
          )}
          <PoolPrices />
        </div>
        <WaitingChanges />
      </div>
    </>
  );
}

/** The amount entered, with the one in force under it. */
const Change = ({ now, next }: { now: string; next: string }) => (
  <span className="flex flex-col">
    <span>{next}</span>
    <span className="text-[13px] text-muted">was {now}</span>
  </span>
);

const CHANGE_COLUMNS: Column<BackingChange>[] = [
  { header: 'Member number', cell: (r) => <span className="font-semibold text-ink-strong">{r.memberNumber ?? '—'}</span> },
  { header: 'KES deposits', cell: (r) => <Change now={formatAmount(r.kesDeposits, 'KES')} next={formatAmount(r.pending?.kesDeposits, 'KES')} />, figure: true },
  { header: 'Vault savings', cell: (r) => <Change now={formatUsdt(r.usdtVaultSavings)} next={formatUsdt(r.pending?.usdtVaultSavings)} />, figure: true },
  {
    header: 'Entered by',
    cell: (r) => (
      <span className="block truncate" title={r.pending?.enteredBy}>
        {r.pending?.enteredBy ?? '—'}
      </span>
    )
  },
  { header: 'Entered', cell: (r) => formatDateTime(r.pending?.enteredAt) }
];

/** Every backing change waiting for a second admin, oldest first; a row opens the member here to decide it. */
function WaitingChanges() {
  const [page, setPage] = React.useState(1);
  const [size, setSize] = React.useState<number>(PAGE_SIZES[0]);
  const query = useQuery({ queryKey: [...pendingBackingKey, { page, size }], queryFn: () => listPendingBacking(page, size), placeholderData: keepPreviousData });
  const total = query.data?.totalResults ?? 0;
  // a decision can empty the last page: step back to one that has rows
  const last = Math.max(1, Math.ceil(total / size));
  React.useEffect(() => {
    if (query.data && page > last) setPage(last);
  }, [query.data, page, last]);

  return (
    <section aria-labelledby="waiting-title" className="flex flex-col gap-2">
      <h2 id="waiting-title" className="m-0 text-base font-bold">
        Changes waiting for approval
      </h2>
      <Muted>KES deposits and vault savings entered by one admin, oldest first. Open one to approve or reject it; the admin who entered a change can't decide it.</Muted>
      <div className={cn('flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface', query.isFetching && !query.isPending && 'opacity-70')} aria-busy={query.isFetching}>
        {query.isPending ? (
          <p className="m-0 px-4 py-5 text-muted">Loading…</p>
        ) : query.isError ? (
          <div className="p-3.5">
            <Banner tone="bad">{errorMessage(query.error)}</Banner>
          </div>
        ) : !query.data.results?.length ? (
          <p className="m-0 px-4 py-5 text-muted">No backing changes are waiting.</p>
        ) : (
          <Rows<BackingChange>
            label="Changes waiting for approval"
            rows={query.data.results}
            rowKey={(r) => r.memberId!}
            columns={CHANGE_COLUMNS}
            grid="grid-cols-[0.9fr_1.1fr_1fr_1.6fr_1.1fr]"
            minWidth={860}
            linkFor={(r) => `/backing/${r.memberId}`}
            sub={(r) => `${formatAmount(r.pending?.kesDeposits, 'KES')} · ${formatUsdt(r.pending?.usdtVaultSavings)} · entered by ${r.pending?.enteredBy ?? '—'}`}
          />
        )}
        {total > 0 ? (
          <Pager
            page={page}
            size={size}
            total={total}
            onPage={setPage}
            onSize={(s) => {
              setSize(s);
              setPage(1);
            }}
          />
        ) : null}
      </div>
    </section>
  );
}

function MemberSearch({ onPick }: { onPick: (id: string) => void }) {
  const [text, setText] = React.useState('');
  const [search, setSearch] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setSearch(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const open = search.length >= 2 && search === text.trim();
  return (
    <form role="search" onSubmit={(e) => e.preventDefault()} className="relative sm:max-w-[420px]">
      <Input
        type="search"
        aria-label="Find a member"
        placeholder="Find a member: name, email, phone or member number"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && text && (e.stopPropagation(), setText(''))}
      />
      {open ? (
        <MemberMatches
          search={search}
          onPick={(id) => {
            onPick(id);
            setText('');
          }}
        />
      ) : null}
    </form>
  );
}

/** The prices and haircuts every member's backing is valued at, from the pool. */
function PoolPrices() {
  const settingsReadable = can(useGrants(), 'PARAMETERS.READ');
  const query = useQuery({ queryKey: poolPricesKey, queryFn: getPoolPrices });

  return (
    <Card aria-label="Prices and haircuts">
      <CardHeader
        title="Prices and haircuts"
        actions={
          settingsReadable ? (
            <Link to="/pool/settings" className="font-medium text-ink-strong underline underline-offset-4">
              Change the haircuts
            </Link>
          ) : undefined
        }
      />
      <Muted>The latest stored valuation, the same for every member. A haircut change needs two admins, on Pool settings.</Muted>
      {query.isPending ? <Muted>Loading the prices…</Muted> : query.isError ? <Banner tone="bad">{errorMessage(query.error)}</Banner> : <PriceLines prices={query.data} />}
    </Card>
  );
}

import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { errorMessage } from '@/api/errors';
import { getAssetBalances } from '@/api/members';
import { listParameters } from '@/api/parameters';
import { PageHeader } from '@/components/shell/AppShell';
import { Banner } from '@/components/ui/badge';
import { Card, CardHeader, Lines } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Muted } from '@/components/ui/parts';
import { percent } from '@/lib/labels';
import { can } from '@/lib/permissions';
import { MemberMatches } from '@/pages/members/MemberMatches';
import { useMemberName } from '@/pages/members/useMemberName';
import { NoAccess } from '@/pages/Placeholders';
import { useGrants } from '@/session/SessionProvider';
import { backingKey, BackingPanel, PriceLines } from './BackingPanel';

// Screen 15. A member's backing, found by searching, with entering their KES deposits and vault savings and deciding
// a waiting change; and the prices and haircuts backing is valued at. The GP API gives the prices only with a member's
// backing, so they show once a member is open; the haircuts are pool settings.

const HAIRCUTS = [
  { key: 'blocks_haircut', label: 'Locked BLOCKS count at' },
  { key: 'kes_deposit_haircut', label: 'KES deposits count at' },
  { key: 'vault_savings_haircut', label: 'Vault savings count at' }
];

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
          <PoolPrices memberId={memberId} />
        </div>
        <Banner tone="plan">Planned: one list of backing changes waiting for approval across all members. Today they are seen one member at a time.</Banner>
      </div>
    </>
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

/** The prices come with a member's backing; with no member open, only the haircuts show, from the pool settings. */
function PoolPrices({ memberId }: { memberId: string | undefined }) {
  const settingsReadable = can(useGrants(), 'PARAMETERS.READ');
  const backing = useQuery({ queryKey: backingKey(memberId ?? ''), queryFn: () => getAssetBalances(memberId!), enabled: !!memberId });
  const settings = useQuery({ queryKey: ['parameters', 'list'], queryFn: listParameters, enabled: !memberId && settingsReadable });
  const valueOf = (key: string) => settings.data?.find((s) => s.key === key)?.value;

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
      {memberId ? (
        backing.isPending ? (
          <Muted>Loading the prices…</Muted>
        ) : backing.isError ? (
          <Banner tone="bad">{errorMessage(backing.error)}</Banner>
        ) : (
          <PriceLines prices={backing.data.valuation} />
        )
      ) : (
        <>
          <Muted>The BLOCKS price and KES rate show once a member is open: the GP API gives them only with a member's backing.</Muted>
          {!settingsReadable ? (
            <Muted>Your role can't read the pool settings, so the haircuts show once a member is open too.</Muted>
          ) : settings.isPending ? (
            <Muted>Loading the haircuts…</Muted>
          ) : settings.isError ? (
            <Banner tone="bad">{errorMessage(settings.error)}</Banner>
          ) : (
            <Lines rows={HAIRCUTS.map((h) => ({ k: h.label, v: percent(valueOf(h.key)) }))} />
          )}
        </>
      )}
    </Card>
  );
}

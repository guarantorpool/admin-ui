import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ApiError, errorMessage } from '@/api/errors';
import { getMember } from '@/api/members';
import { Banner } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Muted, StatusPill } from '@/components/ui/parts';
import { TabPanel, Tabs, type TabOption } from '@/components/ui/tabs';
import { memberStatus } from '@/lib/labels';
import { fullName } from '@/lib/names';
import { can } from '@/lib/permissions';
import { useGrants } from '@/session/SessionProvider';
import { MemberStatusDialog } from './MemberStatusDialog';
import { BackingTab, ConnectionsTab, FilesTab, GuaranteesTab, LimitTab, OverviewTab, TrustTab } from './MemberTabs';

const ALL_TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'backing', label: 'Backing' },
  { value: 'trust', label: 'Trust Score' },
  { value: 'connections', label: 'Connections' },
  { value: 'limit', label: 'Limit' },
  { value: 'guarantees', label: 'Guarantees' },
  { value: 'files', label: 'Files' }
] as const satisfies readonly TabOption[];

export type MemberTab = (typeof ALL_TABS)[number]['value'];

/** The tabs this admin's role can open: a member's guarantees need GUARANTEES.READ as well. */
export function memberTabs(grants: Parameters<typeof can>[0]): TabOption[] {
  return ALL_TABS.filter((t) => t.value !== 'guarantees' || can(grants, 'GUARANTEES.READ'));
}

/** Everything about one member, with disable and enable for a role that holds MEMBERS.UPDATE. */
export function MemberDetail({ memberId, tab, onTab }: { memberId: string; tab: string; onTab: (t: string) => void }) {
  const grants = useGrants();
  const [statusOpen, setStatusOpen] = React.useState(false);
  const query = useQuery({ queryKey: ['members', memberId], queryFn: () => getMember(memberId) });
  const tabs = memberTabs(grants);
  const current = tabs.some((t) => t.value === tab) ? tab : 'overview';

  if (query.isPending) return <Muted>Loading the member…</Muted>;
  if (query.isError) {
    const gone = query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400);
    return <Banner tone="bad">{gone ? "There's no member with this ID." : errorMessage(query.error)}</Banner>;
  }

  const member = query.data;
  const canUpdate = can(grants, 'MEMBERS.UPDATE');
  const canReview = can(grants, ['MEMBERS.READ', 'MEMBERS.KYC']);
  const disabled = member.status === 'disabled';
  const panel = (() => {
    switch (current) {
      case 'backing': return <BackingTab member={member} />;
      case 'trust': return <TrustTab member={member} />;
      case 'connections': return <ConnectionsTab member={member} />;
      case 'limit': return <LimitTab member={member} />;
      case 'guarantees': return <GuaranteesTab member={member} />;
      case 'files': return <FilesTab member={member} />;
      default: return <OverviewTab member={member} />;
    }
  })();

  return (
    <>
      <section className="flex flex-col gap-3.5 rounded-card border border-line bg-surface px-5 pb-4 pt-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="m-0 font-heading text-xl font-bold [overflow-wrap:anywhere]">{fullName(member) || 'Unnamed member'}</h2>
          <StatusPill label={memberStatus(member.status)} />
        </div>
        <Tabs label="Member details" idPrefix="member" tabs={tabs} value={current} onChange={onTab} />
        {/* a remount per member and tab, so each tab's own page of history starts at 1 */}
        <TabPanel key={`${memberId}-${current}`} idPrefix="member" value={current}>
          {panel}
        </TabPanel>
      </section>
      {canUpdate || canReview ? (
        <div className="flex flex-wrap items-center gap-2.5">
          {canReview ? (
            <>
              <Button asChild variant="outline">
                <Link to={`/kyc/${memberId}`}>Review KYC</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to={`/kyc/address/${memberId}`}>Review proof of address</Link>
              </Button>
            </>
          ) : null}
          {canUpdate ? (
            <>
              <Button variant="outline" onClick={() => onTab('backing')}>
                Set KES deposits and vault savings
              </Button>
              <Button variant={disabled ? 'primary' : 'danger'} className="ml-auto" onClick={() => setStatusOpen(true)}>
                {disabled ? 'Enable the member' : 'Disable the member'}
              </Button>
              <MemberStatusDialog member={member} open={statusOpen} onOpenChange={setStatusOpen} />
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

import * as React from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { errorMessage } from '@/api/errors';
import { listAddressDocuments, type QueuedAddressDocument } from '@/api/kyc';
import { listMembers, type KycStatus } from '@/api/members';
import type { Account } from '@/api/types';
import { PageHeader } from '@/components/shell/AppShell';
import { Banner } from '@/components/ui/badge';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Pager, PAGE_SIZES } from '@/components/ui/pager';
import { Rows, type Column } from '@/components/ui/rows';
import { StatusPill } from '@/components/ui/parts';
import { Sheet } from '@/components/ui/sheet';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { formatDate, formatDateTime } from '@/lib/format';
import { documentStatus, documentType, kycStatus, proofOfAddress } from '@/lib/labels';
import { fullName } from '@/lib/names';
import { can } from '@/lib/permissions';
import { useMedia, WIDE_QUERY } from '@/lib/useMedia';
import { cn } from '@/lib/utils';
import { NoAccess } from '@/pages/Placeholders';
import { useGrants } from '@/session/SessionProvider';
import { MemberReview, REVIEW_TABS, type ReviewTab } from './MemberReview';

// Screen 5. KYC submissions are members filtered by their KYC status. Proof of address is one queue of
// documents across all members, the longest waiting first (B2); a search finds one member's documents instead.

const PAGE_TABS = [
  { value: 'kyc', label: 'KYC submissions' },
  { value: 'address', label: 'Proof of address' }
] as const;

const KYC_CHIPS: { value: KycStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'verified', label: 'Verified' },
  { value: 'rejected', label: 'Rejected' }
];

const DOC_CHIPS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' }
] as const;

const DEFAULT_SIZE = 25;

const name: Column<Account> = { header: 'Member', cell: (m) => fullName(m) || '—' };
const number: Column<Account> = { header: 'Member number', cell: (m) => m.member?.memberNumber ?? '—' };
const phone: Column<Account> = { header: 'Phone', cell: (m) => m.phoneNumber ?? '—' };
const KYC_COLUMNS: Column<Account>[] = [name, number, phone, { header: 'Joined', cell: (m) => formatDate(m.createdAt) }, { header: 'KYC status', cell: (m) => <StatusPill label={kycStatus(m.member?.kycStatus)} /> }];
const ADDRESS_COLUMNS: Column<Account>[] = [name, number, phone, { header: 'Proof of address', cell: (m) => <StatusPill label={proofOfAddress(m.member?.proofOfAddress)} /> }];
// the queue shows each member's number only, never the pin or the file, so reading it isn't audited
const QUEUE_COLUMNS: Column<QueuedAddressDocument>[] = [
  { header: 'Member number', cell: (r) => r.memberNumber ?? '—' },
  { header: 'Document', cell: (r) => documentType(r.document?.documentType) },
  { header: 'Issued', cell: (r) => formatDate(r.document?.issueDate) },
  { header: 'Submitted', cell: (r) => formatDateTime(r.document?.submittedAt) },
  { header: 'Status', cell: (r) => <StatusPill label={documentStatus(r.document?.status)} /> }
];

export function KycPage() {
  const grants = useGrants();
  if (!can(grants, ['MEMBERS.READ', 'MEMBERS.KYC'])) return <NoAccess />;
  return <Review />;
}

function Review() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { memberId } = useParams();
  const wide = useMedia(WIDE_QUERY);
  const [params, setParams] = useSearchParams();
  const pageTab = pathname === '/kyc/address' || pathname.startsWith('/kyc/address/') ? 'address' : 'kyc';
  const base = pageTab === 'address' ? '/kyc/address' : '/kyc';

  const status = (pageTab === 'kyc' ? KYC_CHIPS : DOC_CHIPS).find((c) => c.value === params.get('status'))?.value ?? 'pending';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const sizeParam = Number(params.get('size'));
  const size = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : DEFAULT_SIZE;
  const q = params.get('q') ?? '';
  const tabParam = params.get('tab');
  const reviewTab: ReviewTab = REVIEW_TABS.find((t) => t.value === tabParam)?.value ?? pageTab;
  const [text, setText] = React.useState(q);

  // the address as it is now: the search's delayed update must not undo a filter chosen while it waited
  const latest = React.useRef(params);
  latest.current = params;

  /** Changes some values; any change but the page goes back to page 1. */
  const update = (changes: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(latest.current);
    for (const [k, v] of Object.entries(changes)) {
      if (v === undefined || v === '' || (k === 'page' && v === 1) || (k === 'size' && v === DEFAULT_SIZE) || (k === 'status' && v === 'pending') || (k === 'tab' && v === pageTab)) next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in changes) && !('tab' in changes)) next.delete('page');
    latest.current = next;
    setParams(next, { replace: true });
  };

  const listSearch = () => {
    const next = new URLSearchParams(params);
    next.delete('tab');
    const s = next.toString();
    return s ? `?${s}` : '';
  };

  // the search waits for a pause in typing, then goes in the address; opening a row while it waits starts
  // the wait again on the new page, so the update doesn't take the address back to the old one
  React.useEffect(() => {
    if (text.trim() === q) return;
    const t = setTimeout(() => update({ q: text.trim() }), 300);
    return () => clearTimeout(t);
  }, [text, pathname]);

  React.useEffect(() => setText(q), [q]);

  // the address tab shows the queue of documents, or the members a search finds
  const queue = pageTab === 'address' && q === '';
  const members = useQuery({
    queryKey: ['members', 'list', { page, size, q, ...(pageTab === 'kyc' ? { kyc: status } : {}) }],
    queryFn: () => listMembers({ page, size, search: q || undefined, kycStatus: pageTab === 'kyc' ? (status as KycStatus) : undefined }),
    placeholderData: keepPreviousData,
    enabled: !queue
  });
  // under 'members', so a review closing refreshes it
  const documents = useQuery({
    queryKey: ['members', 'address-documents', { page, size, status }],
    queryFn: () => listAddressDocuments({ page, size, status }),
    placeholderData: keepPreviousData,
    enabled: queue
  });
  const query = queue ? documents : members;

  const rows = members.data?.results ?? [];
  const linkFor = (m: Account) => `${base}/${m.id}${listSearch()}`;
  const empty = queue || pageTab === 'kyc' ? (status === 'pending' ? 'Nothing is waiting for review.' : `No ${queue ? 'documents' : 'submissions'} match.`) : 'No members match.';

  const list = query.isPending ? (
    <p className="m-0 px-4 py-5 text-muted">Loading…</p>
  ) : query.isError ? (
    <div className="p-3.5">
      <Banner tone="bad">{errorMessage(query.error)}</Banner>
    </div>
  ) : (queue ? !documents.data?.results?.length : rows.length === 0) ? (
    <p className="m-0 px-4 py-5 text-muted">{empty}</p>
  ) : queue ? (
    <Rows
      rowKey={(r) => r.document!.id!}
      label="Documents"
      rows={documents.data!.results!}
      columns={QUEUE_COLUMNS}
      grid="grid-cols-[0.9fr_1fr_0.8fr_1.1fr_0.8fr]"
      linkFor={(r) => `${base}/${r.memberId}${listSearch()}`}
      sub={(r) => `${documentType(r.document?.documentType)} · submitted ${formatDateTime(r.document?.submittedAt)}`}
    />
  ) : pageTab === 'kyc' ? (
    <Rows rowKey={(m) => m.id!} label="KYC submissions" rows={rows} columns={KYC_COLUMNS} grid="grid-cols-[1.2fr_0.8fr_1.1fr_0.8fr_0.8fr]" linkFor={linkFor} sub={(m) => `${m.member?.memberNumber ?? '—'} · joined ${formatDate(m.createdAt)}`} />
  ) : (
    <Rows rowKey={(m) => m.id!} label="Members" rows={rows} columns={ADDRESS_COLUMNS} grid="grid-cols-[1.2fr_0.8fr_1.1fr_0.9fr]" linkFor={linkFor} sub={(m) => `${m.member?.memberNumber ?? '—'} · ${m.phoneNumber ?? '—'}`} />
  );

  return (
    <>
      <PageHeader />
      <Tabs label="Review" idPrefix="kyc-page" tabs={PAGE_TABS} value={pageTab} onChange={(t) => navigate(t === 'address' ? '/kyc/address' : '/kyc')} />
      <TabPanel idPrefix="kyc-page" value={pageTab} className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            aria-label="Search by name, email, phone or member number"
            placeholder="Name, email, phone or member number"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="max-w-[380px] flex-[1_1_240px]"
          />
          {pageTab === 'kyc' || queue ? (
            <div role="group" aria-label={queue ? 'Document status' : 'KYC status'} className="flex flex-wrap gap-2">
              {(queue ? DOC_CHIPS : KYC_CHIPS).map((c) => (
                <Chip key={c.value} on={status === c.value} onClick={() => update({ status: c.value })}>
                  {c.label}
                </Chip>
              ))}
            </div>
          ) : null}
        </div>
        <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface', query.isFetching && !query.isPending && 'opacity-70')} aria-busy={query.isFetching}>
          {list}
          {query.data && (query.data.totalResults ?? 0) > 0 ? (
            <Pager page={page} size={size} total={query.data.totalResults ?? 0} onPage={(p) => update({ page: p })} onSize={(s) => update({ size: s })} />
          ) : null}
        </section>
      </TabPanel>

      <Sheet open={!!memberId} onClose={() => navigate(`${base}${listSearch()}`)} title="Review" wide={wide}>
        {memberId ? <MemberReview memberId={memberId} tab={reviewTab} onTab={(t) => update({ tab: t })} /> : null}
      </Sheet>
    </>
  );
}

import * as React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { MoreVertical } from 'lucide-react';
import { errorMessage } from '@/api/errors';
import { listMembers, type KycStatus, type MemberStatus } from '@/api/members';
import type { Account } from '@/api/types';
import { PageHeader } from '@/components/shell/AppShell';
import { Banner } from '@/components/ui/badge';
import { Chip } from '@/components/ui/chip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Pager, PAGE_SIZES } from '@/components/ui/pager';
import { StatusPill } from '@/components/ui/parts';
import { Sheet } from '@/components/ui/sheet';
import { formatAmount } from '@/lib/format';
import { kycStatus, memberStatus } from '@/lib/labels';
import { fullName } from '@/lib/names';
import { can } from '@/lib/permissions';
import { useCompact, useMedia, WIDE_QUERY } from '@/lib/useMedia';
import { cn } from '@/lib/utils';
import { NoAccess } from '@/pages/Placeholders';
import { useGrants } from '@/session/SessionProvider';
import { MemberDetail } from './MemberDetail';
import { MemberStatusDialog } from './MemberStatusDialog';

const STATUS_CHIPS: { value: MemberStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'disabled', label: 'Disabled' }
];

const KYC_OPTIONS: { value: KycStatus | ''; label: string }[] = [
  { value: '', label: 'Any KYC status' },
  { value: 'not_submitted', label: 'KYC not submitted' },
  { value: 'pending', label: 'KYC pending' },
  { value: 'verified', label: 'KYC verified' },
  { value: 'rejected', label: 'KYC rejected' }
];

const DEFAULT_SIZE = 25;
const VIEW_KEY = 'blockcoop-admin.members-view';
type View = 'table' | 'list';

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'table';
  } catch {
    return 'table';
  }
}

/** The list's search, filters and page live in the address, so a link or the back button keeps them. */
function useListParams() {
  const [params, setParams] = useSearchParams();
  const status = STATUS_CHIPS.find((c) => c.value && c.value === params.get('status'))?.value || undefined;
  const kyc = KYC_OPTIONS.find((o) => o.value && o.value === params.get('kyc'))?.value || undefined;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const sizeParam = Number(params.get('size'));
  const size = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : DEFAULT_SIZE;
  const q = params.get('q') ?? '';
  const tab = params.get('tab') ?? 'overview';

  // the address as it is now: the search's delayed update must not undo a filter chosen while it waited
  const latest = React.useRef(params);
  latest.current = params;

  /** Changes some values; any change but the page goes back to page 1. */
  const update = (changes: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(latest.current);
    for (const [k, v] of Object.entries(changes)) {
      if (v === undefined || v === '' || (k === 'page' && v === 1) || (k === 'size' && v === DEFAULT_SIZE) || (k === 'tab' && v === 'overview')) next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in changes) && !('tab' in changes)) next.delete('page');
    latest.current = next;
    setParams(next, { replace: true });
  };

  /** The list's own values, without the open member's tab, for links that keep the list as it is. */
  const listSearch = () => {
    const next = new URLSearchParams(params);
    next.delete('tab');
    const s = next.toString();
    return s ? `?${s}` : '';
  };

  return { status, kyc, page, size, q, tab, update, listSearch };
}

function RowMenu({ member, onStatus }: { member: Account; onStatus: (m: Account) => void }) {
  const name = fullName(member) || 'this member';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Options for ${name}`}
        title="Options"
        className="mr-2 flex size-9 shrink-0 items-center justify-center rounded-ctl text-ink-2 hover:bg-chip"
      >
        <MoreVertical className="size-[18px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => onStatus(member)}>{member.status === 'disabled' ? 'Enable the member' : 'Disable the member'}</DropdownMenuItem>
        <DropdownMenuItem disabled className="flex-col items-start gap-0 py-1.5 text-disabled data-[disabled]:cursor-not-allowed">
          <span>Set KES deposits and vault savings</span>
          <span className="text-xs">Coming in slice 9</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const COLUMNS = 'grid-cols-[1.1fr_0.8fr_1.1fr_0.8fr_1.1fr_0.7fr]';

function MembersTable({ rows, linkFor, selectedId, canUpdate, onStatus }: { rows: Account[]; linkFor: (id: string) => string; selectedId?: string; canUpdate: boolean; onStatus: (m: Account) => void }) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[820px]" role="table" aria-label="Members">
        <div role="row" className={cn('grid gap-3 py-2 pl-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted', COLUMNS, canUpdate ? 'pr-[52px]' : 'pr-4')}>
          {['Name', 'Member number', 'Phone', 'KYC status', 'Locked BLOCKS', 'Status'].map((h) => (
            <span key={h} role="columnheader">
              {h}
            </span>
          ))}
        </div>
        {rows.map((m) => (
          <div key={m.id} role="row" className={cn('flex items-center border-t border-line', m.id === selectedId ? 'bg-selected' : 'hover:bg-page')}>
            <Link
              to={linkFor(m.id!)}
              aria-current={m.id === selectedId ? 'true' : undefined}
              className={cn('grid min-h-11 min-w-0 flex-1 items-center gap-3 py-1 pl-4 text-ink no-underline', COLUMNS, canUpdate ? 'pr-0' : 'pr-4')}
            >
              <span role="cell" className="min-w-0 font-semibold [overflow-wrap:anywhere]">{fullName(m) || '—'}</span>
              <span role="cell" className="min-w-0">{m.member?.memberNumber ?? '—'}</span>
              <span role="cell" className="min-w-0 [overflow-wrap:anywhere]">{m.phoneNumber ?? '—'}</span>
              <span role="cell"><StatusPill label={kycStatus(m.member?.kycStatus)} /></span>
              <span role="cell" className="min-w-0 tabular-nums">{formatAmount(m.member?.lockedBlocks, 'BLOCKS')}</span>
              <span role="cell"><StatusPill label={memberStatus(m.status)} /></span>
            </Link>
            {canUpdate ? <RowMenu member={m} onStatus={onStatus} /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Phone width and the List view: name and status, with member number and phone below. */
function MembersList({ rows, linkFor, selectedId }: { rows: Account[]; linkFor: (id: string) => string; selectedId?: string }) {
  return (
    <ul aria-label="Members" className="m-0 list-none p-0">
      {rows.map((m) => (
        <li key={m.id} className="border-b border-line last:border-b-0">
          <Link
            to={linkFor(m.id!)}
            aria-current={m.id === selectedId ? 'true' : undefined}
            className={cn('flex flex-col gap-0.5 px-3.5 py-2 text-ink no-underline', m.id === selectedId ? 'bg-selected' : 'hover:bg-page')}
          >
            <span className="flex flex-wrap items-center justify-between gap-1.5">
              <span className="font-semibold [overflow-wrap:anywhere]">{fullName(m) || '—'}</span>
              <StatusPill label={memberStatus(m.status)} />
            </span>
            <span className="text-ink-3 [overflow-wrap:anywhere]">
              {m.member?.memberNumber ?? '—'} · {m.phoneNumber ?? '—'}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function MembersPage() {
  const grants = useGrants();
  if (!can(grants, 'MEMBERS.READ')) return <NoAccess />;
  return <Members />;
}

function Members() {
  const grants = useGrants();
  const navigate = useNavigate();
  const { memberId } = useParams();
  const compact = useCompact();
  const wide = useMedia(WIDE_QUERY);
  const { status, kyc, page, size, q, tab, update, listSearch } = useListParams();
  const [text, setText] = React.useState(q);
  const [view, setView] = React.useState<View>(readView);
  const [statusFor, setStatusFor] = React.useState<Account | null>(null);
  const canUpdate = can(grants, 'MEMBERS.UPDATE');

  // the search waits for a pause in typing, then goes in the address; opening a member while it waits starts
  // the wait again on the new page, so the update doesn't take the address back to the old one
  React.useEffect(() => {
    if (text.trim() === q) return;
    const t = setTimeout(() => update({ q: text.trim() }), 300);
    return () => clearTimeout(t);
  }, [text, memberId]);

  // the address can change the search too (back button, a link)
  React.useEffect(() => setText(q), [q]);

  const query = useQuery({
    queryKey: ['members', 'list', { page, size, q, status, kyc }],
    queryFn: () => listMembers({ page, size, search: q || undefined, status, kycStatus: kyc }),
    placeholderData: keepPreviousData
  });

  const chooseView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // a blocked store just means the view isn't remembered
    }
  };

  const rows = query.data?.results ?? [];
  const split = view === 'list' && !compact;
  const selectedId = split ? memberId ?? rows[0]?.id : memberId;
  const linkFor = (id: string) => `/members/${id}${listSearch()}`;
  const close = () => navigate(`/members${listSearch()}`);
  const setTab = (t: string) => update({ tab: t });

  const list = query.isPending ? (
    <p className="m-0 px-4 py-5 text-muted">Loading members…</p>
  ) : query.isError ? (
    <div className="p-3.5">
      <Banner tone="bad">{errorMessage(query.error)}</Banner>
    </div>
  ) : rows.length === 0 ? (
    <p className="m-0 border-t border-line px-4 py-5 text-muted">No members match.</p>
  ) : compact || split ? (
    <MembersList rows={rows} linkFor={linkFor} selectedId={split ? selectedId : undefined} />
  ) : (
    <MembersTable rows={rows} linkFor={linkFor} canUpdate={canUpdate} onStatus={setStatusFor} />
  );

  const box = (
    <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface', query.isFetching && !query.isPending && 'opacity-70')} aria-busy={query.isFetching}>
      {list}
      {query.data && (query.data.totalResults ?? 0) > 0 ? (
        <Pager page={page} size={size} total={query.data.totalResults ?? 0} onPage={(p) => update({ page: p })} onSize={(s) => update({ size: s })} />
      ) : null}
    </section>
  );

  return (
    <>
      <PageHeader />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Search by name, email, phone or member number"
          placeholder="Name, email, phone or member number"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="max-w-[380px] flex-[1_1_240px]"
        />
        <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
          {STATUS_CHIPS.map((c) => (
            <Chip key={c.label} on={(status ?? '') === c.value} onClick={() => update({ status: c.value })}>
              {c.label}
            </Chip>
          ))}
        </div>
        <select
          aria-label="KYC status"
          value={kyc ?? ''}
          onChange={(e) => update({ kyc: e.target.value })}
          className="min-h-9 rounded-ctl border border-ctl bg-surface px-2 text-ink"
        >
          {KYC_OPTIONS.map((o) => (
            <option key={o.label} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {!compact ? (
          <div role="group" aria-label="Choose a view" className="ml-auto flex overflow-hidden rounded-ctl border border-ctl">
            {(['table', 'list'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => chooseView(v)}
                className={cn('min-h-9 px-3.5 font-semibold', view === v ? 'bg-primary text-white' : 'bg-surface text-ink-strong hover:bg-chip')}
              >
                {v === 'table' ? 'Table' : 'List'}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {split ? (
        <div className="flex flex-wrap items-start gap-3.5">
          <div className="min-w-0 flex-[1_1_320px]">{box}</div>
          <div role="region" aria-label="Member details" className="flex min-w-0 flex-[999_1_560px] flex-col gap-3.5">
            {selectedId ? <MemberDetail memberId={selectedId} tab={tab} onTab={setTab} /> : <p className="m-0 text-muted">Choose a member to see their details.</p>}
          </div>
        </div>
      ) : (
        box
      )}

      {!split ? (
        <Sheet open={!!memberId} onClose={close} title="Member details" wide={wide}>
          {memberId ? <MemberDetail memberId={memberId} tab={tab} onTab={setTab} /> : null}
        </Sheet>
      ) : null}

      {statusFor ? <MemberStatusDialog member={statusFor} open onOpenChange={(o) => (o ? undefined : setStatusFor(null))} /> : null}
    </>
  );
}

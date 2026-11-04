import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { GUARANTEE_ID, QUOTE_ID } from '@/api/guarantees';
import { getMember } from '@/api/members';
import { Input } from '@/components/ui/input';
import { fullName } from '@/lib/names';
import { can } from '@/lib/permissions';
import { MemberMatches } from '@/pages/members/MemberMatches';
import { useGrants } from '@/session/SessionProvider';

const PREFIX = { guarantee: 'GPG', quote: 'GPQ' } as const;

/**
 * One box for both. A member, chosen from those whose name, email, phone or member number matches, filters the
 * list. Text starting GPG or GPQ narrows the list to IDs containing it (C1), and an exact GPG- or GPQ- ID opens that record
 * on Enter. Without MEMBERS.READ every text is part of an ID.
 */
export function FindBox({ kind, memberId, search, onMember, onSearch, onOpen }: {
  kind: 'guarantee' | 'quote';
  memberId?: string;
  /** the ID search the list is narrowed by */
  search?: string;
  onMember: (id: string | undefined) => void;
  onSearch: (search: string | undefined) => void;
  /** opens a record, with the search the list behind it should have */
  onOpen: (path: string, search: string | undefined) => void;
}) {
  const grants = useGrants();
  const members = can(grants, 'MEMBERS.READ');
  const [text, setText] = React.useState(search ?? '');
  const [memberSearch, setMemberSearch] = React.useState('');
  const id = text.trim().toUpperCase();
  // GPG or GPQ, alone or with its dash, so a name such as Gpanga is still a name
  const isId = !!id && (/^GP[GQ](-|$)/.test(id) || !members);
  const other = kind === 'guarantee' ? 'quote' : 'guarantee';
  // the other kind's IDs aren't in this list, so its prefix opens one but searches nothing
  const otherKind = id.startsWith(PREFIX[other]);
  const wanted = isId && !otherKind ? id : undefined;

  React.useEffect(() => {
    const t = setTimeout(() => {
      setMemberSearch(isId ? '' : text.trim());
      if (wanted !== search) onSearch(wanted);
    }, 300);
    return () => clearTimeout(t);
    // onSearch changes on every render; what's typed and the list's search are what matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, isId, wanted, search]);

  const chosen = useQuery({ queryKey: ['members', memberId], queryFn: () => getMember(memberId!), enabled: members && !!memberId });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // the search goes with it, as one waiting for a pause in typing would close the record when it came
    if (GUARANTEE_ID.test(id)) onOpen(`/guarantees/${id}`, wanted);
    else if (QUOTE_ID.test(id)) onOpen(`/guarantees/quotes/${id}`, wanted);
    // the text stays, so the list behind the record keeps its search
  };

  const exampleId = `${PREFIX[kind]}-`;
  const exact = GUARANTEE_ID.test(id) || QUOTE_ID.test(id);
  const hint = !isId
    ? ''
    : exact
      ? `Press Enter to open it.${otherKind ? '' : ` The list shows ${kind}s whose ID contains it.`}`
      : otherKind
        ? `That's a ${other} ID. ${other === 'quote' ? 'Quotes' : 'Guarantees'} are searched on their own tab, or open one by its exact ID.`
        : `Showing ${kind}s whose ID contains “${id}”.`;
  const matches = members && !isId && memberSearch.length >= 2 && memberSearch === text.trim();

  return (
    <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5 sm:max-w-[420px]">
      <form role="search" onSubmit={submit} className="relative">
        <Input
          type="search"
          aria-label={members ? `Find a member, or a ${exampleId} ID or part of it` : `Find a ${exampleId} ID or part of it`}
          aria-describedby={hint ? 'find-hint' : undefined}
          placeholder={members ? `Member, or a ${exampleId} ID` : `A ${exampleId} ID, or part of it`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && text && (e.stopPropagation(), setText(''))}
        />
        {matches ? (
          <MemberMatches
            search={memberSearch}
            onPick={(m) => {
              onMember(m);
              setText('');
            }}
          />
        ) : null}
      </form>
      {hint ? (
        <p id="find-hint" className="m-0 text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
      {memberId ? (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex min-h-8 items-center gap-1 rounded-full border border-primary bg-selected pl-3 pr-1 font-semibold text-ink-strong">
            Member: {chosen.data ? `${fullName(chosen.data) || 'Unnamed member'}, ${chosen.data.member?.memberNumber ?? ''}` : chosen.isError || !members ? 'the chosen member' : '…'}
            <button type="button" onClick={() => onMember(undefined)} aria-label="Show every member's" title="Show every member's" className="flex size-7 items-center justify-center rounded-full hover:bg-chip">
              <X className="size-4" />
            </button>
          </span>
        </span>
      ) : null}
    </div>
  );
}

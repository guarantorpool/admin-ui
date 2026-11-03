import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { errorMessage } from '@/api/errors';
import { GUARANTEE_ID, QUOTE_ID } from '@/api/guarantees';
import { getMember, listMembers } from '@/api/members';
import { Input } from '@/components/ui/input';
import { fullName } from '@/lib/names';
import { can } from '@/lib/permissions';
import { useGrants } from '@/session/SessionProvider';

const MATCHES = 6;

/**
 * One box for both: a member, chosen from those whose name, email, phone or member number matches, filters
 * the list; an exact GPG- or GPQ- ID opens that record. Searching by part of an ID is Phase C.
 */
export function FindBox({ kind, memberId, onMember, onOpen }: { kind: 'guarantee' | 'quote'; memberId?: string; onMember: (id: string | undefined) => void; onOpen: (path: string) => void }) {
  const grants = useGrants();
  const members = can(grants, 'MEMBERS.READ');
  const [text, setText] = React.useState('');
  const [search, setSearch] = React.useState('');
  const id = text.trim().toUpperCase();
  const isId = /^GP[GQ]-/.test(id);

  React.useEffect(() => {
    const t = setTimeout(() => setSearch(isId ? '' : text.trim()), 300);
    return () => clearTimeout(t);
  }, [text, isId]);

  const found = useQuery({
    queryKey: ['members', 'list', { page: 1, size: MATCHES, q: search }],
    queryFn: () => listMembers({ page: 1, size: MATCHES, search }),
    enabled: members && search.length >= 2
  });
  const chosen = useQuery({ queryKey: ['members', memberId], queryFn: () => getMember(memberId!), enabled: members && !!memberId });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (GUARANTEE_ID.test(id)) onOpen(`/guarantees/${id}`);
    else if (QUOTE_ID.test(id)) onOpen(`/guarantees/quotes/${id}`);
    else return;
    setText('');
  };

  const exampleId = kind === 'guarantee' ? 'GPG-' : 'GPQ-';
  const hint = isId && !GUARANTEE_ID.test(id) && !QUOTE_ID.test(id)
    ? `Planned: searching by part of an ID. Today a ${kind} is opened by its exact ID, for example ${kind === 'guarantee' ? 'GPG-2026-000123' : 'GPQ-7K2M9P'}.`
    : isId
      ? 'Press Enter to open it.'
      : '';
  const matches = !isId && search.length >= 2 && search === text.trim() ? found : null;

  return (
    <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5 sm:max-w-[420px]">
      <form role="search" onSubmit={submit} className="relative">
        <Input
          type="search"
          aria-label={members ? `Find a member, or open an exact ${exampleId} ID` : `Open an exact ${exampleId} ID`}
          aria-describedby={hint ? 'find-hint' : undefined}
          placeholder={members ? `Member, or an exact ${exampleId} ID` : `An exact ${exampleId} ID`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && text && (e.stopPropagation(), setText(''))}
        />
        {matches ? (
          <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-ctl border border-line bg-surface shadow-[0_8px_24px_rgba(11,35,80,0.16)]">
            {matches.isPending ? (
              <p className="m-0 px-3 py-2 text-muted">Finding members…</p>
            ) : matches.isError ? (
              <p className="m-0 px-3 py-2 text-bad-fg">{errorMessage(matches.error)}</p>
            ) : matches.data.results?.length ? (
              <ul aria-label="Matching members" className="m-0 list-none p-0">
                {matches.data.results.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onMember(m.id);
                        setText('');
                      }}
                      className="flex min-h-10 w-full flex-col items-start px-3 py-1.5 text-left hover:bg-page focus-visible:bg-page"
                    >
                      <span className="font-semibold">{fullName(m) || 'Unnamed member'}</span>
                      <span className="text-[13px] text-muted">
                        {m.member?.memberNumber ?? '—'} · {m.phoneNumber ?? '—'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 px-3 py-2 text-muted">No members match.</p>
            )}
          </div>
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

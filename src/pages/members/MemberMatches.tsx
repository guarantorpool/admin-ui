import { useQuery } from '@tanstack/react-query';
import { errorMessage } from '@/api/errors';
import { listMembers } from '@/api/members';
import { fullName } from '@/lib/names';

const MATCHES = 6;

/** The members whose name, email, phone or member number match `search`, as a list under a search box. */
export function MemberMatches({ search, onPick }: { search: string; onPick: (id: string) => void }) {
  const found = useQuery({
    queryKey: ['members', 'list', { page: 1, size: MATCHES, q: search }],
    queryFn: () => listMembers({ page: 1, size: MATCHES, search })
  });
  return (
    <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-ctl border border-line bg-surface shadow-[0_8px_24px_rgba(11,35,80,0.16)]">
      {found.isPending ? (
        <p className="m-0 px-3 py-2 text-muted">Finding members…</p>
      ) : found.isError ? (
        <p className="m-0 px-3 py-2 text-bad-fg">{errorMessage(found.error)}</p>
      ) : found.data.results?.length ? (
        <ul aria-label="Matching members" className="m-0 list-none p-0">
          {found.data.results.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onPick(m.id!)}
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
  );
}

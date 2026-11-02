import { useQuery } from '@tanstack/react-query';
import { getMember } from '@/api/members';
import { fullName } from '@/lib/names';
import { can } from '@/lib/permissions';
import { useGrants } from '@/session/SessionProvider';

/** The member's name and number, when this admin can read members; their ID otherwise. */
export function useMemberName(memberId: string | undefined) {
  const grants = useGrants();
  const readable = !!memberId && can(grants, 'MEMBERS.READ');
  const query = useQuery({ queryKey: ['members', memberId], queryFn: () => getMember(memberId!), enabled: readable });
  if (!memberId) return { text: '—', link: null };
  if (!readable) return { text: memberId, link: null };
  if (!query.data) return { text: query.isError ? memberId : '…', link: null };
  return { text: `${fullName(query.data) || 'Unnamed member'}, ${query.data.member?.memberNumber ?? ''}`, link: `/members/${memberId}` };
}

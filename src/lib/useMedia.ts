import * as React from 'react';

/** Phone width: the menu opens as a panel and tables become lists. */
export const COMPACT_QUERY = '(max-width: 767px)';
/** Wide enough for the member detail panel at its larger width. */
export const WIDE_QUERY = '(min-width: 1200px)';

export function useMedia(query: string): boolean {
  const [matches, setMatches] = React.useState(() => matchMedia(query).matches);
  React.useEffect(() => {
    const m = matchMedia(query);
    const on = () => setMatches(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return matches;
}

export const useCompact = () => useMedia(COMPACT_QUERY);

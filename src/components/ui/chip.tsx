import * as React from 'react';
import { cn } from '@/lib/utils';

/** A filter chip: one of a row of choices, pressed when chosen. */
export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn('min-h-9 rounded-full border px-3.5 font-semibold', on ? 'border-primary bg-primary text-white' : 'border-ctl bg-surface text-ink-strong hover:bg-chip')}
    >
      {children}
    </button>
  );
}

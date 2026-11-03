import { MoreVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu';

/** One thing to do to a row's record, and why it can't be done, if it can't. */
export interface RowAction {
  label: string;
  why: string;
  run: () => void;
}

/** A row's options menu; an action that can't be done shows why instead. */
export function RowMenu({ name, actions }: { name: string; actions: RowAction[] }) {
  if (!actions.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Options for ${name}`} title="Options" className="mr-2 flex size-9 shrink-0 items-center justify-center rounded-ctl text-ink-2 hover:bg-chip">
        <MoreVertical className="size-[18px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {actions.map((x) => (
          <DropdownMenuItem key={x.label} disabled={!!x.why} onSelect={x.run} className={cn(x.why && 'flex-col items-start justify-center gap-0.5 py-2')}>
            {x.label}
            {x.why ? <span className="text-[12px] font-normal">{x.why}</span> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatNumber } from '@/lib/format';
import { Button } from './button';

export const PAGE_SIZES = [10, 25, 50] as const;

/** "Showing 26–50 of 132" with rows per page and previous / next, for lists the backend pages (pages start at 1). */
export function Pager({ page, size, total, onPage, onSize }: { page: number; size: number; total: number; onPage: (p: number) => void; onSize?: (s: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const first = total === 0 ? 0 : (page - 1) * size + 1;
  const last = Math.min(total, page * size);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-line px-3.5 py-2">
      <span className="text-muted" aria-live="polite">
        {total === 0 ? 'Nothing to show' : `Showing ${formatNumber(first)}–${formatNumber(last)} of ${formatNumber(total)}`}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {onSize ? (
          <select
            aria-label="Rows per page"
            value={size}
            onChange={(e) => onSize(Number(e.target.value))}
            className="mr-2 min-h-9 rounded-ctl border border-ctl bg-surface px-2 text-ink"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s} rows
              </option>
            ))}
          </select>
        ) : null}
        <Button variant="outline" size="icon" aria-label="Previous page" title="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft />
        </Button>
        <span className="px-1.5 tabular-nums">
          Page {formatNumber(page)} of {formatNumber(pages)}
        </span>
        <Button variant="outline" size="icon" aria-label="Next page" title="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

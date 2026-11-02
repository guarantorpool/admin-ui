import * as React from 'react';
import { Link } from 'react-router-dom';
import { useCompact } from '@/lib/useMedia';
import { cn } from '@/lib/utils';

export interface Column<T> {
  header: string;
  cell: (row: T) => React.ReactNode;
  /** right-aligned figures */
  figure?: boolean;
}

/**
 * A list whose every row opens a record: a table with `columns` laid out on `grid`, or at phone width a
 * list showing the first column, the last one beside it and `sub` below.
 */
export function Rows<T>({ label, rows, rowKey, columns, grid, minWidth = 680, linkFor, sub }: { label: string; rows: T[]; rowKey: (row: T) => string; columns: Column<T>[]; grid: string; minWidth?: number; linkFor: (row: T) => string; sub: (row: T) => React.ReactNode }) {
  const compact = useCompact();
  if (compact) {
    const first = columns[0]!;
    const last = columns.at(-1)!;
    return (
      <ul aria-label={label} className="m-0 list-none p-0">
        {rows.map((r) => (
          <li key={rowKey(r)} className="border-b border-line last:border-b-0">
            <Link to={linkFor(r)} className="flex flex-col gap-0.5 px-3.5 py-2 text-ink no-underline hover:bg-page">
              <span className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="font-semibold [overflow-wrap:anywhere]">{first.cell(r)}</span>
                {last.cell(r)}
              </span>
              <span className="text-ink-3 [overflow-wrap:anywhere]">{sub(r)}</span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth }} role="table" aria-label={label}>
        <div role="row" className={cn('grid gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted', grid)}>
          {columns.map((c) => (
            <span key={c.header} role="columnheader" className={cn(c.figure && 'text-right')}>
              {c.header}
            </span>
          ))}
        </div>
        {rows.map((r) => (
          <div key={rowKey(r)} role="row" className="border-t border-line hover:bg-page">
            <Link to={linkFor(r)} className={cn('grid min-h-11 items-center gap-3 px-4 py-1 text-ink no-underline', grid)}>
              {columns.map((c, i) => (
                <span key={c.header} role="cell" className={cn('min-w-0 [overflow-wrap:anywhere]', i === 0 && 'font-semibold', c.figure && 'text-right tabular-nums')}>
                  {c.cell(r)}
                </span>
              ))}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

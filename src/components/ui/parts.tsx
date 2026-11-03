import * as React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from './badge';
import type { Tone } from '@/lib/labels';

// The wireframe's detail-panel pieces: stat tiles, labelled fields, score bars and item rows.

const smallCaps = 'text-[11px] font-semibold uppercase tracking-[0.1em] text-muted';

export function StatusPill({ label }: { label: { text: string; tone: Tone } }) {
  return <Badge tone={label.tone}>{label.text}</Badge>;
}

export interface Tile {
  label: string;
  value: string;
  unit?: string;
  note?: React.ReactNode;
}

export function StatTiles({ tiles, className }: { tiles: Tile[]; className?: string }) {
  return (
    <div className={cn('grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3', className)}>
      {tiles.map((t) => (
        <div key={t.label} className="flex min-w-0 flex-col gap-0.5">
          <span className={smallCaps}>{t.label}</span>
          <span className="flex flex-wrap items-baseline gap-1.5">
            <span className="font-heading text-[22px] font-semibold tabular-nums text-ink-strong [overflow-wrap:anywhere]">{t.value}</span>
            {t.unit ? <span className="text-xs text-muted">{t.unit}</span> : null}
          </span>
          {t.note ? <span className="text-xs text-muted">{t.note}</span> : null}
        </div>
      ))}
    </div>
  );
}

export function Fields({ rows }: { rows: { k: string; v: React.ReactNode }[] }) {
  return (
    <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
      {rows.map((r) => (
        <div key={r.k} className="flex min-w-0 flex-col gap-0.5">
          <dt className={smallCaps}>{r.k}</dt>
          <dd className="m-0 [overflow-wrap:anywhere]">{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A score out of 100 as a bar. */
export function Bars({ bars }: { bars: { label: string; value: string; pct: number }[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      {bars.map((b) => (
        <div key={b.label} className="flex flex-col gap-1">
          <div className="flex justify-between gap-3">
            <span>{b.label}</span>
            <span className="font-medium tabular-nums">{b.value}</span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-line" aria-hidden="true">
            <div className="h-2 rounded bg-primary" style={{ width: `${Math.max(0, Math.min(100, b.pct))}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Rows of items. `inset` pads each row, for a list inside a bordered box. */
export function Items({ children, label, inset }: { children: React.ReactNode; label?: string; inset?: boolean }) {
  return (
    <ul aria-label={label} className={cn('m-0 flex list-none flex-col p-0', inset && '[&>li]:px-3.5')}>
      {children}
    </ul>
  );
}

export function Item({ title, sub, status, actions }: { title: React.ReactNode; sub?: React.ReactNode; status?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line py-2.5 first:border-t-0">
      <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
        <span className="font-semibold [overflow-wrap:anywhere]">{title}</span>
        {sub ? <span className="text-muted [overflow-wrap:anywhere]">{sub}</span> : null}
      </div>
      {status || actions ? (
        <div className="flex flex-wrap items-center gap-2">
          {status}
          {actions}
        </div>
      ) : null}
    </li>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="m-0 font-heading text-[15px] font-bold">{children}</h3>;
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <p className="m-0 text-muted">{children}</p>;
}

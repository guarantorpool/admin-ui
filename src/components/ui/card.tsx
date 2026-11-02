import * as React from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <section className={cn('flex flex-col gap-3 rounded-card border border-line bg-surface p-4', className)} {...props} />;
}

export function CardHeader({ title, actions }: { title: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="m-0 text-base font-bold">{title}</h2>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** Label and value rows, as in the wireframe's detail cards. */
export function Lines({ rows }: { rows: { k: string; v: React.ReactNode }[] }) {
  return (
    <dl className="m-0 flex flex-col">
      {rows.map((r) => (
        <div key={r.k} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 border-t border-line py-2 first:border-t-0">
          <dt className="text-muted">{r.k}</dt>
          <dd className="m-0 font-medium [overflow-wrap:anywhere]">{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TabOption {
  value: string;
  label: string;
}

/**
 * The wireframe's underlined tabs. Each tab controls the panel with id `${idPrefix}-panel-${value}`, which
 * the page renders (see TabPanel).
 */
export function Tabs({ label, idPrefix, tabs, value, onChange }: { label: string; idPrefix: string; tabs: readonly TabOption[]; value: string; onChange: (v: string) => void }) {
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  // arrow keys move between tabs, as for any tab list
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.value === value);
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step || i < 0) return;
    e.preventDefault();
    const next = tabs[(i + step + tabs.length) % tabs.length];
    if (!next) return;
    onChange(next.value);
    refs.current[next.value]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex gap-1 overflow-x-auto border-b border-line-2">
      {tabs.map((t) => (
        <button
          key={t.value}
          ref={(el) => {
            refs.current[t.value] = el;
          }}
          role="tab"
          type="button"
          id={`${idPrefix}-tab-${t.value}`}
          aria-selected={value === t.value}
          aria-controls={`${idPrefix}-panel-${t.value}`}
          tabIndex={value === t.value ? 0 : -1}
          onClick={() => onChange(t.value)}
          className={cn(
            '-mb-px min-h-9 shrink-0 whitespace-nowrap border-b-[3px] px-3.5',
            value === t.value ? 'border-primary font-bold text-ink-strong' : 'border-transparent font-medium text-muted hover:text-ink'
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ idPrefix, value, className, children }: { idPrefix: string; value: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-${value}`} aria-labelledby={`${idPrefix}-tab-${value}`} className={className}>
      {children}
    </div>
  );
}

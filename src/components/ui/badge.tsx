import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', {
  variants: {
    tone: {
      neutral: 'bg-chip text-ink-2',
      ok: 'bg-ok-bg text-ok-fg',
      warn: 'bg-warn-bg text-warn-fg',
      bad: 'bg-bad-bg text-bad-fg',
      plan: 'bg-plan-bg text-plan-fg'
    }
  },
  defaultVariants: { tone: 'neutral' }
});

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

const bannerTones = { ok: 'bg-ok-bg text-ok-fg', warn: 'bg-warn-bg text-warn-fg', bad: 'bg-bad-bg text-bad-fg', plan: 'bg-plan-bg text-plan-fg' };

/** A full-width message: green for done, amber for blocked, red for errors. */
export function Banner({ tone, className, ...props }: React.HTMLAttributes<HTMLParagraphElement> & { tone: keyof typeof bannerTones }) {
  return <p role={tone === 'bad' ? 'alert' : 'status'} className={cn('m-0 rounded-ctl p-3 font-medium', bannerTones[tone], className)} {...props} />;
}

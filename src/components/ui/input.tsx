import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, type, ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      'min-h-9 w-full rounded-ctl border border-ctl bg-surface px-3 text-sm text-ink placeholder:text-disabled disabled:opacity-60 aria-[invalid=true]:border-danger',
      'file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-semibold file:text-ink-strong',
      className
    )}
    {...props}
  />
));
Input.displayName = 'Input';

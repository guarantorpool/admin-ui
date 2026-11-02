import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cn } from '@/lib/utils';

export function initials(first?: string | null, last?: string | null, email?: string | null): string {
  const a = (first ?? '').trim()[0] ?? '';
  const b = (last ?? '').trim()[0] ?? '';
  return (a + b || (email ?? '').trim()[0] || '?').toUpperCase();
}

/** The admin's picture, or their initials until they upload one. */
export function Avatar({ src, text, className }: { src?: string | null; text: string; className?: string }) {
  return (
    <AvatarPrimitive.Root className={cn('flex size-7 shrink-0 overflow-hidden rounded-full', className)}>
      {src ? <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" /> : null}
      <AvatarPrimitive.Fallback className="flex size-full items-center justify-center bg-primary text-xs font-bold text-white" aria-hidden="true">
        {text}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

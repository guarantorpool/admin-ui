import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The wireframe's detail panel: slides over the list from the right, full width on a phone. Escape, the
 * close button and a click outside close it.
 */
export function Sheet({ open, onClose, title, wide, children }: { open: boolean; onClose: () => void; title: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-30 bg-[rgba(11,35,80,0.25)] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            'fixed inset-y-0 right-0 z-30 flex w-full flex-col gap-3.5 overflow-y-auto bg-page px-4 py-4 shadow-[-12px_0_32px_rgba(11,35,80,0.2)] sm:px-5',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-right-10',
            wide ? 'max-w-[960px]' : 'max-w-[640px]'
          )}
        >
          <div className="flex items-center justify-between gap-2.5">
            <DialogPrimitive.Title className="m-0 font-heading text-base font-bold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="flex size-9 items-center justify-center rounded-ctl text-ink-2 hover:bg-chip" aria-label="Close">
              <X className="size-[18px]" />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

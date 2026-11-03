import * as React from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/utils';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;

export function DropdownMenuContent({ className, sideOffset = 8, ...props }: React.ComponentPropsWithoutRef<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={sideOffset}
        align="end"
        className={cn('z-50 min-w-[240px] max-w-[calc(100vw-32px)] overflow-hidden rounded-card border border-line-2 bg-surface shadow-pop', className)}
        {...props}
      />
    </Menu.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: React.ComponentPropsWithoutRef<typeof Menu.Item>) {
  return (
    <Menu.Item
      className={cn(
        'flex min-h-9 cursor-pointer items-center gap-2.5 border-t border-line px-3.5 font-medium text-ink outline-none first:border-t-0 data-[disabled]:cursor-default data-[highlighted]:bg-chip data-[disabled]:text-muted [&_svg]:size-4',
        className
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentPropsWithoutRef<typeof Menu.Label>) {
  return <Menu.Label className={cn('flex flex-col gap-0.5 border-b border-line px-3.5 py-3 [overflow-wrap:anywhere]', className)} {...props} />;
}

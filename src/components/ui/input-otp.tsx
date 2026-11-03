import * as React from 'react';
import { OTPInput, type SlotProps } from 'input-otp';
import { cn } from '@/lib/utils';

function Slot({ char, hasFakeCaret, isActive }: SlotProps) {
  return (
    <div
      className={cn(
        'relative flex size-11 items-center justify-center rounded-ctl border border-ctl bg-surface text-lg font-semibold text-ink',
        isActive && 'ring-2 ring-primary'
      )}
    >
      {char}
      {hasFakeCaret ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-px animate-pulse bg-ink" />
        </div>
      ) : null}
    </div>
  );
}

interface OtpInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
}

/** Six digits, one box each; pasting the whole code works. */
export const OtpInput = React.forwardRef<HTMLInputElement, OtpInputProps>(({ id, value, onChange, onComplete, disabled }, ref) => (
  <OTPInput
    ref={ref}
    id={id}
    maxLength={6}
    value={value}
    onChange={onChange}
    onComplete={onComplete}
    disabled={disabled}
    inputMode="numeric"
    pattern="^[0-9]+$"
    autoComplete="one-time-code"
    containerClassName="flex gap-2"
    render={({ slots }) => (
      <>
        {slots.map((s, i) => (
          <Slot key={i} {...s} />
        ))}
      </>
    )}
  />
));
OtpInput.displayName = 'OtpInput';

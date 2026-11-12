import * as React from 'react';

/** Seconds left of `seconds`, counting down to 0; it starts again when `seconds` or `restartKey` changes. */
export function useCountdown(seconds: number, restartKey: unknown): number {
  const [left, setLeft] = React.useState(seconds);
  React.useEffect(() => {
    setLeft(seconds);
    if (seconds <= 0) return;
    const until = Date.now() + seconds * 1000;
    const t = window.setInterval(() => {
      const s = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) window.clearInterval(t);
    }, 500);
    return () => window.clearInterval(t);
  }, [seconds, restartKey]);
  return left;
}

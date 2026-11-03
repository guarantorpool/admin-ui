import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { EnvBadge } from '@/components/shell/AppShell';
import { useTheme } from '@/theme/theme';
import logoUrl from '@/assets/blockcoop-logo.png';

/** The navy page with one white card, as in the wireframe's sign-in screens. */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  const { theme, toggle } = useTheme();
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <div className="flex min-h-screen items-center justify-center bg-nav px-4 py-16">
      <div className="fixed right-4 top-3 flex items-center gap-2">
        <EnvBadge />
        <button
          type="button"
          onClick={toggle}
          aria-label={label}
          title={label}
          aria-pressed={theme === 'dark'}
          className="flex size-9 items-center justify-center rounded-ctl border border-ctl text-white hover:bg-white/10 [&_svg]:size-5"
        >
          {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        </button>
      </div>
      <div className="flex w-full max-w-[420px] flex-col gap-4 rounded-card bg-surface p-8">
        {/* the logo is navy on white, so it keeps a white tile in dark mode */}
        <div className="-mx-2 -mt-2 overflow-hidden rounded-ctl bg-white">
          <img src={logoUrl} alt="BlockCoop, the Blockchain SACCO" className="block h-auto w-full" />
        </div>
        <p className="m-0 font-heading text-[22px] font-bold leading-tight text-ink-strong">BlockCoop Guarantor Pool Admin</p>
        {children}
      </div>
    </div>
  );
}

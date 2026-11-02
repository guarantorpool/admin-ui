import * as React from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, LogOut, Menu, Moon, Sun, User, X } from 'lucide-react';
import { Avatar, initials } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { env } from '@/lib/env';
import { cn } from '@/lib/utils';
import { useGrants, useSession } from '@/session/SessionProvider';
import * as store from '@/session/store';
import { useTheme } from '@/theme/theme';
import { findScreen, visibleNav, type NavGroup } from './nav';

const COMPACT_QUERY = '(max-width: 767px)';

function useCompact(): boolean {
  const [compact, setCompact] = React.useState(() => matchMedia(COMPACT_QUERY).matches);
  React.useEffect(() => {
    const m = matchMedia(COMPACT_QUERY);
    const on = () => setCompact(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return compact;
}

const iconButton =
  'relative flex size-9 shrink-0 items-center justify-center rounded-ctl border border-ctl bg-surface text-ink-strong hover:bg-chip [&_svg]:size-5';

function NavItem({ to, label, onNavigate, nested }: { to: string; label: string; onNavigate: () => void; nested?: boolean }) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex min-h-9 items-center rounded-ctl px-2.5 text-left no-underline',
          nested ? 'font-normal' : 'font-medium',
          isActive ? 'bg-nav-on text-nav-on-fg' : 'text-white hover:bg-white/10'
        )
      }
    >
      {label}
    </NavLink>
  );
}

function Group({ group, onNavigate }: { group: NavGroup; onNavigate: () => void }) {
  const { pathname } = useLocation();
  const holdsCurrent = group.items.some((s) => s.path === pathname);
  const [open, setOpen] = React.useState(holdsCurrent);
  React.useEffect(() => {
    if (holdsCurrent) setOpen(true);
  }, [holdsCurrent]);
  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-9 w-full items-center justify-between gap-2 rounded-ctl px-2.5 text-left font-medium text-white hover:bg-white/10"
      >
        <span>{group.label}</span>
        <ChevronDown aria-hidden="true" className={cn('size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="flex flex-col gap-0.5 pl-3">
          {group.items.map((s) => (
            <NavItem key={s.path} to={s.path} label={s.label} onNavigate={onNavigate} nested />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SideNav({ compact, onClose }: { compact: boolean; onClose: () => void }) {
  const grants = useGrants();
  const entries = visibleNav(grants);
  return (
    <nav
      aria-label="Admin screens"
      className={cn(
        'flex w-[260px] shrink-0 flex-col gap-1 overflow-y-auto bg-nav p-3 text-white',
        compact ? 'fixed inset-y-0 left-0 z-40 shadow-pop' : 'sticky top-0 h-screen'
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2 px-1 py-1.5">
        <span className="flex items-center gap-2.5">
          <img src="/icon.svg" alt="" className="size-8 rounded-lg" />
          <span className="font-heading text-[15px] font-bold leading-tight">BlockCoop Guarantor Pool Admin</span>
        </span>
        {compact ? (
          <button type="button" onClick={onClose} aria-label="Close menu" className="flex size-9 items-center justify-center rounded-ctl hover:bg-white/10">
            <X className="size-5" />
          </button>
        ) : null}
      </div>
      {entries.map((e) =>
        e.kind === 'direct' ? (
          <NavItem key={e.screen.path} to={e.screen.path} label={e.screen.label} onNavigate={onClose} />
        ) : (
          <Group key={e.group.id} group={e.group} onNavigate={onClose} />
        )
      )}
    </nav>
  );
}

function ThemeButton() {
  const { theme, toggle } = useTheme();
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button type="button" onClick={toggle} aria-label={label} title={label} aria-pressed={theme === 'dark'} className={iconButton}>
      {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </button>
  );
}

function BellButton() {
  // Open alerts show here from slice 10, and approvals from Phase B.
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={iconButton} aria-label="Notifications">
        <Bell aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[360px]">
        <DropdownMenuLabel>
          <span className="font-heading text-base font-bold text-ink-strong">Notifications</span>
        </DropdownMenuLabel>
        <p className="m-0 px-4 py-3 text-muted">Open alerts show here once the Alerts screen is built (slice 10), and approvals once the inbox exists.</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ compact }: { compact: boolean }) {
  const { session } = useSession();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  if (!session) return null;
  const name = `${session.firstName} ${session.lastName}`.trim() || session.email;
  const text = initials(session.firstName, session.lastName, session.email);
  const signOut = async () => {
    await store.signOut('You signed out.');
    navigate('/sign-in', { replace: true });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Your account menu, ${name}`}
        className="flex min-h-9 items-center rounded-ctl border border-ctl bg-surface px-1 font-semibold text-ink-strong hover:bg-chip"
      >
        <Avatar src={session.picUrl} text={text} />
        {compact ? null : (
          <span className="flex items-center gap-2 pl-2 pr-1">
            {session.firstName || name}
            <ChevronDown aria-hidden="true" className="size-4" />
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>
          <span className="font-semibold text-ink">{name}</span>
          <span className="font-normal text-muted">{session.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => navigate('/account')}>
          <User aria-hidden="true" />
          Your account
        </DropdownMenuItem>
        {compact ? (
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); toggle(); }}>
            {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The page title, with the menu group above it as a breadcrumb. */
export function PageHeader({ title, actions }: { title?: string; actions?: React.ReactNode }) {
  const { pathname } = useLocation();
  const found = findScreen(pathname);
  const heading = title ?? found?.screen.label ?? '';
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        {found?.group ? (
          <p className="m-0 text-[13px] font-medium text-muted" aria-label="Breadcrumb">
            {found.group.label}
          </p>
        ) : null}
        <h1 className="m-0 text-2xl font-bold">{heading}</h1>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function EnvBadge({ className }: { className?: string }) {
  if (!env.badge) return null;
  return (
    <span
      className={cn('rounded-full bg-warn-bg px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-warn-fg', className)}
      title="Not the live portal. Data here is for testing."
    >
      {env.badge}
    </span>
  );
}

export function AppShell() {
  const compact = useCompact();
  const [navOpen, setNavOpen] = React.useState(false);
  const { pathname } = useLocation();

  React.useEffect(() => setNavOpen(false), [pathname, compact]);

  return (
    <div className="flex min-h-screen">
      {compact && navOpen ? (
        <button type="button" aria-label="Close menu" onClick={() => setNavOpen(false)} className="fixed inset-0 z-30 bg-[rgba(11,35,80,0.45)]" />
      ) : null}
      {!compact || navOpen ? <SideNav compact={compact} onClose={() => setNavOpen(false)} /> : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={cn(
            'sticky top-0 z-20 flex items-center gap-2 bg-page py-2.5',
            compact ? 'border-b border-line px-4' : 'px-6'
          )}
        >
          {compact ? (
            <button type="button" onClick={() => setNavOpen(true)} aria-label="Open menu" aria-expanded={navOpen} className={iconButton}>
              <Menu aria-hidden="true" />
            </button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <EnvBadge />
            {compact ? null : <ThemeButton />}
            <BellButton />
            <UserMenu compact={compact} />
          </div>
        </header>
        <main className={cn('flex min-w-0 flex-1 flex-col gap-4 pb-12 pt-2', compact ? 'px-4' : 'px-6')}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

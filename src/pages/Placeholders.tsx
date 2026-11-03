import { Link, useLocation } from 'react-router-dom';
import { PageHeader } from '@/components/shell/AppShell';
import { findScreen, homePath } from '@/components/shell/nav';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { can } from '@/lib/permissions';
import { useGrants } from '@/session/SessionProvider';

/** A screen that's in the menu but not built yet, so the whole menu can be reviewed from the start. */
export function ComingSoon() {
  const { pathname } = useLocation();
  const grants = useGrants();
  const found = findScreen(pathname);
  if (!found) return <NotFound />;
  const { screen } = found;
  if (!can(grants, screen.access)) return <NoAccess />;
  return (
    <>
      <PageHeader />
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="plan">Coming in {screen.comingIn}</Badge>
        </div>
        <p className="m-0">{screen.about}</p>
        <p className="m-0 text-muted">This screen isn't built yet. The build plan has it in {screen.comingIn}.</p>
      </Card>
    </>
  );
}

export function NoAccess() {
  const grants = useGrants();
  return (
    <>
      <PageHeader title="Not available to your role" />
      <Card>
        <p className="m-0">Your role can't open this screen. Ask an admin who manages roles if you need it.</p>
        <Link to={homePath(grants)} className="self-start font-medium text-ink-strong underline-offset-4 hover:underline">
          Go to your first screen
        </Link>
      </Card>
    </>
  );
}

export function NotFound() {
  const grants = useGrants();
  return (
    <>
      <PageHeader title="Page not found" />
      <Card>
        <p className="m-0">There's no page at this address.</p>
        <Link to={homePath(grants)} className="self-start font-medium text-ink-strong underline-offset-4 hover:underline">
          Go to your first screen
        </Link>
      </Card>
    </>
  );
}

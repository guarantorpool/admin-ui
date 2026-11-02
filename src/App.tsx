import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/shell/AppShell';
import { allScreens } from '@/components/shell/nav';
import { ComingSoon, NotFound } from '@/pages/Placeholders';

// The shell and its menu, for review before sign-in exists (slice 1).
export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        {allScreens().map((s) => (
          <Route key={s.path} path={s.path} element={<ComingSoon />} />
        ))}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

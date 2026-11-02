import * as React from 'react';

// Light or dark. Follows the system setting until the admin picks one; the choice is kept per browser
// and other tabs follow it. index.html applies it before the first paint.

export type Theme = 'light' | 'dark';
const KEY = 'blockcoop-theme';

function systemTheme(): Theme {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function savedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

const ThemeContext = React.createContext<{ theme: Theme; toggle: () => void }>({ theme: 'light', toggle: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = React.useState<Theme>(() => savedTheme() ?? systemTheme());

  React.useEffect(() => apply(theme), [theme]);

  React.useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const onSystem = () => {
      if (!savedTheme()) setTheme(systemTheme());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setTheme(savedTheme() ?? systemTheme());
    };
    media.addEventListener('change', onSystem);
    window.addEventListener('storage', onStorage);
    return () => {
      media.removeEventListener('change', onSystem);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const toggle = React.useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // storage blocked: the choice lasts for this page
      }
      return next;
    });
  }, []);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return React.useContext(ThemeContext);
}

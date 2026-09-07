import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import type { Theme } from '../lib/types';
import { useAuth } from './AuthContext';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => Promise<void>;
  toggleTheme: () => Promise<void>;
  loaded: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [theme, setThemeState] = useState<Theme>('dark');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    api
      .get<{ theme: Theme }>('/settings')
      .then((s) => {
        if (!cancelled) setThemeState(s.theme);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setTheme = useCallback(async (t: Theme) => {
    setThemeState(t);
    await api.patch('/settings', { theme: t });
  }, []);

  const toggleTheme = useCallback(async () => {
    await setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme, loaded }), [theme, setTheme, toggleTheme, loaded]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

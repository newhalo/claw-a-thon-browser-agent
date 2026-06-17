'use client';

import { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'system' | 'light' | 'dark';

interface Ctx {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (t: Theme) => void;
}

const ThemeCtx = createContext<Ctx>({ theme: 'system', resolvedTheme: 'dark', setTheme: () => {} });

const STORAGE_KEY = 'theme';

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolve(t: Theme): 'light' | 'dark' {
  return t === 'system' ? getSystemTheme() : t;
}

function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', resolve(t));
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');

  useEffect(() => {
    const saved = (localStorage.getItem(STORAGE_KEY) as Theme) || 'system';
    setThemeState(saved);
    applyTheme(saved);

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => setThemeState(prev => { applyTheme(prev); return prev; });
    mq.addEventListener('change', onSystemChange);
    return () => mq.removeEventListener('change', onSystemChange);
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    applyTheme(t);
    localStorage.setItem(STORAGE_KEY, t);
  };

  return (
    <ThemeCtx.Provider value={{ theme, resolvedTheme: resolve(theme), setTheme }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export const useTheme = () => useContext(ThemeCtx);

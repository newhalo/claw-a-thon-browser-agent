import React, { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'system' | 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  resolvedTheme: 'light',
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');

  const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

  const resolved = (t: Theme): 'light' | 'dark' =>
    t === 'system' ? (systemDark() ? 'dark' : 'light') : t;

  const applyTheme = (t: Theme) => {
    const r = resolved(t);
    document.documentElement.setAttribute('data-theme', r);
  };

  useEffect(() => {
    chrome.storage.sync.get(['appTheme'], (result) => {
      const saved = (result.appTheme as Theme) || 'system';
      setThemeState(saved);
      applyTheme(saved);
    });

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
      setThemeState(prev => { applyTheme(prev); return prev; });
    };
    mq.addEventListener('change', onSystemChange);
    return () => mq.removeEventListener('change', onSystemChange);
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    applyTheme(t);
    chrome.storage.sync.set({ appTheme: t });
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme: resolved(theme), setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);

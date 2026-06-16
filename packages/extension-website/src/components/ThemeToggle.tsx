'use client';

import { useTheme, type Theme } from './ThemeProvider';

const options: { value: Theme; label: string; icon: string }[] = [
  { value: 'light',  label: 'Light',  icon: '☀️' },
  { value: 'system', label: 'System', icon: '💻' },
  { value: 'dark',   label: 'Dark',   icon: '🌙' },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-brand-border bg-brand-surface p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setTheme(opt.value)}
          title={opt.label}
          className={[
            'w-7 h-7 flex items-center justify-center rounded-md text-sm transition-colors',
            theme === opt.value
              ? 'bg-brand-accent text-white'
              : 'text-brand-muted hover:text-brand-fg',
          ].join(' ')}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}

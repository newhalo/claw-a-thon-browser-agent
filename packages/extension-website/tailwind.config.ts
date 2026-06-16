import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          bg:      'var(--bg)',
          surface: 'var(--surface)',
          surface2:'var(--surface2)',
          border:  'var(--border)',
          accent:  'var(--accent)',
          success: 'var(--success)',
          muted:   'var(--muted)',
          fg:      'var(--fg)',
          strong:  'var(--fg-strong)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;

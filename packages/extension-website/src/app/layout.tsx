import type { Metadata } from 'next';
import './globals.css';
import { Nav } from '@/components/Nav';
import { ThemeProvider } from '@/components/ThemeProvider';

export const metadata: Metadata = {
  title: 'Browser Agent — AI-powered Chrome Extension',
  description:
    'Browser Agent lets your AI assistant control and automate Chrome directly — read pages, navigate, fill forms, and more via the Model Context Protocol.',
  openGraph: {
    title: 'Browser Agent',
    description: 'AI-powered Chrome extension for browser automation via MCP',
    type: 'website',
  },
};

/* Inline script: apply saved theme before first paint to prevent flash */
const themeScript = `(function(){try{var t=localStorage.getItem('theme')||'system';var r=t==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;document.documentElement.setAttribute('data-theme',r);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ThemeProvider>
          <Nav />
          <main>{children}</main>
          <footer className="border-t border-brand-border mt-24 py-10 text-center text-brand-muted text-sm">
            <p>Built with ❤️ at VNG · Claw-a-thon</p>
          </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}

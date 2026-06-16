import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';

export function Nav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-brand-border bg-brand-bg/90 backdrop-blur-sm">
      <div className="mx-auto max-w-5xl px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold text-brand-strong">
          <svg width="24" height="24" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="64" cy="64" r="10" fill="var(--success)" />
            <path d="M64 20 A44 44 0 0 1 108 64" stroke="var(--accent)" strokeWidth="10" strokeLinecap="round" fill="none" />
            <path d="M108 64 A44 44 0 0 1 64 108" stroke="var(--accent)" strokeWidth="10" strokeLinecap="round" fill="none" opacity="0.7" />
            <path d="M64 108 A44 44 0 0 1 20 64" stroke="var(--accent)" strokeWidth="10" strokeLinecap="round" fill="none" opacity="0.4" />
          </svg>
          Browser Agent
        </Link>

        <div className="flex items-center gap-4 text-sm text-brand-muted">
          <Link href="/install" className="hover:text-brand-strong transition-colors hidden sm:block">Install</Link>
          <Link href="/docs" className="hover:text-brand-strong transition-colors hidden sm:block">Docs</Link>
          <ThemeToggle />
          <a
            href={process.env.NEXT_PUBLIC_DOWNLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-1.5 rounded-md bg-brand-accent text-white font-medium hover:opacity-80 transition-opacity"
          >
            Download
          </a>
        </div>
      </div>
    </nav>
  );
}

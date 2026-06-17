import Link from 'next/link';
import { Download, Zap, Globe, Lock, Cpu, ArrowRight, Code2 } from 'lucide-react';
import { ArchDiagram } from '@/components/ArchDiagram';

const DOWNLOAD_URL = process.env.NEXT_PUBLIC_DOWNLOAD_URL ?? '#';

const features = [
  {
    icon: Code2,
    title: 'Website-Provided Tools',
    description: 'Websites can register their own MCP tools with one script tag. The agent gains domain-specific actions — submit order, filter results, export data — beyond the built-in browser toolkit.',
    highlight: true,
  },
  {
    icon: Globe,
    title: 'Full Browser Control',
    description: 'Navigate pages, click elements, fill forms, read content — your AI can operate Chrome like a human with ~75 built-in browser tools.',
  },
  {
    icon: Zap,
    title: 'MCP Native',
    description: 'Built on the Model Context Protocol. Connect Cursor, Claude Desktop, or any MCP-compatible client directly to your browser.',
  },
  {
    icon: Lock,
    title: 'Secure by Default',
    description: 'Every request requires a Bearer token. High-risk tools are disabled by default. Dynamic token management — no server restart needed.',
  },
  {
    icon: Cpu,
    title: 'Any LLM Provider',
    description: 'Anthropic, OpenAI, or any OpenAI-compatible endpoint. Switch models without redeploying.',
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-6">

      {/* Hero */}
      <section className="pt-24 pb-16 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-brand-border bg-brand-surface px-3 py-1 text-xs text-brand-muted mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-success inline-block" />
          Free · Open Source · No Web Store required
        </div>

        <h1 className="text-5xl font-bold text-brand-strong leading-tight mb-6">
          Your AI assistant,
          <br />
          <span className="text-brand-accent">inside the browser</span>
        </h1>

        <p className="text-lg text-brand-muted max-w-2xl mx-auto mb-10">
          Browser Agent turns Chrome into an AI-controllable workspace — with ~75 built-in browser tools
          and the ability to use <strong className="text-brand-strong">custom tools exposed by the websites you visit</strong>.
        </p>

        <div className="flex items-center justify-center gap-4 flex-wrap">
          <a
            href={DOWNLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-brand-accent text-white font-semibold hover:bg-brand-accent/80 transition-colors"
          >
            <Download size={18} />
            Download Extension
          </a>
          <Link
            href="/install"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-brand-border text-brand-muted hover:text-white hover:border-brand-accent/50 transition-colors"
          >
            Installation Guide
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* Demo video */}
      <section className="mb-20">
        <div className="rounded-xl border border-brand-border bg-brand-surface overflow-hidden">
          <div className="aspect-video">
            <iframe
              src="https://drive.google.com/file/d/1pDn3c5FlXPMG39vhuN11cx4P3PjJBvgY/preview"
              className="w-full h-full"
              allow="autoplay"
              allowFullScreen
            />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mb-20">
        <h2 className="text-2xl font-bold text-brand-strong text-center mb-12">What it can do</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.map((f) => (
            <div
              key={f.title}
              className={`rounded-xl border p-6 flex gap-4 ${'highlight' in f && f.highlight
                ? 'border-brand-accent/40 bg-brand-accent/5 md:col-span-2'
                : 'border-brand-border bg-brand-surface'
              }`}
            >
              <div className="shrink-0 w-10 h-10 rounded-lg bg-brand-accent/10 flex items-center justify-center text-brand-accent">
                <f.icon size={20} />
              </div>
              <div>
                <h3 className="font-semibold text-brand-strong mb-1">{f.title}</h3>
                <p className="text-sm text-brand-muted">{f.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Architecture diagram placeholder */}
      <section className="mb-20">
        <h2 className="text-2xl font-bold text-brand-strong text-center mb-8">How it works</h2>
        <ArchDiagram />
      </section>

      {/* CTA */}
      <section className="mb-20 text-center rounded-xl border border-brand-accent/20 bg-brand-accent/5 p-12">
        <h2 className="text-2xl font-bold text-brand-strong mb-4">Ready to get started?</h2>
        <p className="text-brand-muted mb-8">Install takes under 2 minutes. No Chrome Web Store needed.</p>
        <Link
          href="/install"
          className="inline-flex items-center gap-2 px-8 py-3 rounded-lg bg-brand-accent text-white font-semibold hover:bg-brand-accent/80 transition-colors"
        >
          View Installation Guide
          <ArrowRight size={16} />
        </Link>
      </section>
    </div>
  );
}

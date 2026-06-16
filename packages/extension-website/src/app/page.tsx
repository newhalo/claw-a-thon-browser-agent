import Link from 'next/link';
import { Download, Zap, Globe, Lock, Cpu, ArrowRight } from 'lucide-react';
import { ArchDiagram } from '@/components/ArchDiagram';

const DOWNLOAD_URL = process.env.NEXT_PUBLIC_DOWNLOAD_URL ?? '#';

const features = [
  {
    icon: Globe,
    title: 'Full Browser Control',
    description: 'Navigate pages, click elements, fill forms, read content — your AI can operate Chrome like a human.',
  },
  {
    icon: Zap,
    title: 'MCP Native',
    description: 'Built on the Model Context Protocol. Works seamlessly with any MCP-compatible AI assistant.',
  },
  {
    icon: Lock,
    title: 'Secure & Local',
    description: 'All communication goes through your local native server. No cloud relay, no data leakage.',
  },
  {
    icon: Cpu,
    title: 'Agent-Ready',
    description: 'Connects to your agent service for LLM-powered multi-step automation workflows.',
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
          Browser Agent is a Chrome extension that exposes your browser as a set of MCP tools —
          letting any AI assistant navigate, interact, and automate the web on your behalf.
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

      {/* Demo video placeholder */}
      <section className="mb-20">
        <div className="rounded-xl border border-brand-border bg-brand-surface overflow-hidden">
          <div className="aspect-video flex flex-col items-center justify-center gap-3 text-brand-muted">
            {/* TODO: Replace with screen recording / GIF demo */}
            <div className="w-16 h-16 rounded-full border-2 border-dashed border-brand-border flex items-center justify-center">
              <span className="text-2xl">▶</span>
            </div>
            <p className="text-sm font-medium">[ Demo video / GIF — record and insert here ]</p>
            <p className="text-xs opacity-60">Recommended: 1280×720, show agent automating a real task</p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mb-20">
        <h2 className="text-2xl font-bold text-brand-strong text-center mb-12">What it can do</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-brand-border bg-brand-surface p-6 flex gap-4">
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

'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from './ThemeProvider';

interface Props {
  chart: string;
  caption?: string;
}

function themeVars(resolved: 'light' | 'dark') {
  if (resolved === 'light') {
    return {
      background: '#f4f5ff',
      mainBkg: '#ffffff',
      nodeBorder: '#4f5fe8',
      clusterBkg: '#eef0ff',
      clusterBorder: '#d4d7f0',
      titleColor: '#0f1028',
      edgeLabelBackground: '#eef0ff',
      primaryTextColor: '#2a2c4a',
      secondaryTextColor: '#6b6d8a',
      tertiaryTextColor: '#6b6d8a',
      textColor: '#2a2c4a',
      labelTextColor: '#2a2c4a',
      primaryColor: '#ffffff',
      primaryBorderColor: '#4f5fe8',
      secondaryColor: '#eef0ff',
      secondaryBorderColor: '#d4d7f0',
      tertiaryColor: '#f4f5ff',
      tertiaryBorderColor: '#d4d7f0',
      lineColor: '#4f5fe8',
      arrowheadColor: '#4f5fe8',
      activationBorderColor: '#00996a',
      activationBkgColor: '#ffffff',
      signalColor: '#6b6d8a',
      signalTextColor: '#2a2c4a',
      actorBkg: '#ffffff',
      actorBorder: '#4f5fe8',
      actorTextColor: '#2a2c4a',
      actorLineColor: '#d4d7f0',
      noteBkg: '#eef0ff',
      noteBorderColor: '#d4d7f0',
      noteTextColor: '#6b6d8a',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '14px',
    };
  }
  return {
    background: '#191929',
    mainBkg: '#22233a',
    nodeBorder: '#6B7FFF',
    clusterBkg: '#1d1e31',
    clusterBorder: '#2e2f4a',
    titleColor: '#e8e9f5',
    edgeLabelBackground: '#22233a',
    primaryTextColor: '#e8e9f5',
    secondaryTextColor: '#9899b5',
    tertiaryTextColor: '#9899b5',
    textColor: '#e8e9f5',
    labelTextColor: '#e8e9f5',
    primaryColor: '#22233a',
    primaryBorderColor: '#6B7FFF',
    secondaryColor: '#22233a',
    secondaryBorderColor: '#2e2f4a',
    tertiaryColor: '#191929',
    tertiaryBorderColor: '#2e2f4a',
    lineColor: '#6B7FFF',
    arrowheadColor: '#6B7FFF',
    activationBorderColor: '#00E5A0',
    activationBkgColor: '#22233a',
    signalColor: '#9899b5',
    signalTextColor: '#e8e9f5',
    actorBkg: '#22233a',
    actorBorder: '#6B7FFF',
    actorTextColor: '#e8e9f5',
    actorLineColor: '#2e2f4a',
    noteBkg: '#191929',
    noteBorderColor: '#2e2f4a',
    noteTextColor: '#9899b5',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: '14px',
  };
}

export function MermaidDiagram({ chart, caption }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    async function render() {
      try {
        const mermaid = (await import('mermaid')).default;

        mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          themeVariables: themeVars(resolvedTheme),
          flowchart: { curve: 'basis', padding: 20 },
          sequence: { diagramMarginX: 20, diagramMarginY: 20 },
        });

        const id = `mermaid-${resolvedTheme}-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, chart);

        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          const svgEl = ref.current.querySelector('svg');
          if (svgEl) {
            svgEl.removeAttribute('width');
            svgEl.removeAttribute('height');
            svgEl.style.width = '100%';
            svgEl.style.height = 'auto';
          }
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }

    render();
    return () => { cancelled = true; };
  }, [chart, resolvedTheme]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-xs text-red-400 font-mono">
        Diagram error: {error}
      </div>
    );
  }

  return (
    <figure className="rounded-xl border border-brand-border bg-brand-surface overflow-hidden transition-colors">
      <div ref={ref} className="p-6 flex items-center justify-center min-h-[120px]">
        <div className="text-brand-muted text-xs animate-pulse">Rendering diagram…</div>
      </div>
      {caption && (
        <figcaption className="px-6 pb-4 text-xs text-brand-muted text-center border-t border-brand-border pt-3">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

'use client';

import dynamic from 'next/dynamic';

export const Diagram = dynamic(
  () => import('./MermaidDiagram').then((m) => m.MermaidDiagram),
  { ssr: false }
);

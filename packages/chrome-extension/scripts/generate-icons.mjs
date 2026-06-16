#!/usr/bin/env node
/**
 * Generate extension PNG icons from the AgentLogo SVG design.
 * Requires librsvg (rsvg-convert). Install: brew install librsvg
 *
 * Usage: node packages/chrome-extension/scripts/generate-icons.mjs
 */

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dir, '../public/icons');
mkdirSync(outDir, { recursive: true });

// Design constants (128-unit space, proportional to all sizes)
const ACCENT  = '#6B7FFF';
const SUCCESS = '#00E5A0';
const BG      = '#191929';

// Arc paths — 3 concentric arcs opening to the right (like ))) )
// Derived from 128×128 reference:
//   Arc 1: M 24 97  C 48 80  48 47  24 31
//   Arc 2: M 45 104 C 70 84  70 43  45 24
//   Arc 3: M 67 111 C 94 87  94 41  67 17
// Dot: cx=102 cy=25 r=14
// All coordinates as fractions of viewBox size:
const ARCS = [
  { x1:24/128, y1:97/128, cx1:48/128, cy1:80/128, cx2:48/128, cy2:47/128, x2:24/128, y2:31/128 },
  { x1:45/128, y1:104/128, cx1:70/128, cy1:84/128, cx2:70/128, cy2:43/128, x2:45/128, y2:24/128 },
  { x1:67/128, y1:111/128, cx1:94/128, cy1:87/128, cx2:94/128, cy2:41/128, x2:67/128, y2:17/128 },
];
const DOT = { cx:102/128, cy:25/128, r:14/128 };

function makeIconSvg(size) {
  const s = size;
  const r = Math.round(s * 0.18);   // corner radius
  const sw = Math.max(1, s * 0.078); // stroke width
  const p = v => Math.round(v * s * 10) / 10;

  const paths = ARCS.map(a =>
    `  <path d="M ${p(a.x1)} ${p(a.y1)} C ${p(a.cx1)} ${p(a.cy1)} ${p(a.cx2)} ${p(a.cy2)} ${p(a.x2)} ${p(a.y2)}"
    stroke="${ACCENT}" stroke-width="${sw.toFixed(1)}" stroke-linecap="round" fill="none"/>`
  ).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" rx="${r}" fill="${BG}"/>
${paths}
  <circle cx="${p(DOT.cx)}" cy="${p(DOT.cy)}" r="${p(DOT.r)}" fill="${SUCCESS}"/>
</svg>`;
}

const sizes = [16, 32, 48, 128];

for (const size of sizes) {
  const svgPath = resolve(outDir, `_tmp-icon-${size}.svg`);
  const pngPath = resolve(outDir, `icon-${size}.png`);
  writeFileSync(svgPath, makeIconSvg(size));
  try {
    execSync(`rsvg-convert -w ${size} -h ${size} "${svgPath}" -o "${pngPath}"`, { stdio: 'inherit' });
    console.log(`✓ icon-${size}.png`);
  } catch (e) {
    console.error(`✗ icon-${size}.png: ${e.message}`);
  }
  try { unlinkSync(svgPath); } catch {}
}

// Print 24×24 component paths for Icons.tsx
const p24 = v => Math.round(v * 24 * 100) / 100;
console.log('\n── AgentLogo 24×24 paths ──');
ARCS.forEach((a, i) =>
  console.log(`Arc ${i+1}: M ${p24(a.x1)} ${p24(a.y1)} C ${p24(a.cx1)} ${p24(a.cy1)} ${p24(a.cx2)} ${p24(a.cy2)} ${p24(a.x2)} ${p24(a.y2)}`)
);
console.log(`Dot: cx=${p24(DOT.cx)} cy=${p24(DOT.cy)} r=${p24(DOT.r)}`);

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

// Design constants
const ACCENT  = '#6B7FFF';
const SUCCESS = '#00E5A0';
const BG      = '#191929';

// Design: 3 circular arc segments (90° each) + center dot
// All in 128×128 reference space:
//   Center: (64, 64), radius: 44
//   Arc 1: top-right quarter  — M 64 20 A 44 44 0 0 1 108 64   (opacity 1.0)
//   Arc 2: right-bottom quarter — M 108 64 A 44 44 0 0 1 64 108  (opacity 0.7)
//   Arc 3: bottom-left quarter — M 64 108 A 44 44 0 0 1 20 64   (opacity 0.4)
//   Dot: cx=64, cy=64, r=10

function makeIconSvg(size) {
  const s = size;
  const r = Math.round(s * 0.18);    // corner radius
  const sw = Math.max(1, s * 0.078); // stroke width
  const cx = s / 2;
  const cy = s / 2;
  const rad = s * (44 / 128);
  const dotR = Math.max(1, s * (10 / 128));

  // Arc endpoints (on the circle)
  const top   = { x: cx,       y: cy - rad };
  const right = { x: cx + rad, y: cy       };
  const bot   = { x: cx,       y: cy + rad };
  const left  = { x: cx - rad, y: cy       };

  const arc = (x1, y1, x2, y2, op) =>
    `  <path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${rad.toFixed(1)} ${rad.toFixed(1)} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}"` +
    ` stroke="${ACCENT}" stroke-width="${sw.toFixed(1)}" stroke-linecap="round" fill="none"` +
    (op < 1 ? ` opacity="${op}"` : '') +
    `/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" rx="${r}" fill="${BG}"/>
${arc(top.x,   top.y,   right.x, right.y, 1.0)}
${arc(right.x, right.y, bot.x,   bot.y,   0.7)}
${arc(bot.x,   bot.y,   left.x,  left.y,  0.4)}
  <circle cx="${cx}" cy="${cy}" r="${dotR.toFixed(1)}" fill="${SUCCESS}"/>
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

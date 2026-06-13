/**
 * Agent Skills registry — reads SKILL.md files from the skills/ directory.
 *
 * Each skill lives in its own subdirectory:
 *   skills/<id>/SKILL.md
 *
 * SKILL.md format:
 *   --- (YAML frontmatter)
 *   name: Display Name
 *   description: One-line description shown in the UI for discovery
 *   icon: 🔍
 *   category: research | productivity | work | dev
 *   ---
 *
 *   Markdown instructions injected into the system prompt when the skill is active.
 *
 * Progressive disclosure: GET /skills returns only {id, name, description, icon, category}.
 * Full instructions are loaded only when the skill appears in activeSkills on a /chat request.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)));

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw.trim() };

  const meta = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    meta[key] = value;
  }
  return { meta, body: match[2].trim() };
}

function loadSkills() {
  const skills = [];
  let entries;
  try { entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true }); } catch { return skills; }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;

    try {
      const raw = fs.readFileSync(skillFile, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      if (!meta.name || !meta.description) continue;

      skills.push({
        id: entry.name,
        name: meta.name,
        description: meta.description,
        icon: meta.icon || '🔧',
        category: meta.category || 'general',
        systemPrompt: body,
      });
    } catch (err) {
      console.warn(`[skills] Failed to load ${entry.name}/SKILL.md:`, err.message);
    }
  }

  return skills;
}

// Load once at startup
const SKILLS = loadSkills();
console.log(`[skills] Loaded ${SKILLS.length} skill(s):`, SKILLS.map(s => s.id).join(', ') || '(none)');

export function getSkillById(id) {
  return SKILLS.find(s => s.id === id) ?? null;
}

/** Public catalog — name + description only, no instructions (progressive disclosure) */
export function getSkillsPublic() {
  return SKILLS.map(({ id, name, description, icon, category }) => ({ id, name, description, icon, category }));
}

export interface AgentServiceConfig {
  url: string;
}

export const DEFAULT_AGENT_SERVICE_URL = 'http://localhost:3000';

export async function getAgentServiceConfig(): Promise<AgentServiceConfig> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['agentServiceUrl'], (result) => {
      resolve({ url: result.agentServiceUrl || DEFAULT_AGENT_SERVICE_URL });
    });
  });
}

export async function saveAgentServiceConfig(config: AgentServiceConfig): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ agentServiceUrl: config.url }, resolve);
  });
}

export async function checkAgentServiceHealth(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Push native-server config to agent-service so it can connect to MCP.
 * Called after saving settings or on startup when both services are ready.
 */
export interface HealthStatus {
  status: string;
  provider?: { configured: boolean; provider?: string | null; model?: string | null; toolsSupported?: boolean | null };
  mcp?: string;
}

export async function checkAgentServiceHealthFull(url: string): Promise<HealthStatus | null> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export interface PredefinedModel {
  id: string;
  name: string;
  category: string;
  provider: string;
  baseUrl?: string;
  toolsSupported: boolean;
  visionSupported: boolean;
  default?: boolean;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
}

export interface CustomSkill {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  systemPrompt: string;
  sourceUrl: string;
  hasScripts: boolean;  // true if skill has scripts/ dir (not executable in browser)
  addedAt: number;
}

/** Parse a SKILL.md string (YAML frontmatter + markdown body). */
export function parseSkillMd(raw: string, sourceUrl: string): Omit<CustomSkill, 'addedAt' | 'hasScripts'> {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) throw new Error('Invalid SKILL.md format — missing YAML frontmatter');

  const fm = fmMatch[1];
  const body = fmMatch[2].trim();

  const get = (key: string, fallback = '') => {
    const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : fallback;
  };

  const name = get('name') || get('title');
  if (!name) throw new Error('SKILL.md missing required field: name');

  const slug = sourceUrl.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(-40);
  const id = `custom-${slug}`;

  return { id, name, description: get('description'), icon: get('icon', '🔧'), category: get('category', 'custom'), systemPrompt: body, sourceUrl };
}

// ── GitHub directory resolution ───────────────────────────────────────────────

/** Convert a skills.sh URL to the underlying GitHub tree URL. */
function skillsShToGitHub(url: string): string | null {
  // https://www.skills.sh/{owner}/{repo}/{skillPath}
  const m = url.match(/skills\.sh\/([^/]+)\/([^/]+)\/(.+)/);
  if (!m) return null;
  return `https://github.com/${m[1]}/${m[2]}/tree/main/skills/${m[3]}`;
}

/** Parse a GitHub tree URL into { owner, repo, branch, path }. */
function parseGitHubTree(url: string) {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.*)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], branch: m[3], path: m[4] };
}

/** Fetch raw file from GitHub. */
async function fetchRaw(owner: string, repo: string, branch: string, filePath: string): Promise<string> {
  const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  const res = await fetch(raw, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${filePath}`);
  return res.text();
}

/** List files in a GitHub directory via API. Returns [{name, type, path}]. */
async function listGitHubDir(owner: string, repo: string, branch: string, dirPath: string): Promise<{ name: string; type: string; path: string }[]> {
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}?ref=${branch}`;
  const res = await fetch(api, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  return res.json();
}

/**
 * Fetch a skill from a URL. Supports:
 *   - skills.sh URLs
 *   - GitHub directory (tree) URLs → fetches SKILL.md + references/*.md
 *   - GitHub blob (file) URLs → fetches single SKILL.md
 *   - Raw URLs → fetches single file
 */
export async function fetchSkillFromUrl(inputUrl: string): Promise<Omit<CustomSkill, 'addedAt'>> {
  let url = inputUrl.trim();

  // skills.sh → GitHub tree
  if (url.includes('skills.sh/')) {
    const gh = skillsShToGitHub(url);
    if (gh) url = gh;
  }

  // GitHub directory (tree URL) → fetch full skill
  const treeInfo = parseGitHubTree(url);
  if (treeInfo) {
    const { owner, repo, branch, path } = treeInfo;

    // Fetch SKILL.md
    const skillMdText = await fetchRaw(owner, repo, branch, `${path}/SKILL.md`);
    const base = parseSkillMd(skillMdText, inputUrl);

    // List directory to find references/ and scripts/
    const entries = await listGitHubDir(owner, repo, branch, path);
    const hasScripts = entries.some(e => e.name === 'scripts' && e.type === 'dir');

    // Fetch all .md files in references/
    const refDir = entries.find(e => e.name === 'references' && e.type === 'dir');
    let refsPrompt = '';
    if (refDir) {
      const refFiles = await listGitHubDir(owner, repo, branch, `${path}/references`);
      const mdFiles = refFiles.filter(f => f.type === 'file' && f.name.endsWith('.md'));
      const contents = await Promise.all(
        mdFiles.map(f => fetchRaw(owner, repo, branch, f.path).catch(() => ''))
      );
      if (contents.some(c => c)) {
        refsPrompt = '\n\n## References\n\n' + contents.filter(Boolean).join('\n\n---\n\n');
      }
    }

    return { ...base, systemPrompt: base.systemPrompt + refsPrompt, hasScripts };
  }

  // GitHub blob → raw
  const rawUrl = url
    .replace(/github\.com\/([^/]+)\/([^/]+)\/blob\//, 'raw.githubusercontent.com/$1/$2/')
    .replace(/gitlab\.com\/([^/]+)\/([^/]+)\/-\/blob\/([^/]+)\//, 'gitlab.com/$1/$2/-/raw/$3/');

  const res = await fetch(rawUrl, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return { ...parseSkillMd(text, inputUrl), hasScripts: false };
}

export function loadCustomSkills(): Promise<CustomSkill[]> {
  return new Promise(resolve => {
    chrome.storage.sync.get(['customSkills'], r => resolve(r.customSkills || []));
  });
}

export function saveCustomSkills(skills: CustomSkill[]): Promise<void> {
  return new Promise(resolve => chrome.storage.sync.set({ customSkills: skills }, resolve));
}

export function loadDisabledSkills(): Promise<string[]> {
  return new Promise(resolve => {
    chrome.storage.sync.get(['disabledSkills'], r => resolve(r.disabledSkills || []));
  });
}

export function saveDisabledSkills(ids: string[]): Promise<void> {
  return new Promise(resolve => chrome.storage.sync.set({ disabledSkills: ids }, resolve));
}

export async function fetchSkills(agentServiceUrl: string): Promise<Skill[]> {
  try {
    const res = await fetch(`${agentServiceUrl}/skills`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function fetchModels(agentServiceUrl: string): Promise<PredefinedModel[]> {
  try {
    const res = await fetch(`${agentServiceUrl}/models`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function pushProviderConfig(
  agentServiceUrl: string,
  provider: string,
  apiKey: string,
  model?: string,
  baseUrl?: string,
  toolsSupported?: boolean,
  visionSupported?: boolean,
): Promise<boolean> {
  try {
    const res = await fetch(`${agentServiceUrl}/provider-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, apiKey, model, baseUrl, toolsSupported, visionSupported }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function pushSystemPrompt(agentServiceUrl: string, systemPrompt: string): Promise<boolean> {
  try {
    const res = await fetch(`${agentServiceUrl}/system-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemPrompt }),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface CustomMcpServer {
  id: string;
  name: string;
  enabled: boolean;
  // Standard MCP transport fields
  type: 'http' | 'streamable-http' | 'sse' | 'stdio';
  url?: string;                        // HTTP/SSE transports
  headers?: Record<string, string>;    // HTTP/SSE transports
  command?: string;                    // stdio transport
  args?: string[];                     // stdio transport
  env?: Record<string, string>;        // stdio transport
  description?: string;
}

/**
 * Parse a standard MCP server config block (from Cursor/Claude/etc.) into CustomMcpServer.
 * Accepts either a full mcpServers object {"name": {...}} or a single server object {type, url, ...}.
 */
export function parseMcpConfigJson(raw: string): Omit<CustomMcpServer, 'id' | 'enabled'>[] {
  const obj = JSON.parse(raw.trim());
  const entries: [string, Record<string, unknown>][] = [];

  // Detect format: {"name": {type, url, ...}} vs {type, url, ...}
  if (obj.type || obj.command || obj.url) {
    // Single server object without a key — use unnamed
    entries.push(['', obj]);
  } else if (typeof obj === 'object') {
    // Map of name → config (standard mcpServers format)
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === 'object' && val !== null) entries.push([key, val as Record<string, unknown>]);
    }
  }

  return entries.map(([name, cfg]) => {
    const type = (cfg.type as string) || (cfg.url ? 'http' : 'stdio');
    // Resolve headers: direct object or built from token/apiKey shortcuts
    let headers = (cfg.headers as Record<string, string> | undefined) ?? undefined;

    // Normalize `${input:xxx}` placeholders to a readable form
    if (headers) {
      headers = Object.fromEntries(
        Object.entries(headers).map(([k, v]) => [k, String(v)])
      );
    }

    return {
      name: name || (cfg.name as string) || '',
      description: (cfg.description as string) || undefined,
      type: (['http', 'streamable-http', 'sse', 'stdio'].includes(type) ? type : 'http') as CustomMcpServer['type'],
      url: (cfg.url as string) || undefined,
      headers,
      command: (cfg.command as string) || undefined,
      args: (cfg.args as string[]) || undefined,
      env: (cfg.env as Record<string, string>) || undefined,
    };
  });
}

export function loadCustomMcpServers(): Promise<CustomMcpServer[]> {
  return new Promise(resolve => chrome.storage.sync.get(['customMcpServers'], r => resolve(r.customMcpServers || [])));
}

export function saveCustomMcpServers(servers: CustomMcpServer[]): Promise<void> {
  return new Promise(resolve => chrome.storage.sync.set({ customMcpServers: servers }, resolve));
}

export async function testMcpServer(agentServiceUrl: string, mcpUrl: string, headers?: Record<string, string>): Promise<{ ok: boolean; status?: number; statusText?: string; error?: string; body?: string }> {
  try {
    const res = await fetch(`${agentServiceUrl}/test-mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: mcpUrl, headers }),
      signal: AbortSignal.timeout(8000),
    });
    return res.json();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function pushExternalMcpServers(agentServiceUrl: string, servers: CustomMcpServer[]): Promise<boolean> {
  try {
    const payload = servers.filter(s => s.enabled).map(s => ({
      id: s.id, name: s.name, enabled: true,
      type: s.type, url: s.url, headers: s.headers,
      command: s.command, args: s.args, env: s.env,
    }));
    const res = await fetch(`${agentServiceUrl}/external-mcp-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ servers: payload }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function pushNativeConfigToAgentService(
  agentServiceUrl: string,
  nativeServerUrl: string,
  authToken: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${agentServiceUrl}/native-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nativeServerUrl, authToken }),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

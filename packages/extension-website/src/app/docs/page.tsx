import type { Metadata } from 'next';
import { Diagram as MermaidDiagram } from '@/components/Diagram';

export const metadata: Metadata = {
  title: 'Docs — Browser Agent',
  description: 'Architecture, configuration, and usage docs for the Browser Agent Chrome extension.',
};

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-16 scroll-mt-20">
      <h2 className="text-2xl font-bold text-brand-strong mb-6 pb-3 border-b border-brand-border">{title}</h2>
      {children}
    </section>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h3 className="text-lg font-semibold text-brand-strong mb-3">{title}</h3>
      {children}
    </div>
  );
}

function EnvTable({ rows }: { rows: [string, string, string?][] }) {
  return (
    <div className="rounded-lg border border-brand-border overflow-hidden mb-4">
      <table className="w-full text-sm">
        <thead className="bg-brand-surface">
          <tr>
            <th className="text-left px-4 py-3 text-brand-strong font-medium">Variable</th>
            <th className="text-left px-4 py-3 text-brand-strong font-medium">Default</th>
            <th className="text-left px-4 py-3 text-brand-muted font-normal">Description</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-border">
          {rows.map(([k, v, d]) => (
            <tr key={k} className="bg-brand-bg">
              <td className="px-4 py-3 font-mono text-brand-accent text-xs">{k}</td>
              <td className="px-4 py-3 font-mono text-brand-muted text-xs">{v}</td>
              <td className="px-4 py-3 text-brand-muted text-xs">{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CodeBlock({ code, lang = '' }: { code: string; lang?: string }) {
  return (
    <pre className="rounded-lg bg-brand-surface border border-brand-border p-4 text-sm font-mono text-brand-success overflow-x-auto whitespace-pre">
      {code}
    </pre>
  );
}

const toc = [
  { id: 'architecture', label: 'Architecture' },
  { id: 'how-it-works', label: 'How it works' },
  { id: 'native-server', label: 'Native Server' },
  { id: 'agent-service', label: 'Agent Service' },
  { id: 'extension-config', label: 'Extension Config' },
  { id: 'mcp-clients', label: 'Connect MCP Clients' },
  { id: 'mcp-tools', label: 'MCP Tools Reference' },
  { id: 'faq', label: 'FAQ' },
];

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-16 flex gap-12">
      {/* Sidebar TOC */}
      <aside className="hidden lg:block w-52 shrink-0">
        <div className="sticky top-20">
          <p className="text-xs font-semibold text-brand-muted uppercase tracking-wider mb-3">On this page</p>
          <ul className="space-y-2">
            {toc.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`} className="text-sm text-brand-muted hover:text-white transition-colors">
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-brand-strong mb-4">Documentation</h1>
          <p className="text-brand-muted text-lg">
            How Browser Agent works, how to configure it, and how to connect MCP clients like Cursor and Claude Desktop.
          </p>
        </div>

        {/* ── Architecture ── */}
        <Section id="architecture" title="Architecture">
          <p className="text-brand-muted text-sm mb-6">
            Browser Agent is a three-component system. Each component has a single clear responsibility.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {[
              {
                name: 'Chrome Extension',
                badge: 'MV3',
                color: 'text-brand-accent',
                items: [
                  'Side panel chat UI',
                  'Executes ~75 browser tools',
                  'Long-polls native-server for tool requests',
                  'Options page: settings & token management',
                ],
              },
              {
                name: 'native-server',
                badge: 'MCP Gateway',
                color: 'text-brand-success',
                items: [
                  'MCP Streamable HTTP server',
                  'Queues & relays tool calls to the extension',
                  'Serves agent-service AND external MCP clients',
                  'Bearer token auth, dynamic token management',
                ],
              },
              {
                name: 'agent-service',
                badge: 'LLM Orchestrator',
                color: 'text-yellow-400',
                items: [
                  'Receives chat from extension side panel',
                  'MCP client → calls tools via native-server',
                  'Short-term memory (in-memory)',
                  'Long-term memory (SQLite + FTS5 + vectors)',
                ],
              },
            ].map((s) => (
              <div key={s.name} className="rounded-xl border border-brand-border bg-brand-surface p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`font-bold text-sm ${s.color}`}>{s.name}</span>
                  <span className="text-xs text-brand-muted border border-brand-border rounded px-1.5 py-0.5">{s.badge}</span>
                </div>
                <ul className="space-y-1.5">
                  {s.items.map((item) => (
                    <li key={item} className="text-xs text-brand-muted flex gap-2">
                      <span className="text-brand-border shrink-0">·</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <MermaidDiagram
            caption="System components and their connections"
            chart={`graph TB
  subgraph ext_g["🧩 Chrome Extension (MV3)"]
    UI["Side Panel · Chat UI"]
    BG["Background Worker · ~75 browser tools"]
    OPT["Options Page · Settings & Tokens"]
  end

  subgraph agent_g["⚙️ Agent Service"]
    CHAT["POST /chat · Streaming"]
    LLM["LLM Orchestrator\\nAnthropic · OpenAI · OpenAI-compat"]
    MEM["Memory\\nShort-term + SQLite long-term"]
  end

  subgraph gw_g["🔀 Native Server — MCP Gateway"]
    MCP["MCP Streamable HTTP\\nPOST · GET · DELETE /mcp"]
    QUEUE["Relay Queue · long-poll 25s"]
    TOKENS["Token Management\\nGET · POST · DELETE /tokens"]
  end

  subgraph client_g["🖥️ MCP Clients"]
    CURSOR["Cursor IDE"]
    CLAUDE["Claude Desktop"]
  end

  UI -->|"POST /chat"| CHAT
  CHAT --> LLM
  LLM --> MEM
  LLM -->|"MCP tools/call"| MCP
  MCP -->|"queue request"| QUEUE
  QUEUE <-->|"long-poll / respond"| BG
  OPT -->|"create token"| TOKENS
  CURSOR -->|"Bearer token"| MCP
  CLAUDE -->|"Bearer token"| MCP`}
          />
        </Section>

        {/* ── How it works ── */}
        <Section id="how-it-works" title="How it works">
          <SubSection title="Chat flow (Extension side panel)">
            <p className="text-brand-muted text-sm mb-5">
              When a user sends a message in the extension side panel, the following chain happens:
            </p>

            <MermaidDiagram
              caption="End-to-end chat flow — from user message to streamed response"
              chart={`sequenceDiagram
  participant U as User
  participant SP as Side Panel
  participant AS as Agent Service
  participant NS as Native Server
  participant EX as Extension BG

  U->>SP: types a message
  SP->>AS: POST /chat (history + enabled tools)
  AS->>AS: LLM reasons, plans tool calls
  AS->>NS: POST /mcp tools/call
  NS->>EX: queue response (GET /provider/queue)
  EX->>EX: executes Chrome API
  EX->>NS: POST /provider/respond result
  NS-->>AS: MCP tool result
  AS->>AS: LLM continues reasoning
  AS-->>SP: stream text tokens (Vercel AI protocol)
  SP-->>U: renders response in real time`}
            />

            <ol className="space-y-4 mt-6">
              {[
                {
                  step: '1',
                  title: 'User sends a message',
                  desc: 'Side panel → POST /chat → agent-service. The request includes conversation history and the enabled tool list.',
                },
                {
                  step: '2',
                  title: 'agent-service calls the LLM',
                  desc: 'The LLM reasons about the request and decides to call one or more browser tools.',
                },
                {
                  step: '3',
                  title: 'agent-service calls the tool via MCP',
                  desc: 'POST /mcp (tools/call) → native-server. This is a standard MCP Streamable HTTP request with a Bearer token.',
                },
                {
                  step: '4',
                  title: 'native-server queues the request for the extension',
                  desc: 'The extension background worker long-polls GET /provider/queue (25 s timeout). When a tool call arrives, it dequeues it.',
                },
                {
                  step: '5',
                  title: 'Extension executes the browser tool',
                  desc: 'The background service worker calls the actual Chrome APIs (tabs, scripting, history, bookmarks, etc.) and posts the result to POST /provider/respond/{requestId}.',
                },
                {
                  step: '6',
                  title: 'Result flows back to the LLM',
                  desc: 'native-server resolves the pending MCP response → agent-service feeds the tool result back to the LLM → next reasoning step.',
                },
                {
                  step: '7',
                  title: 'Streaming text back to the user',
                  desc: 'agent-service streams text tokens back to the side panel using the Vercel AI SDK data stream protocol. Tool call blocks and text appear in real time.',
                },
              ].map((s) => (
                <li key={s.step} className="flex gap-4">
                  <div className="shrink-0 w-7 h-7 rounded-full bg-brand-accent/10 border border-brand-accent/30 flex items-center justify-center text-brand-accent text-xs font-bold">
                    {s.step}
                  </div>
                  <div>
                    <p className="text-brand-strong text-sm font-medium">{s.title}</p>
                    <p className="text-brand-muted text-xs mt-0.5">{s.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </SubSection>

          <SubSection title="External MCP client flow (Cursor, Claude Desktop…)">
            <p className="text-brand-muted text-sm mb-4">
              External clients connect directly to native-server, bypassing agent-service entirely.
              native-server still relays tool calls to the extension the same way.
            </p>
            <MermaidDiagram
              caption="Cursor / Claude Desktop connect directly to native-server via MCP Streamable HTTP"
              chart={`sequenceDiagram
  participant C as Cursor / Claude Desktop
  participant N as Native Server
  participant E as Browser Extension

  C->>N: POST /mcp initialize (Bearer token)
  N-->>C: 200 OK + mcp-session-id

  C->>N: POST /mcp tools/list
  N-->>C: list of ~75 browser tools

  C->>N: POST /mcp tools/call browser_navigate_to
  N->>E: queues request (GET /provider/queue response)
  E->>E: executes Chrome API
  E->>N: POST /provider/respond/{id} {result}
  N-->>C: MCP tool result`}
            />
          </SubSection>
        </Section>

        {/* ── Native Server ── */}
        <Section id="native-server" title="Native Server">
          <p className="text-brand-muted text-sm mb-6">
            native-server is a single Node.js file (~700 lines) that acts as the MCP gateway. It has no database — state is in-memory with a 10-minute idle session timeout.
          </p>

          <SubSection title="Running locally">
            <CodeBlock code={`cd packages/native-server
cp .env.example .env   # set AUTH_TOKEN and PORT
node server.js`} />
          </SubSection>

          <SubSection title="Environment variables">
            <EnvTable rows={[
              ['PORT', '8080', 'Port to listen on'],
              ['AUTH_TOKEN', '—', 'Single static bearer token (required if AUTH_TOKENS not set)'],
              ['AUTH_TOKENS', '—', 'Comma-separated list of tokens (supports multiple clients)'],
              ['ALLOW_NO_AUTH', 'false', 'Skip auth for local dev — never use in production'],
            ]} />
          </SubSection>

          <SubSection title="API endpoints">
            <div className="rounded-lg border border-brand-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-brand-surface">
                  <tr>
                    <th className="text-left px-4 py-3 text-brand-strong font-medium">Method + Path</th>
                    <th className="text-left px-4 py-3 text-brand-muted font-normal">Purpose</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-border">
                  {[
                    ['POST /mcp', 'MCP Streamable HTTP — initialize session, call tools, list tools'],
                    ['GET /mcp', 'SSE stream — push notifications/tools/list_changed to MCP client'],
                    ['DELETE /mcp', 'Close MCP session'],
                    ['POST /provider/register', 'Extension registers its tool list on startup'],
                    ['GET /provider/queue', 'Extension long-polls for pending tool calls (25 s timeout)'],
                    ['POST /provider/respond/{id}', 'Extension posts tool call result'],
                    ['GET /tokens', 'List dynamic tokens (admin only)'],
                    ['POST /tokens', 'Create a new dynamic token (admin only)'],
                    ['DELETE /tokens/{id}', 'Revoke a dynamic token (admin only)'],
                    ['GET /health', 'Health check — returns extension connection status'],
                  ].map(([path, desc]) => (
                    <tr key={path} className="bg-brand-bg">
                      <td className="px-4 py-2.5 font-mono text-brand-accent">{path}</td>
                      <td className="px-4 py-2.5 text-brand-muted">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SubSection>
        </Section>

        {/* ── Agent Service ── */}
        <Section id="agent-service" title="Agent Service">
          <p className="text-brand-muted text-sm mb-6">
            agent-service orchestrates the LLM conversation loop. It connects to native-server as an MCP client, and streams responses back to the extension using the Vercel AI SDK data stream protocol.
          </p>

          <SubSection title="Running locally">
            <CodeBlock code={`cd packages/agent-service
cp .env.example .env   # set PROVIDER and API key
node server.js`} />
          </SubSection>

          <SubSection title="Environment variables">
            <EnvTable rows={[
              ['PORT', '3000 (local) / 8080 (AgentBase)', 'Must be 8080 when deployed to AgentBase'],
              ['PROVIDER', '—', 'anthropic | openai | openai-compat'],
              ['ANTHROPIC_API_KEY', '—', 'Required when PROVIDER=anthropic'],
              ['OPENAI_API_KEY', '—', 'Required when PROVIDER=openai'],
              ['CUSTOM_BASE_URL', '—', 'Base URL for openai-compat (VNGCloud AIP, OpenRouter, etc.)'],
              ['CUSTOM_API_KEY', '—', 'API key for custom provider'],
              ['CUSTOM_MODEL', '—', 'Model ID for custom provider'],
              ['MCP_SERVER_URL', 'http://localhost:8080', 'URL of native-server'],
              ['MCP_AUTH_TOKEN', '—', 'Bearer token for native-server'],
            ]} />
            <p className="text-xs text-brand-muted mt-2">
              Provider settings can also be configured at runtime via the extension Options page — no restart needed.
            </p>
          </SubSection>

          <SubSection title="LLM providers supported">
            <div className="rounded-lg border border-brand-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-brand-surface">
                  <tr>
                    <th className="text-left px-4 py-3 text-brand-strong font-medium">PROVIDER</th>
                    <th className="text-left px-4 py-3 text-brand-strong font-medium">Tool Calling</th>
                    <th className="text-left px-4 py-3 text-brand-strong font-medium">Vision</th>
                    <th className="text-left px-4 py-3 text-brand-muted font-normal">Examples</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-border">
                  {[
                    ['anthropic', '✓ Always', '✓ Always', 'claude-3-5-sonnet, claude-3-haiku'],
                    ['openai', '✓ Always', '✓ Always', 'gpt-4o, gpt-4o-mini'],
                    ['openai-compat', 'Opt-in toggle', 'Opt-in toggle', 'VNGCloud AIP (Qwen, Gemini, Deepseek), OpenRouter'],
                  ].map(([p, t, v, ex]) => (
                    <tr key={p} className="bg-brand-bg">
                      <td className="px-4 py-2.5 font-mono text-brand-accent">{p}</td>
                      <td className="px-4 py-2.5 text-brand-muted">{t}</td>
                      <td className="px-4 py-2.5 text-brand-muted">{v}</td>
                      <td className="px-4 py-2.5 text-brand-muted">{ex}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SubSection>
        </Section>

        {/* ── Extension Config ── */}
        <Section id="extension-config" title="Extension Configuration">
          <SubSection title="First-run setup">
            <p className="text-brand-muted text-sm mb-4">
              On first open, the extension shows a setup wizard. Fill in:
            </p>
            <ol className="space-y-2 text-sm text-brand-muted list-decimal list-inside">
              <li><span className="text-brand-strong font-medium">Native Server URL</span> — e.g. <code>http://localhost:8080</code> or the AgentBase endpoint URL</li>
              <li><span className="text-brand-strong font-medium">Auth Token</span> — must match <code>AUTH_TOKEN</code> in native-server&apos;s <code>.env</code></li>
              <li><span className="text-brand-strong font-medium">LLM Provider</span> — choose Anthropic, OpenAI, or any OpenAI-compatible endpoint</li>
            </ol>
          </SubSection>

          <SubSection title="Options page tabs">
            <div className="grid grid-cols-2 gap-3">
              {[
                { tab: 'General', desc: 'Native server URL + auth token. Shows connection status badge.' },
                { tab: 'Provider', desc: 'LLM provider, model, API key. Change at any time without reloading.' },
                { tab: 'Skills', desc: 'Enable/disable built-in agent skills and custom user skills.' },
                { tab: 'MCP', desc: 'Add external MCP servers the agent can use (paste Cursor/Claude JSON config).' },
                { tab: 'Memory', desc: 'View and manage long-term memories stored by the agent.' },
                { tab: 'Security', desc: 'Create and revoke MCP client tokens for Cursor, Claude Desktop, ChatGPT, etc.' },
              ].map((t) => (
                <div key={t.tab} className="rounded-lg border border-brand-border bg-brand-surface p-4">
                  <p className="font-medium text-brand-strong text-sm mb-1">{t.tab}</p>
                  <p className="text-xs text-brand-muted">{t.desc}</p>
                </div>
              ))}
            </div>
          </SubSection>

          {/* Options screenshot placeholder */}
          <div className="rounded-xl border-2 border-dashed border-brand-border bg-brand-surface/50 h-52 flex flex-col items-center justify-center gap-2 text-brand-muted mt-4">
            <span className="text-3xl">📸</span>
            <p className="text-sm font-medium">[ Screenshot: Options page — Security tab ]</p>
            <p className="text-xs opacity-60">Save as: public/screenshots/options-security.png</p>
          </div>
        </Section>

        {/* ── Connect MCP Clients ── */}
        <Section id="mcp-clients" title="Connect MCP Clients (Cursor, Claude Desktop…)">
          <p className="text-brand-muted text-sm mb-6">
            native-server exposes a standard MCP Streamable HTTP endpoint. Any MCP-compatible client —
            Cursor, Claude Desktop, ChatGPT, or custom tools — can connect to it and use all browser tools.
            Each client gets its own token.
          </p>

          <MermaidDiagram
            caption="Token-based auth flow: extension creates token → client uses it to connect"
            chart={`flowchart LR
  subgraph ext_g["🧩 Chrome Extension"]
    SEC["Security Tab\\nOptions Page"]
  end
  subgraph ns_g["🔀 Native Server"]
    TK["POST /tokens\\ncreate token"]
    MCP2["POST /mcp\\nauth check"]
  end
  subgraph cl_g["🖥️ MCP Client"]
    CUR["Cursor / Claude\\nDesktop / ChatGPT"]
  end

  SEC -->|"CREATE_TOKEN"| TK
  TK -->|"token shown once ⚠️"| SEC
  SEC -->|"user copies & pastes"| CUR
  CUR -->|"Bearer token"| MCP2`}
          />

          <SubSection title="Step 1 — Create a token in the extension">
            <ol className="space-y-3 text-sm text-brand-muted mb-4">
              <li className="flex gap-3">
                <span className="text-brand-accent font-bold shrink-0">1.</span>
                Open the extension side panel → click the gear icon → <strong className="text-brand-strong">Options</strong>
              </li>
              <li className="flex gap-3">
                <span className="text-brand-accent font-bold shrink-0">2.</span>
                Go to the <strong className="text-brand-strong">Security</strong> tab
              </li>
              <li className="flex gap-3">
                <span className="text-brand-accent font-bold shrink-0">3.</span>
                Click <strong className="text-brand-strong">+ New Token</strong>. Choose the preset that matches your client (Cursor / Claude / ChatGPT), or enter a custom name.
              </li>
              <li className="flex gap-3">
                <span className="text-brand-accent font-bold shrink-0">4.</span>
                Click <strong className="text-brand-strong">Create</strong>. The full token value is shown <span className="text-yellow-400">only once</span> — copy it immediately.
              </li>
            </ol>

            {/* Security tab screenshot placeholder */}
            <div className="rounded-xl border-2 border-dashed border-brand-border bg-brand-surface/50 aspect-video flex flex-col items-center justify-center gap-2 text-brand-muted">
              <span className="text-3xl">📸</span>
              <p className="text-sm font-medium">[ Screenshot: Security tab — token creation + copy UI ]</p>
              <p className="text-xs opacity-60">Save as: public/screenshots/security-new-token.png</p>
            </div>
          </SubSection>

          <SubSection title="Step 2 — Configure your MCP client">

            <div className="space-y-6">
              {/* Cursor */}
              <div>
                <p className="text-brand-strong font-medium text-sm mb-2">Cursor</p>
                <p className="text-brand-muted text-xs mb-3">
                  Open Cursor Settings → MCP → Add server, or edit <code>~/.cursor/mcp.json</code> / the project <code>.cursor/mcp.json</code>:
                </p>
                <CodeBlock code={`{
  "mcpServers": {
    "browser-agent": {
      "type": "http",
      "url": "http://127.0.0.1:8080/mcp",
      "headers": {
        "Authorization": "Bearer <your-token>"
      }
    }
  }
}`} />
                <p className="text-xs text-brand-muted mt-2">
                  The extension auto-generates this snippet after token creation — just copy and paste it.
                </p>
              </div>

              {/* Claude Desktop */}
              <div>
                <p className="text-brand-strong font-medium text-sm mb-2">Claude Desktop</p>
                <p className="text-brand-muted text-xs mb-3">
                  Edit <code>~/Library/Application Support/Claude/claude_desktop_config.json</code> (macOS):
                </p>
                <CodeBlock code={`{
  "mcpServers": {
    "browser-agent": {
      "type": "http",
      "url": "http://127.0.0.1:8080/mcp",
      "headers": {
        "Authorization": "Bearer <your-token>"
      }
    }
  }
}`} />
              </div>

              {/* Remote native-server */}
              <div className="rounded-lg border border-brand-border bg-brand-surface/50 p-4">
                <p className="text-brand-strong font-medium text-sm mb-2">Using the cloud (AgentBase) endpoint</p>
                <p className="text-brand-muted text-xs mb-3">
                  If native-server is deployed to AgentBase, replace <code>http://127.0.0.1:8080</code> with the AgentBase endpoint URL:
                </p>
                <CodeBlock code={`"url": "https://endpoint-<id>.agentbase-runtime.aiplatform.vngcloud.vn/mcp"`} />
                <p className="text-xs text-brand-muted mt-2">
                  The token-based auth works identically for local and cloud deployments.
                </p>
              </div>
            </div>
          </SubSection>

          <SubSection title="Verify the connection">
            <p className="text-brand-muted text-xs mb-3">Test the MCP handshake with curl:</p>
            <CodeBlock code={`# Initialize session
curl -X POST http://localhost:8080/mcp \\
  -H "Authorization: Bearer <your-token>" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","clientInfo":{"name":"test","version":"1.0"}},"id":1}'

# Save mcp-session-id from response header, then list tools:
curl -X POST http://localhost:8080/mcp \\
  -H "Authorization: Bearer <your-token>" \\
  -H "Content-Type: application/json" \\
  -H "mcp-session-id: <session-id>" \\
  -d '{"jsonrpc":"2.0","method":"tools/list","id":2}'`} />
          </SubSection>
        </Section>

        {/* ── MCP Tools Reference ── */}
        <Section id="mcp-tools" title="MCP Tools Reference">
          <p className="text-brand-muted text-sm mb-6">
            The extension exposes ~75 browser tools. Below are the key categories. Tools can be individually enabled/disabled in the side panel (click the Tools icon).
          </p>
          <div className="space-y-4">
            {[
              {
                category: 'Navigation',
                tools: ['browser_navigate_to', 'browser_go_back', 'browser_go_forward', 'browser_reload'],
              },
              {
                category: 'Page Interaction',
                tools: ['browser_click', 'browser_fill_input', 'browser_take_screenshot', 'browser_get_page_text', 'browser_get_html', 'browser_scroll', 'browser_hover'],
              },
              {
                category: 'Tabs',
                tools: ['browser_tabs_list', 'browser_tabs_create', 'browser_tabs_close', 'browser_tabs_switch', 'browser_tab_groups_*'],
              },
              {
                category: 'Storage & Data',
                tools: ['browser_history_search', 'browser_bookmarks_get', 'browser_bookmarks_create', 'browser_downloads_list', 'browser_cookies_get (off by default)'],
              },
              {
                category: 'Advanced',
                tools: ['browser_execute_script (off by default)', 'browser_sessions_*', 'browser_top_sites', 'browser_notifications_create', 'browser_clipboard_*'],
              },
            ].map((group) => (
              <div key={group.category} className="rounded-lg border border-brand-border bg-brand-surface p-5">
                <p className="font-semibold text-brand-strong text-sm mb-3">{group.category}</p>
                <div className="flex flex-wrap gap-2">
                  {group.tools.map((t) => (
                    <code key={t} className="text-xs bg-brand-bg border border-brand-border rounded px-2 py-1 text-brand-accent">{t}</code>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-brand-muted mt-4">
            Tools marked <em>off by default</em> are disabled for safety. Enable them individually in the Tools panel of the side panel.
          </p>
        </Section>

        {/* ── FAQ ── */}
        <Section id="faq" title="FAQ">
          <div className="space-y-4">
            {[
              {
                q: 'Can I use any LLM model?',
                a: 'Yes. Set PROVIDER=openai-compat with any OpenAI-compatible base URL (OpenRouter, VNGCloud AIP, etc.). Enable the "tool calling" toggle if the model supports function calling.',
              },
              {
                q: 'Does it work with HTTPS pages?',
                a: 'Yes. The extension has host_permissions: <all_urls> and operates on all pages including HTTPS.',
              },
              {
                q: 'Can multiple MCP clients connect at the same time?',
                a: 'Yes. Each MCP client has its own session (10-minute idle timeout). Tool calls from different clients are queued and relayed to the extension independently.',
              },
              {
                q: 'How do I update the extension?',
                a: 'Download the new .zip from GitHub Releases, extract it to the same folder (overwrite), then go to chrome://extensions/ and click the reload icon on Browser Agent.',
              },
              {
                q: 'The agent cannot call tools after Chrome has been idle for a while.',
                a: 'Chrome suspends background service workers after ~30 seconds of inactivity. Click any tab to wake the extension, then retry. This is a Chrome MV3 limitation.',
              },
              {
                q: 'Tool calls fail with openai-compat provider.',
                a: 'Go to Options → Provider → enable "Supports function/tool calling". This is required for models that support tool calling through an OpenAI-compatible endpoint.',
              },
              {
                q: 'Is my browser data sent to any external service?',
                a: 'Only if your LLM provider is external (Anthropic, OpenAI, etc.). Page content and screenshots are sent to the LLM as part of the conversation context. The native-server and agent-service themselves do not store this data.',
              },
            ].map((item) => (
              <div key={item.q} className="rounded-lg border border-brand-border bg-brand-surface p-5">
                <p className="font-medium text-brand-strong mb-2 text-sm">Q: {item.q}</p>
                <p className="text-sm text-brand-muted">A: {item.a}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

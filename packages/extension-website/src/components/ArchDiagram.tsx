'use client';

import { useTheme } from './ThemeProvider';

type Color = 'accent' | 'success' | 'yellow' | 'purple' | 'muted';

function palette(isDark: boolean) {
  const alpha = (hex: string, a: number) => hex + Math.round(a * 255).toString(16).padStart(2, '0');
  return isDark ? {
    accent:  { hex: '#6B7FFF', bg: alpha('#6B7FFF', 0.08), border: alpha('#6B7FFF', 0.4),  glow: alpha('#6B7FFF', 0.2) },
    success: { hex: '#00E5A0', bg: alpha('#00E5A0', 0.08), border: alpha('#00E5A0', 0.4),  glow: alpha('#00E5A0', 0.2) },
    yellow:  { hex: '#f59e0b', bg: alpha('#f59e0b', 0.08), border: alpha('#f59e0b', 0.4),  glow: alpha('#f59e0b', 0.2) },
    purple:  { hex: '#a855f7', bg: alpha('#a855f7', 0.08), border: alpha('#a855f7', 0.4),  glow: alpha('#a855f7', 0.2) },
    muted:   { hex: '#9899b5', bg: 'rgba(34,35,58,0.6)',   border: 'rgba(46,47,74,0.8)',   glow: 'transparent' },
    bg:        '#14152a',
    border:    '#2e2f4a',
    labelBg:   '#191929',
    labelText: '#9899b5',
    caption:   'rgba(152,153,181,0.5)',
  } : {
    accent:  { hex: '#4f5fe8', bg: '#eef0ff',              border: '#c0c7f5',             glow: 'rgba(79,95,232,0.12)' },
    success: { hex: '#00996a', bg: '#e6fff5',              border: '#99e8cc',             glow: 'rgba(0,153,106,0.12)' },
    yellow:  { hex: '#b45309', bg: '#fef9ee',              border: '#fcd68a',             glow: 'rgba(180,83,9,0.10)'  },
    purple:  { hex: '#7c3aed', bg: '#f5f0ff',              border: '#c4a8f5',             glow: 'rgba(124,58,237,0.12)' },
    muted:   { hex: '#6b6d8a', bg: '#f4f5ff',              border: '#d4d7f0',             glow: 'transparent' },
    bg:        '#f0f1fc',
    border:    '#d4d7f0',
    labelBg:   '#eef0ff',
    labelText: '#6b6d8a',
    caption:   'rgba(107,109,138,0.6)',
  };
}

function Tag({ text, color, C }: { text: string; color: Color; C: ReturnType<typeof palette> }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
      color: C[color].hex, background: C[color].bg,
      border: `1px solid ${C[color].border}`,
      borderRadius: 4, padding: '2px 6px',
    }}>
      {text}
    </span>
  );
}

function Item({ label, sub, color, C }: { label: string; sub?: string; color: Color; C: ReturnType<typeof palette> }) {
  return (
    <div style={{
      background: C[color].bg,
      border: `1px solid ${C[color].border}`,
      borderRadius: 8, padding: '8px 12px', textAlign: 'center',
      boxShadow: `0 0 10px ${C[color].glow}`,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: C[color].hex }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: C.muted.hex, marginTop: 2, lineHeight: 1.4 }}>{sub}</div>}
    </div>
  );
}

function Group({ emoji, title, color, children, C }: {
  emoji: string; title: string; color: Color; children: React.ReactNode; C: ReturnType<typeof palette>;
}) {
  return (
    <div style={{
      background: C[color].bg,
      border: `1px solid ${C[color].border}`,
      borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 8,
      boxShadow: `0 0 24px ${C[color].glow}`,
      flex: 1, minWidth: 160,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <span style={{ fontSize: 14 }}>{emoji}</span>
        <Tag text={title} color={color} C={C} />
      </div>
      {children}
    </div>
  );
}

function HArrow({ label, color, dashed, C }: { label: string; color: Color; dashed?: boolean; C: ReturnType<typeof palette> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, paddingTop: 28, flexShrink: 0 }}>
      <span style={{ fontSize: 9, color: C.labelText, background: C.labelBg, border: `1px solid ${C.border}`, borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <svg width="40" height="14" viewBox="0 0 40 14" fill="none">
        <line x1="0" y1="7" x2="33" y2="7" stroke={C[color].hex} strokeWidth="1.5" strokeDasharray={dashed ? '4 3' : undefined} />
        <path d="M31 3 L37 7 L31 11" stroke={C[color].hex} strokeWidth="1.5" fill="none" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function VArrow({ label, color, twoWay, C }: { label: string; color: Color; twoWay?: boolean; C: ReturnType<typeof palette> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      {twoWay && (
        <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
          <path d="M2 6 L6 0 L10 6" stroke={C[color].hex} strokeWidth="1.5" fill="none" strokeLinejoin="round" />
        </svg>
      )}
      <svg width="14" height="32" viewBox="0 0 14 32" fill="none">
        <line x1="7" y1="0" x2="7" y2="28" stroke={C[color].hex} strokeWidth="1.5" strokeDasharray={twoWay ? '4 3' : undefined} />
        <path d="M3 26 L7 32 L11 26" stroke={C[color].hex} strokeWidth="1.5" fill="none" strokeLinejoin="round" />
      </svg>
      <span style={{ fontSize: 9, color: C.labelText, background: C.labelBg, border: `1px solid ${C.border}`, borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap', textAlign: 'center', maxWidth: 100 }}>
        {label}
      </span>
    </div>
  );
}

export function ArchDiagram() {
  const { resolvedTheme } = useTheme();
  const C = palette(resolvedTheme === 'dark');

  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24, overflow: 'auto', transition: 'background 0.2s, border-color 0.2s' }}>
      <div style={{ minWidth: 680 }}>

        {/* ── Row 0: Open Websites → Extension (highlight) ── */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 4 }}>
          <Group emoji="🌐" title="Open Website" color="purple" C={C}>
            <Item label="WebMCP Polyfill" sub="navigator.modelContext" color="purple" C={C} />
            <Item label="Custom Tools" sub="registerTool() — any domain logic" color="purple" C={C} />
          </Group>

          <HArrow label="tools via WebMCP" color="purple" C={C} />

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingTop: 28 }}>
            <div style={{
              background: C.purple.bg, border: `1px dashed ${C.purple.border}`,
              borderRadius: 8, padding: '8px 14px', fontSize: 10, color: C.purple.hex, lineHeight: 1.6,
            }}>
              Extension background worker reads tools from every open tab.<br />
              Website tools appear alongside built-in browser tools in every request.
            </div>
          </div>
        </div>

        {/* ── vertical arrow down to extension ── */}
        <div style={{ display: 'flex', paddingLeft: 20, marginBottom: 4 }}>
          <VArrow label="injected into agent context" color="purple" C={C} />
        </div>

        {/* ── Row 1: Extension → Agent Service → Native Server ── */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>

          <Group emoji="🧩" title="Chrome Extension" color="accent" C={C}>
            <Item label="Side Panel" sub="Chat UI" color="accent" C={C} />
            <Item label="Background Worker" sub="~75 browser tools + website tools" color="accent" C={C} />
            <Item label="Options Page" sub="Settings & Tokens" color="muted" C={C} />
          </Group>

          <HArrow label="POST /chat" color="yellow" C={C} />

          <Group emoji="⚙️" title="Agent Service" color="yellow" C={C}>
            <Item label="LLM Orchestrator" sub="Anthropic · OpenAI · OpenAI-compat" color="yellow" C={C} />
            <Item label="Memory" sub="Short-term + SQLite long-term" color="yellow" C={C} />
          </Group>

          <HArrow label="MCP tools/call" color="success" C={C} />

          <Group emoji="🔀" title="Native Server" color="success" C={C}>
            <Item label="MCP Streamable HTTP" sub="POST · GET · DELETE /mcp" color="success" C={C} />
            <Item label="Relay Queue" sub="long-poll 25 s timeout" color="success" C={C} />
            <Item label="Token Management" sub="GET · POST · DELETE /tokens" color="muted" C={C} />
          </Group>

        </div>

        {/* ── Row 2: vertical arrows ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 20px' }}>
          <div style={{ width: '33%', display: 'flex', justifyContent: 'center' }} />
          <div style={{ width: '33%' }} />
          <div style={{ width: '33%', display: 'flex', justifyContent: 'center', paddingTop: 4 }}>
            <VArrow label="long-poll / respond" color="success" twoWay C={C} />
          </div>
        </div>

        {/* ── Row 3: MCP Clients at bottom right ── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <Group emoji="🖥️" title="MCP Clients" color="muted" C={C}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Item label="Cursor IDE" color="muted" C={C} />
              <Item label="Claude Desktop" color="muted" C={C} />
              <Item label="Any MCP client" color="muted" C={C} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: 9, color: C.labelText }}>↑ Bearer token → /mcp endpoint</span>
            </div>
          </Group>
        </div>

      </div>

      <p style={{ textAlign: 'center', fontSize: 10, color: C.caption, marginTop: 16, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
        Websites expose tools via WebMCP · Extension merges them with ~75 built-in tools · MCP clients connect without agent-service
      </p>
    </div>
  );
}

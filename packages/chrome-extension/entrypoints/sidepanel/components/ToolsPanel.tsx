import React, { useEffect, useRef, useState } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

type RiskLevel = 'critical' | 'high' | 'low';

interface ToolDef {
  name: string;           // prefixed/canonical name used as key
  displayName?: string;   // short name to show in UI
  description?: string;
  inputSchema?: { properties?: Record<string, any>; required?: string[] };
  enabled: boolean;
  risk?: RiskLevel;
}

interface BrowserGroup {
  id: string;
  type: 'browser';
  label: string;
  status: 'active';
  toolCount: number;
  tools: ToolDef[];
}

interface WebsiteGroup {
  id: string;
  type: 'website';
  label: string;
  status: 'active' | 'connected';
  tabId: number;
  url: string;
  toolCount: number;
  tools: (ToolDef & { originalName: string })[];
}

type ToolGroup = BrowserGroup | WebsiteGroup;

interface AllToolsResponse {
  success: boolean;
  groups: ToolGroup[];
  providerRunning: boolean;
  totalTools: number;
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  active:    { label: 'Active',    color: '#22c55e' },
  connected: { label: 'Open Tab', color: '#3b82f6' },
};

const BROWSER_CATEGORY_ICONS: Record<string, string> = {
  Tabs: '🗂', Navigation: '🧭', Interaction: '🖱',
  Page: '📄', Scripting: '⚡', Media: '📷',
};

const callTool = (toolName: string, args: Record<string, unknown>): Promise<unknown> =>
  new Promise((resolve) =>
    chrome.runtime.sendMessage({ type: 'CALL_TOOL', toolName, arguments: args }, resolve)
  );

const toggleTool = (toolName: string, enabled: boolean): Promise<void> =>
  new Promise((resolve) =>
    chrome.runtime.sendMessage({ type: 'TOGGLE_TOOL', toolName, enabled }, () => resolve())
  );

const loadAllTools = (): Promise<AllToolsResponse> =>
  new Promise((resolve) =>
    chrome.runtime.sendMessage({ type: 'GET_ALL_TOOLS' }, (r) =>
      resolve(r as AllToolsResponse || { success: false, groups: [], providerRunning: false, totalTools: 0, error: 'No response' })
    )
  );

// ─── Risk badge ───────────────────────────────────────────────────────────────

const RISK_META: Record<RiskLevel, { label: string; color: string; title: string }> = {
  critical: { label: '🔴', color: '#ef4444', title: 'Critical risk — disabled by default. Can execute arbitrary code or exfiltrate auth/session data.' },
  high:     { label: '🟠', color: '#f97316', title: 'High risk — disabled by default. Exposes sensitive private data or causes irreversible changes.' },
  low:      { label: '🟢', color: '#22c55e', title: 'Low risk — enabled by default.' },
};

function RiskBadge({ risk }: { risk: RiskLevel }) {
  const m = RISK_META[risk];
  return (
    <span title={m.title} style={{ fontSize: 10, cursor: 'help' }}>
      {m.label}
    </span>
  );
}

// ─── Toggle switch ────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onChange(!checked); }}
      style={{
        flexShrink: 0, width: 30, height: 16, borderRadius: 8, border: 'none', cursor: disabled ? 'default' : 'pointer',
        background: checked ? '#2563eb' : '#334155', position: 'relative', transition: 'background 0.15s', padding: 0,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: checked ? 16 : 2, width: 12, height: 12,
        borderRadius: '50%', background: '#fff', transition: 'left 0.15s',
      }} />
    </button>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const b = STATUS_BADGE[status] ?? { label: status, color: '#6b7280' };
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, background: b.color + '22', color: b.color,
      border: `1px solid ${b.color}44`, borderRadius: 10, padding: '1px 7px', letterSpacing: 0.3,
    }}>
      {b.label}
    </span>
  );
}

// ─── Tool row ────────────────────────────────────────────────────────────────

function ToolRow({
  tool, displayName, onToggle,
}: {
  tool: ToolDef;
  displayName: string;
  onToggle: (name: string, enabled: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [calling, setCalling] = useState(false);
  const [result, setResult] = useState<unknown>(null);

  const props = tool.inputSchema?.properties ?? {};
  const required = tool.inputSchema?.required ?? [];
  const hasParams = Object.keys(props).length > 0;

  const handleCall = async () => {
    setCalling(true);
    const args: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(inputs)) {
      if (v !== '') args[k] = v;
    }
    const r = await callTool(tool.name, args);
    setCalling(false);
    setResult(r);
  };

  return (
    <div style={{ borderTop: '1px solid #1e2a3a' }}>
      {/* Row header: toggle + risk + name + expand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px 6px 12px' }}>
        <Toggle checked={tool.enabled} onChange={(v) => onToggle(tool.name, v)} />
        {tool.risk && tool.risk !== 'low' && <RiskBadge risk={tool.risk} />}
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 4,
            background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', minWidth: 0,
          }}
        >
          <span style={{
            fontSize: 12, color: tool.enabled ? '#e2e8f0' : '#475569',
            fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {displayName}
          </span>
          {(hasParams || tool.description) && (
            <span style={{ fontSize: 9, color: '#475569', flexShrink: 0 }}>{open ? '▼' : '▶'}</span>
          )}
        </button>
      </div>

      {/* Expanded detail */}
      {open && (
        <div style={{ padding: '0 12px 12px 42px' }}>
          {tool.description && (
            <p style={{ fontSize: 11, color: '#64748b', marginBottom: 8, lineHeight: 1.4 }}>{tool.description}</p>
          )}
          {hasParams && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 8 }}>
              {Object.entries(props).map(([key, schema]) => (
                <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 10, color: '#64748b' }}>
                    {key}{required.includes(key) ? ' *' : ''}
                    {schema.description ? ` — ${schema.description}` : ''}
                  </span>
                  <input
                    placeholder={schema.enum ? schema.enum.join(' | ') : schema.type === 'boolean' ? 'true / false' : ''}
                    value={inputs[key] ?? ''}
                    onChange={(e) => setInputs((p) => ({ ...p, [key]: e.target.value }))}
                    style={{
                      fontSize: 11, background: '#0f172a', border: '1px solid #334155',
                      borderRadius: 4, padding: '4px 7px', color: '#e2e8f0', outline: 'none',
                    }}
                  />
                </label>
              ))}
            </div>
          )}
          <button
            onClick={handleCall}
            disabled={calling || !tool.enabled}
            style={{
              fontSize: 11, padding: '4px 12px', borderRadius: 4,
              background: calling ? '#1e3a5f' : '#1d4ed8', color: '#fff',
              border: 'none', cursor: (calling || !tool.enabled) ? 'default' : 'pointer',
              opacity: !tool.enabled ? 0.4 : 1,
            }}
          >
            {calling ? 'Calling…' : '▶ Call'}
          </button>
          {result !== null && (
            <pre style={{
              marginTop: 8, fontSize: 10, background: '#0f172a', border: '1px solid #1e2a3a',
              borderRadius: 4, padding: 8, color: '#94a3b8', overflow: 'auto', maxHeight: 200,
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Group card ───────────────────────────────────────────────────────────────

function GroupCard({ group, onToggle }: { group: ToolGroup; onToggle: (name: string, enabled: boolean) => void }) {
  const [collapsed, setCollapsed] = useState(true);

  const icon = group.type === 'browser' ? (BROWSER_CATEGORY_ICONS[group.label] ?? '🔧') : '🌐';
  const enabledCount = group.tools.filter((t) => t.enabled).length;
  const allEnabled = enabledCount === group.tools.length;
  const noneEnabled = enabledCount === 0;

  // Bulk toggle: if all enabled → disable all; else → enable all
  const handleGroupToggle = async () => {
    const target = !allEnabled;
    for (const t of group.tools) {
      await toggleTool(t.name, target);
      onToggle(t.name, target);
    }
  };

  return (
    <div style={{ background: '#141e2e', border: '1px solid #1e2a3a', borderRadius: 8, marginBottom: 8, overflow: 'hidden' }}>
      {/* Group header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px 10px 12px' }}>
        <span style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span>

        {/* Clickable label area (expand/collapse) */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', minWidth: 0 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{group.label}</span>
            <StatusBadge status={group.status} />
            <span style={{ fontSize: 10, color: '#475569', marginLeft: 2 }}>
              {enabledCount}/{group.tools.length}
            </span>
          </div>
          {group.type === 'website' && (
            <span style={{ fontSize: 10, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 190, marginTop: 1 }}>
              {group.url}
            </span>
          )}
        </button>

        {/* Bulk toggle */}
        <Toggle
          checked={!noneEnabled}
          onChange={handleGroupToggle}
        />

        <button
          onClick={() => setCollapsed((c) => !c)}
          style={{ fontSize: 10, color: '#475569', background: 'transparent', border: 'none', cursor: 'pointer', flexShrink: 0, padding: '0 2px' }}
        >
          {collapsed ? '▶' : '▼'}
        </button>
      </div>

      {/* Tool list */}
      {!collapsed && (
        <div style={{ borderTop: '1px solid #1e2a3a' }}>
          {group.tools.length === 0 ? (
            <p style={{ padding: '10px 12px', fontSize: 11, color: '#475569' }}>No tools.</p>
          ) : (
            group.tools.map((t) => {
              const displayName = group.type === 'website'
                ? (t as any).originalName ?? t.name
                : t.name.replace(/^browser_/, '');
              return (
                <ToolRow
                  key={t.name}
                  tool={t}
                  displayName={displayName}
                  onToggle={onToggle}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

function ToolsPanel() {
  const [groups, setGroups] = useState<ToolGroup[]>([]);
  const [totalTools, setTotalTools] = useState(0);
  const [providerRunning, setProviderRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = async (quiet = false) => {
    if (!quiet) setError(null);
    const r = await loadAllTools();
    if (r.success) {
      setGroups(r.groups);
      setTotalTools(r.totalTools);
      setProviderRunning(r.providerRunning);
    } else {
      setError(r.error ?? 'Failed to load tools');
    }
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
    pollRef.current = setInterval(() => void refresh(true), 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Optimistic toggle: update local state immediately, background handles storage
  const handleToggle = (toolName: string, enabled: boolean) => {
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        tools: g.tools.map((t) => t.name === toolName ? { ...t, enabled } : t),
      }))
    );
    setTotalTools((prev) => enabled ? prev + 1 : prev - 1);
    // Persist + re-register provider
    void toggleTool(toolName, enabled);
  };

  const browserGroups = groups.filter((g) => g.type === 'browser');
  const websiteGroups = groups.filter((g) => g.type === 'website');

  return (
    <div style={{ padding: 12, fontFamily: 'system-ui, sans-serif', color: '#e2e8f0', minHeight: '100vh', background: '#0c1525' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>MCP Tools</span>
          {!loading && (
            <span style={{ fontSize: 11, color: '#475569', marginLeft: 8 }}>
              {totalTools} enabled
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: providerRunning ? '#22c55e' : '#ef4444' }}>
            {providerRunning ? '● Connected' : '○ Disconnected'}
          </span>
          <button
            onClick={() => { setLoading(true); void refresh(); }}
            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer' }}
          >
            ↻
          </button>
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 32, color: '#475569' }}>Loading…</div>
      )}

      {!loading && error && (
        <div style={{ background: '#2d1515', border: '1px solid #7f1d1d', borderRadius: 8, padding: 12, color: '#fca5a5', fontSize: 12 }}>
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Browser tools */}
          {browserGroups.length > 0 && (
            <section style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>
                Browser Tools
              </div>
              {browserGroups.map((g) => <GroupCard key={g.id} group={g} onToggle={handleToggle} />)}
            </section>
          )}

          {/* Website tools */}
          <section>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>
              Website Tools
              {websiteGroups.length === 0 && (
                <span style={{ color: '#334155', fontWeight: 400, marginLeft: 6 }}>— none connected</span>
              )}
            </div>
            {websiteGroups.length === 0 && (
              <p style={{ fontSize: 11, color: '#334155', padding: '4px 0' }}>
                Open a page that implements an MCP server via{' '}
                <code style={{ color: '#64748b' }}>TabServerTransport</code> to see its tools here.
              </p>
            )}
            {websiteGroups.map((g) => <GroupCard key={g.id} group={g} onToggle={handleToggle} />)}
          </section>
        </>
      )}
    </div>
  );
}

export default ToolsPanel;

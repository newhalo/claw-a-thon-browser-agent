import React, { useState, useMemo } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { ModelCatalogItem } from '../lib/agentServiceClient';
import type { ModelInfo } from '../lib/agentServiceClient';

interface Props {
  liveModels: ModelInfo[];
  catalog: ModelCatalogItem[];
  activeModelId: string;
  onSelect: (id: string) => void;
  loading?: boolean;
}

function isSelectable(liveModel: ModelInfo, catalog: ModelCatalogItem[]): boolean {
  const entry = catalog.find(c => c.id === liveModel.id);
  const liveEnabled = !liveModel.status || liveModel.status === 'enabled';
  const configEnabled = entry ? entry.configEnabled : true;
  return liveEnabled && configEnabled;
}

function ModelLogo({ item, size }: { item: ModelCatalogItem | undefined; name: string; size: number }) {
  const [imgError, setImgError] = useState(false);
  if (item?.image && !imgError) {
    return (
      <img
        src={item.image}
        alt=""
        width={size}
        height={size}
        style={{ borderRadius: size / 4, objectFit: 'cover', flexShrink: 0 }}
        onError={() => setImgError(true)}
      />
    );
  }
  const initial = (item?.provider?.name?.[0] ?? item?.name?.[0] ?? '?').toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: size / 4, flexShrink: 0,
      background: 'var(--accent-light)', color: 'var(--accent)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.45, fontWeight: 700,
    }}>
      {initial}
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = { chat: 'Chat', messages: 'Msg', responses: 'Resp', generateContent: 'Gen', embeddings: 'Emb', images: 'Img' };
  return (
    <span style={{
      fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 8,
      background: 'rgba(79,70,229,0.08)', color: 'var(--accent)',
      border: '1px solid rgba(79,70,229,0.2)', letterSpacing: 0.2,
    }}>
      {labels[type] ?? type}
    </span>
  );
}

export default function ModelSelector({ liveModels, catalog, activeModelId, onSelect, loading }: Props) {
  const [search, setSearch] = useState('');

  const CHAT_TYPES = new Set(['chat', 'messages', 'responses', 'generateContent']);

  const enriched = useMemo(() => {
    const chatModels = liveModels.filter(m => !m.model_type || CHAT_TYPES.has(m.model_type));
    const base = chatModels.length > 0 ? chatModels : liveModels;
    return base.map(m => ({
      live: m,
      meta: catalog.find(c => c.id === m.id),
      selectable: isSelectable(m, catalog),
    }));
  }, [liveModels, catalog]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return q
      ? enriched.filter(({ live, meta }) =>
          live.id.toLowerCase().includes(q) ||
          (meta?.name ?? live.name).toLowerCase().includes(q) ||
          (meta?.provider?.name ?? '').toLowerCase().includes(q)
        )
      : enriched;
  }, [enriched, search]);

  // Group by provider when catalog data available
  const groups = useMemo(() => {
    const hasCatalog = filtered.some(({ meta }) => !!meta);
    if (!hasCatalog) return [{ label: null, items: filtered }];
    const map = new Map<string, typeof filtered>();
    for (const item of filtered) {
      const key = item.meta?.provider?.name ?? 'Other';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
  }, [filtered]);

  if (loading) {
    return <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Đang tải models…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Search */}
        <input
          type="text"
          placeholder="Tìm model…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 7,
            fontSize: 12, background: 'var(--bg-elevated)', color: 'var(--text-primary)',
            fontFamily: 'inherit', outline: 'none',
          }}
        />

        {/* List */}
        <div style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {groups.map(({ label, items }) => (
            <div key={label ?? '__all'}>
              {label && (
                <div style={{
                  fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  padding: '6px 2px 3px',
                }}>
                  {label}
                </div>
              )}
              {items.map(({ live, meta, selectable }) => {
                const displayName = meta?.name ?? live.name ?? live.id;
                const isActive = live.id === activeModelId;
                return (
                  <button
                    key={live.id}
                    type="button"
                    disabled={!selectable || loading}
                    onClick={() => selectable && onSelect(live.id)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'flex-start', gap: 10,
                      padding: '8px 10px', borderRadius: 8, cursor: selectable ? 'pointer' : 'not-allowed',
                      border: isActive ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                      background: isActive ? 'var(--accent-light)' : 'var(--bg-elevated)',
                      opacity: selectable ? 1 : 0.45,
                      textAlign: 'left', transition: 'border-color 0.15s, background 0.15s',
                    }}
                  >
                    {/* Logo */}
                    <ModelLogo item={meta} name={displayName} size={32} />

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Name row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                          {displayName}
                        </span>
                        {isActive && (
                          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-light)', border: '1px solid rgba(79,70,229,0.3)', borderRadius: 6, padding: '1px 5px' }}>
                            Active
                          </span>
                        )}
                        {meta?.isFree && (
                          <span style={{ fontSize: 9, fontWeight: 700, color: '#d97706', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.35)', borderRadius: 6, padding: '1px 5px' }}>
                            Free
                          </span>
                        )}
                        {meta?.hasRateLimit && (
                          <span style={{ fontSize: 9, fontWeight: 600, color: '#ea580c', background: 'rgba(234,88,12,0.08)', border: '1px solid rgba(234,88,12,0.25)', borderRadius: 6, padding: '1px 5px' }}>
                            Rate Limit
                          </span>
                        )}
                        {!selectable && (
                          <span style={{ fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic' }}>Không khả dụng</span>
                        )}
                      </div>

                      {/* Provider sub-label */}
                      {meta?.provider && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{meta.provider.name}</div>
                      )}

                      {/* Description with tooltip */}
                      {meta?.description && (
                        <Tooltip.Root>
                          <Tooltip.Trigger asChild>
                            <div style={{
                              fontSize: 11, color: 'var(--text-secondary)', marginTop: 3,
                              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                              overflow: 'hidden', lineHeight: 1.45, cursor: 'help',
                            }}>
                              {meta.description}
                            </div>
                          </Tooltip.Trigger>
                          <Tooltip.Portal>
                            <Tooltip.Content
                              side="top"
                              align="start"
                              sideOffset={4}
                              style={{
                                maxWidth: 280, padding: '8px 10px', borderRadius: 8,
                                background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                                fontSize: 11, lineHeight: 1.55, boxShadow: 'var(--shadow-md)',
                                border: '1px solid var(--border)', zIndex: 9999,
                              }}
                            >
                              {meta.description}
                              <Tooltip.Arrow style={{ fill: 'var(--border)' }} />
                            </Tooltip.Content>
                          </Tooltip.Portal>
                        </Tooltip.Root>
                      )}

                      {/* Type badges + doc link */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                        {(meta?.enabledTypes ?? []).map(t => <TypeBadge key={t} type={t} />)}
                        {meta?.linkDocument && (
                          <a
                            href={meta.linkDocument}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            title="Xem tài liệu"
                            style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', textDecoration: 'none', lineHeight: 1 }}
                          >
                            📄
                          </a>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
              Không tìm thấy model
            </div>
          )}
        </div>
      </div>
  );
}

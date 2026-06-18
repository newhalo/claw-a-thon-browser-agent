import React, { useState, useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import type { ModelCatalogItem, ModelInfo } from '../lib/agentServiceClient';

interface Props {
  liveModels: ModelInfo[];
  catalog: ModelCatalogItem[];
  activeModelId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}

function isSelectable(liveModel: ModelInfo, catalog: ModelCatalogItem[]): boolean {
  const entry = catalog.find(c => c.id === liveModel.id);
  const liveEnabled = !liveModel.status || liveModel.status === 'enabled';
  const configEnabled = entry ? entry.configEnabled : true;
  return liveEnabled && configEnabled;
}

function ModelMini({ item, size }: { item: ModelCatalogItem | undefined; name: string; size: number }) {
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

export default function ModelQuickSelect({ liveModels, catalog, activeModelId, onSelect, disabled }: Props) {
  const [open, setOpen] = useState(false);

  const CHAT_TYPES = new Set(['chat', 'messages', 'responses', 'generateContent']);

  const items = useMemo(() => {
    const chatModels = liveModels.filter(m => !m.model_type || CHAT_TYPES.has(m.model_type));
    const base = chatModels.length > 0 ? chatModels : liveModels;
    return base.map(m => ({
      live: m,
      meta: catalog.find(c => c.id === m.id),
      selectable: isSelectable(m, catalog),
    }));
  }, [liveModels, catalog]);

  const activeMeta = catalog.find(c => c.id === activeModelId);
  const activeLive = liveModels.find(m => m.id === activeModelId);
  const activeDisplayName = activeMeta?.name ?? activeLive?.name ?? activeModelId;

  if (items.length === 0) return null;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          title="Chọn model"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '3px 8px',
            fontSize: 12, color: 'var(--text-secondary)',
            fontFamily: 'inherit', cursor: disabled ? 'not-allowed' : 'pointer',
            outline: 'none', maxWidth: 180, overflow: 'hidden',
          }}
        >
          <ModelMini item={activeMeta} name={activeDisplayName} size={16} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {activeDisplayName || activeModelId}
          </span>
          <span style={{ fontSize: 8, color: 'var(--text-muted)', flexShrink: 0 }}>▾</span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={6}
          style={{
            width: 260, maxHeight: 360, overflowY: 'auto',
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 10, padding: 6, boxShadow: 'var(--shadow-md)',
            display: 'flex', flexDirection: 'column', gap: 2, zIndex: 9999,
          }}
        >
          {items.map(({ live, meta, selectable }) => {
            const displayName = meta?.name ?? live.name ?? live.id;
            const isActive = live.id === activeModelId;
            return (
              <button
                key={live.id}
                type="button"
                disabled={!selectable}
                onClick={() => { if (selectable) { onSelect(live.id); setOpen(false); } }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 8px', borderRadius: 6, cursor: selectable ? 'pointer' : 'not-allowed',
                  border: isActive ? '1px solid rgba(79,70,229,0.4)' : '1px solid transparent',
                  background: isActive ? 'var(--accent-light)' : 'transparent',
                  opacity: selectable ? 1 : 0.4,
                  textAlign: 'left', width: '100%',
                }}
              >
                <ModelMini item={meta} name={displayName} size={20} />
                <span style={{ flex: 1, fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {displayName}
                </span>
                {meta?.isFree && (
                  <span style={{ fontSize: 9, fontWeight: 700, color: '#d97706', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.35)', borderRadius: 5, padding: '1px 4px', flexShrink: 0 }}>
                    Free
                  </span>
                )}
                {!selectable && (
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>✕</span>
                )}
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

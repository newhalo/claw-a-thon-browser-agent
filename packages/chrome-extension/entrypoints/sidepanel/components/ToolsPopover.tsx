import React, { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import ToolsPanel from './ToolsPanel';

export default function ToolsPopover() {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          title="Manage browser tools"
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '4px 8px',
            cursor: 'pointer',
            fontSize: 14,
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          🔧 <span style={{ fontSize: 12 }}>Tools</span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          style={{
            width: 340,
            maxHeight: '70vh',
            overflow: 'auto',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 8px 32px rgba(0,0,0,0.24)',
            zIndex: 1000,
          }}
        >
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Browser Tools</span>
            <Popover.Close asChild>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-secondary)' }}>×</button>
            </Popover.Close>
          </div>
          <ToolsPanel compact />
          <Popover.Arrow style={{ fill: 'var(--border)' }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

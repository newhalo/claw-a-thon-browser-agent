# Plan: Create Skill from Session

## Mục tiêu

Cho phép người dùng tạo skill từ những gì đã làm trong session chat hiện tại — agent tự động đọc lịch sử session, tóm tắt thành skill definition, mở Settings > Skills và pre-fill form để người dùng review và lưu.

Ngoài ra, bổ sung **slash command `"/"`** trong chat input để invoke skill nhanh như Cursor / Claude.

---

## Feature A — Tạo skill từ session

### Flow

```
[⋯ More actions] → "🪄 Tạo skill từ session"
  → Pre-summarize session (client-side nếu > 30 turns)
  → POST /summarize-skill (agent-service)
  → Lưu draft vào chrome.storage.session
  → chrome.tabs.create options.html?tab=skills&prefill=1
  → Options page: auto-navigate Skills tab + pre-fill form
  → User review, edit, save
```

### A1. Backend: `POST /summarize-skill`

**File:** `packages/agent-service/server.js`

**Request body:**
```json
{
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "toolCalls": [
    { "toolName": "browser_navigate", "args": { "url": "..." } },
    { "toolName": "browser_click", "args": { "selector": "..." } }
  ]
}
```

- `toolCalls`: chỉ gửi `{ toolName, args }`, **bỏ result** để tiết kiệm token
- Dùng LLM provider đang configured với `structured_output` schema
- Trả về JSON (không lưu gì ở server)

**Structured output schema:**
```json
{
  "name": "string — tên ngắn, kebab-friendly",
  "icon": "string — 1 emoji phù hợp",
  "description": "string — 1 câu mô tả khi nào dùng skill này",
  "category": "custom | work | research | productivity | dev",
  "instructions": "string — Markdown, mô tả chi tiết các bước agent cần làm"
}
```

**LLM system prompt (gợi ý):**
```
Bạn là một AI chuyên tạo skill definitions cho browser agent.
Dựa vào lịch sử session sau, hãy tạo một skill có thể tái sử dụng.
Instructions phải đủ cụ thể để agent mới (không có context session) có thể thực hiện lại task tương tự.
Viết instructions theo dạng Markdown có numbered steps, dùng tên tool khi cần thiết.
```

### A2. Client: Pre-summarize dài session

**File:** `packages/chrome-extension/entrypoints/sidepanel/lib/agentServiceClient.ts`

Thêm function `summarizeSkillFromSession(agentServiceUrl, messages, toolCalls)`:

```ts
export async function summarizeSkillFromSession(
  agentServiceUrl: string,
  messages: Message[],
  toolCalls: { toolName: string; args: unknown }[]
): Promise<SkillDraft>
```

**Logic pre-summarize (client-side, không gọi LLM):**
- Nếu `messages.length > 30`: gộp messages cũ (index 0 → length-10) thành 1 block:
  ```
  [Session summary — {N} earlier messages]
  User goals: {first user message}
  ...
  ```
  Chỉ giữ nguyên 10 messages cuối để LLM có đủ context gần nhất.
- Nếu ≤ 30 messages: gửi toàn bộ.

**Type:**
```ts
export interface SkillDraft {
  name: string;
  icon: string;
  description: string;
  category: string;
  instructions: string;
}
```

### A3. UI: More actions menu

**File mới:** `packages/chrome-extension/entrypoints/sidepanel/components/MoreActionsMenu.tsx`

- Dùng Radix UI `Popover` (đã có sẵn)
- Trigger: nút "⋯" trong input toolbar (cạnh SkillsPopover, ToolsPopover)
- Disable khi `messages.length === 0` hoặc `isLoading`

**Menu items (bắt đầu với):**
```
🪄  Tạo skill từ session    [disabled nếu messages rỗng]
```
(Dễ mở rộng thêm items sau)

**Khi click "Tạo skill từ session":**
1. Close popover
2. Hiện loading state trên button (spinner)
3. Gọi `summarizeSkillFromSession()`
4. Lưu result vào `chrome.storage.session` với key `skillDraft`
5. `chrome.tabs.create({ url: chrome.runtime.getURL('options.html') + '?tab=skills&prefill=1' })`
6. Reset loading state

**File sửa:** `ChatView.tsx` — import và đặt `<MoreActionsMenu />` vào input toolbar.

### A4. Options page: detect prefill

**File:** `packages/chrome-extension/entrypoints/options/App.tsx`

Trong `App` component, khi mount:
```ts
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('prefill') === '1') {
    setTab('skills');
    // signal xuống SkillsTab qua props hoặc context
  }
}, []);
```

Trong `SkillsTab`, thêm prop `prefillOnMount?: boolean`:
```ts
useEffect(() => {
  if (!prefillOnMount) return;
  chrome.storage.session.get(['skillDraft'], ({ skillDraft }) => {
    if (!skillDraft) return;
    setMode('create');
    setForm({
      name: skillDraft.name,
      icon: skillDraft.icon,
      description: skillDraft.description,
      category: skillDraft.category,
      instructions: skillDraft.instructions,
    });
    chrome.storage.session.remove(['skillDraft']); // clear sau khi đọc
  });
}, [prefillOnMount]);
```

---

## Feature B — Slash command `"/"` trong chat input

### Flow

```
User gõ "/" trong textarea
  → showSlashMenu = true, slashQuery = ""
User tiếp tục gõ "/web"
  → filter skills theo "web"
  → hiển thị suggestion popup phía trên textarea
User nhấn ↑↓ để navigate, Enter để chọn (hoặc click)
  → skill được activate (toggle ON)
  → input clear "/" , focus lại textarea
Esc / xóa hết "/" → đóng menu
```

### Implementation (inline trong `ChatView.tsx`)

**State cần thêm:**
```ts
const [showSlashMenu, setShowSlashMenu] = useState(false);
const [slashQuery, setSlashQuery] = useState('');
const [slashIndex, setSlashIndex] = useState(0);
```

**onChange handler (thêm vào sau setInput):**
```ts
if (val.startsWith('/')) {
  setSlashQuery(val.slice(1).toLowerCase());
  setShowSlashMenu(true);
  setSlashIndex(0);
} else {
  setShowSlashMenu(false);
  setSlashQuery('');
}
```

**Filtered skills:**
```ts
const allSkills = [
  ...skills.filter(s => !disabledSkillIds.includes(s.id)),
  ...customSkills.filter(s => !disabledSkillIds.includes(s.id)),
];
const slashFiltered = slashQuery
  ? allSkills.filter(s =>
      s.name.toLowerCase().includes(slashQuery) ||
      (s.description ?? '').toLowerCase().includes(slashQuery)
    )
  : allSkills;
```

**onKeyDown handler (thêm vào handleKeyDown):**
```ts
if (showSlashMenu) {
  if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex(i => Math.min(i + 1, slashFiltered.length - 1)); return; }
  if (e.key === 'ArrowUp')   { e.preventDefault(); setSlashIndex(i => Math.max(i - 1, 0)); return; }
  if (e.key === 'Enter')     { e.preventDefault(); selectSlashSkill(slashFiltered[slashIndex]); return; }
  if (e.key === 'Escape')    { setShowSlashMenu(false); return; }
}
```

**selectSlashSkill:**
```ts
const selectSlashSkill = (skill: Skill | CustomSkill) => {
  if (!activeSkills.includes(skill.id)) {
    toggleSkill(skill.id);
    chrome.storage.local.set({ activeSkills: [...activeSkills, skill.id] });
  }
  setInput('');
  setShowSlashMenu(false);
  textareaRef.current?.focus();
};
```

**Slash menu JSX** — đặt phía trên `<textarea>`, inside input container:
```tsx
{showSlashMenu && slashFiltered.length > 0 && (
  <div style={{
    position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 4,
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 10, padding: 4, boxShadow: 'var(--shadow-md)',
    maxHeight: 220, overflowY: 'auto', zIndex: 100,
  }}>
    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', padding: '4px 8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      Skills
    </div>
    {slashFiltered.map((skill, i) => (
      <button key={skill.id} type="button"
        onClick={() => selectSlashSkill(skill)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '6px 8px', borderRadius: 6, border: 'none', textAlign: 'left',
          background: i === slashIndex ? 'var(--accent-light)' : 'transparent',
          cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 16, width: 20, textAlign: 'center', flexShrink: 0 }}>{skill.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{skill.name}</div>
          {skill.description && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {skill.description}
            </div>
          )}
        </div>
        {activeSkills.includes(skill.id) && (
          <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, flexShrink: 0 }}>Active</span>
        )}
      </button>
    ))}
  </div>
)}
```

Input container cần `position: relative` để popup định vị đúng.

---

## Files cần thay đổi

| File | Thay đổi | Feature |
|------|----------|---------|
| `packages/agent-service/server.js` | Thêm `POST /summarize-skill` route | A |
| `packages/chrome-extension/entrypoints/sidepanel/lib/agentServiceClient.ts` | Thêm `summarizeSkillFromSession()`, `SkillDraft` type | A |
| `packages/chrome-extension/entrypoints/sidepanel/components/MoreActionsMenu.tsx` | **File mới** — Popover "⋯" với action tạo skill | A |
| `packages/chrome-extension/entrypoints/sidepanel/views/ChatView.tsx` | Import `MoreActionsMenu`, thêm slash command state + UI | A, B |
| `packages/chrome-extension/entrypoints/options/App.tsx` | Detect `?prefill=1`, pass `prefillOnMount` xuống `SkillsTab` | A |

---

## Notes khi implement

- `chrome.storage.session` chỉ tồn tại trong session browser (không persist qua restart) — phù hợp cho draft tạm.
- Slash menu popup cần `position: absolute` — input container ở ChatView phải có `position: relative`.
- Không cần component mới cho slash menu — implement inline trong ChatView.tsx.
- `MoreActionsMenu` dùng `@radix-ui/react-popover` đã có sẵn.
- Backend `/summarize-skill` nên dùng cùng `streamText` pattern nhưng với `maxTokens` nhỏ hơn (~800) vì output là JSON ngắn.

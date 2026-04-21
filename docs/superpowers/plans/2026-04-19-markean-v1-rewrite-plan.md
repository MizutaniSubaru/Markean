# Markean V1 Frontend Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the `apps/web` frontend with an Apple Notes-inspired UI based on the Markean V1 HTML prototype, using CodeMirror 6 Live Preview, mobile responsive layout, inline search with keyword highlighting, and i18n.

**Architecture:** Delete old UI components/styles/routes. Build new components in `components/{desktop,mobile,shared,editor}`. Reuse existing `lib/storage.ts`, `lib/sync.ts`, `lib/bootstrap.ts`, and `state/app-store.ts` unchanged. State management in `App.tsx` follows existing `AppShell.tsx` patterns.

**Tech Stack:** React 18, CodeMirror 6 (`@codemirror/view`, `@codemirror/state`, `@codemirror/lang-markdown`), Vite, Vitest + Testing Library, CSS (no preprocessor).

**Design Spec:** `docs/superpowers/specs/2026-04-19-markean-v1-rewrite-design.md`

---

### Task 1: Clean up old UI files and update entry point

**Files:**
- Delete: `apps/web/src/components/layout/AppShell.tsx`
- Delete: `apps/web/src/components/layout/FoldersPane.tsx`
- Delete: `apps/web/src/components/layout/NotesPane.tsx`
- Delete: `apps/web/src/components/layout/EditorPane.tsx`
- Delete: `apps/web/src/components/layout/LiveEditor.tsx`
- Delete: `apps/web/src/components/layout/SyncBadge.tsx`
- Delete: `apps/web/src/components/layout/icons.tsx`
- Delete: `apps/web/src/app/router.tsx`
- Delete: `apps/web/src/app/providers.tsx`
- Delete: `apps/web/src/routes/app.tsx`
- Delete: `apps/web/src/styles/app.css`
- Delete: `apps/web/test/app-shell.test.tsx`
- Delete: `apps/web/test/editor-pane.test.tsx`
- Delete: `apps/web/test/folders-pane.test.tsx`
- Delete: `apps/web/test/notes-pane.test.tsx`
- Delete: `apps/web/test/bootstrap-store.test.ts`
- Modify: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx` (placeholder)
- Create: `apps/web/src/styles/variables.css`

- [ ] **Step 1: Delete old UI files**

```bash
cd apps/web
rm -f src/components/layout/AppShell.tsx
rm -f src/components/layout/FoldersPane.tsx
rm -f src/components/layout/NotesPane.tsx
rm -f src/components/layout/EditorPane.tsx
rm -f src/components/layout/LiveEditor.tsx
rm -f src/components/layout/SyncBadge.tsx
rm -f src/components/layout/icons.tsx
rm -f src/app/router.tsx
rm -f src/app/providers.tsx
rm -f src/routes/app.tsx
rm -f src/styles/app.css
rm -f test/app-shell.test.tsx
rm -f test/editor-pane.test.tsx
rm -f test/folders-pane.test.tsx
rm -f test/notes-pane.test.tsx
rm -f test/bootstrap-store.test.ts
```

- [ ] **Step 2: Create `variables.css`**

```css
/* apps/web/src/styles/variables.css */
* { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --accent: #007AFF;
  --accent-light: rgba(0,122,255,0.12);
  --bg-sidebar: #F2F2F7;
  --bg-list: #FAFAFA;
  --bg-editor: #FFFFFF;
  --text-primary: #1C1C1E;
  --text-secondary: #636366;
  --text-tertiary: #AEAEB2;
  --sep: rgba(60,60,67,0.12);
  --sep-strong: rgba(60,60,67,0.22);
  --radius: 10px;
  --font: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif;
  --font-mono: 'SF Mono', 'Menlo', 'Consolas', monospace;
}

html, body, #root { height: 100%; overflow: hidden; }
body {
  font-family: var(--font);
  background: var(--bg-sidebar);
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
}

/* Scrollbars */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 3px; }

/* Search highlight */
mark { background: rgba(255,220,0,0.4); border-radius: 2px; padding: 0 1px; }
```

- [ ] **Step 3: Create placeholder `App.tsx`**

```tsx
// apps/web/src/App.tsx
export function App() {
  return <div>Markean</div>;
}
```

- [ ] **Step 4: Update `main.tsx`**

```tsx
// apps/web/src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/variables.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js").catch(() => {});
}
```

- [ ] **Step 5: Verify the app compiles**

Run: `cd apps/web && npx vite build`
Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web/src apps/web/test
git commit -m "chore: remove old UI components and reset entry point for V1 rewrite"
```

---

### Task 2: i18n module

**Files:**
- Create: `apps/web/src/i18n/en.ts`
- Create: `apps/web/src/i18n/zh.ts`
- Create: `apps/web/src/i18n/index.ts`
- Create: `apps/web/test/i18n.test.ts`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/test/i18n.test.ts
import { describe, expect, it } from "vitest";
import { createI18n } from "../src/i18n";

describe("i18n", () => {
  it("returns English text for en locale", () => {
    const i18n = createI18n("en");
    expect(i18n.t("sidebar.title")).toBe("Folders");
  });

  it("returns Chinese text for zh-CN locale", () => {
    const i18n = createI18n("zh-CN");
    expect(i18n.t("sidebar.title")).toBe("文件夹");
  });

  it("maps zh-TW to Chinese", () => {
    const i18n = createI18n("zh-TW");
    expect(i18n.t("sidebar.search")).toBe("搜索");
  });

  it("falls back to English for unknown locale", () => {
    const i18n = createI18n("fr-FR");
    expect(i18n.t("sidebar.title")).toBe("Folders");
  });

  it("interpolates {n} in count strings", () => {
    const i18n = createI18n("en");
    expect(i18n.t("noteList.count", { n: 5 })).toBe("5 notes");
  });

  it("interpolates {n} in Chinese count strings", () => {
    const i18n = createI18n("zh");
    expect(i18n.t("noteList.count", { n: 3 })).toBe("3 篇笔记");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run test/i18n.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create English translations**

```ts
// apps/web/src/i18n/en.ts
export const en: Record<string, string> = {
  "sidebar.title": "Folders",
  "sidebar.search": "Search",
  "sidebar.newFolder": "New Folder",
  "noteList.count": "{n} notes",
  "noteList.newNote": "New Note",
  "noteList.group.7d": "Last 7 Days",
  "noteList.group.30d": "Last 30 Days",
  "noteList.group.older": "Older",
  "noteList.empty": "No Notes",
  "editor.noSelection": "Select a note to start editing",
  "editor.noSelectionHint": "or press ⌘N to create one",
  "editor.synced": "Synced",
  "editor.syncing": "Syncing",
  "editor.unsynced": "Unsynced",
  "search.noResults": "No matching notes",
  "mobile.done": "Done",
  "mobile.folders": "Folders",
  "welcome.title": "Welcome to Markean",
};
```

- [ ] **Step 4: Create Chinese translations**

```ts
// apps/web/src/i18n/zh.ts
export const zh: Record<string, string> = {
  "sidebar.title": "文件夹",
  "sidebar.search": "搜索",
  "sidebar.newFolder": "新建文件夹",
  "noteList.count": "{n} 篇笔记",
  "noteList.newNote": "新建笔记",
  "noteList.group.7d": "过去 7 天",
  "noteList.group.30d": "过去 30 天",
  "noteList.group.older": "更早",
  "noteList.empty": "暂无笔记",
  "editor.noSelection": "选择笔记以开始编辑",
  "editor.noSelectionHint": "或按 ⌘N 新建",
  "editor.synced": "已同步",
  "editor.syncing": "同步中",
  "editor.unsynced": "未同步",
  "search.noResults": "未找到相关笔记",
  "mobile.done": "完成",
  "mobile.folders": "文件夹",
  "welcome.title": "欢迎使用 Markean",
};
```

- [ ] **Step 5: Create i18n engine**

```tsx
// apps/web/src/i18n/index.ts
import { createContext, useContext } from "react";
import { en } from "./en";
import { zh } from "./zh";

type I18nInstance = {
  locale: string;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const dictionaries: Record<string, Record<string, string>> = { en, zh };

function resolveLocale(raw: string): string {
  if (raw.startsWith("zh")) return "zh";
  return "en";
}

export function detectLocale(): string {
  if (typeof window === "undefined") return "en";
  const stored = localStorage.getItem("markean:locale");
  if (stored) return resolveLocale(stored);
  return resolveLocale(navigator.language);
}

export function createI18n(rawLocale: string): I18nInstance {
  const locale = resolveLocale(rawLocale);
  const dict = dictionaries[locale] ?? dictionaries.en;

  function t(key: string, params?: Record<string, string | number>): string {
    let text = dict[key] ?? dictionaries.en[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, String(v));
      }
    }
    return text;
  }

  return { locale, t };
}

const I18nContext = createContext<I18nInstance>(createI18n("en"));

export const I18nProvider = I18nContext.Provider;

export function useI18n(): I18nInstance {
  return useContext(I18nContext);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/web && npx vitest run test/i18n.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/i18n apps/web/test/i18n.test.ts
git commit -m "feat: add lightweight i18n module with zh/en translations"
```

---

### Task 3: Icons component

**Files:**
- Create: `apps/web/src/components/shared/Icons.tsx`

- [ ] **Step 1: Create Icons component**

```tsx
// apps/web/src/components/shared/Icons.tsx
type IconProps = { size?: number; color?: string };

export function FolderIcon({ size = 20, color = "#007AFF" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <path
        d="M2 5.5A1.5 1.5 0 013.5 4h4.086a1.5 1.5 0 011.06.44l.915.914A1.5 1.5 0 0010.621 6H16.5A1.5 1.5 0 0118 7.5v8A1.5 1.5 0 0116.5 17h-13A1.5 1.5 0 012 15.5v-10z"
        fill={color}
        fillOpacity="0.2"
        stroke={color}
        strokeWidth="1.2"
      />
    </svg>
  );
}

export function AllNotesIcon({ size = 20, color = "#007AFF", active = false }: IconProps & { active?: boolean }) {
  const c = active ? "white" : color;
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <path d="M3 4h14v13H3z" fill={c} fillOpacity={active ? 0.2 : 0.15} stroke={c} strokeWidth="1.2" rx="2" />
      <path d="M6 8h8M6 11h5" stroke={c} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function TrashIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <path d="M7 4h6M5 4h10v12a1 1 0 01-1 1H6a1 1 0 01-1-1V4z" stroke="#FF3B30" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M8 8v5M12 8v5" stroke="#FF3B30" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function SearchIcon({ size = 13 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="none">
      <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M9 9l2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function ComposeIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <path d="M3 14l1.5-4.5L12 2l2.5 2.5-7.5 7.5L3 14z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M11 3.5l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function MoreIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <circle cx="5" cy="10" r="1.5" fill="currentColor" />
      <circle cx="10" cy="10" r="1.5" fill="currentColor" />
      <circle cx="15" cy="10" r="1.5" fill="currentColor" />
    </svg>
  );
}

export function BackIcon({ size = 10 }: IconProps) {
  return (
    <svg width={size} height={Math.round(size * 1.7)} viewBox="0 0 10 17" fill="none">
      <path d="M9 1L1 8.5L9 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronIcon({ size = 7 }: IconProps) {
  return (
    <svg width={size} height={Math.round(size * 1.7)} viewBox="0 0 7 12" fill="none">
      <path d="M1 1l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PlusIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M8 1v14M1 8h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function SyncIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path d="M1 6a5 5 0 109.9-1M11 2v3H8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function EmptyNoteIcon({ size = 56 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none">
      <rect x="8" y="4" width="40" height="48" rx="4" stroke="currentColor" strokeWidth="2" />
      <path d="M16 18h24M16 26h24M16 34h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/shared/Icons.tsx
git commit -m "feat: add SVG icon components for Apple Notes-style UI"
```

---

### Task 4: `useMediaQuery` hook

**Files:**
- Create: `apps/web/src/hooks/useMediaQuery.ts`
- Create: `apps/web/test/use-media-query.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/test/use-media-query.test.ts
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { useMediaQuery } from "../src/hooks/useMediaQuery";

describe("useMediaQuery", () => {
  let listeners: Array<(e: { matches: boolean }) => void>;

  beforeEach(() => {
    listeners = [];
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => { listeners.push(cb); },
        removeEventListener: () => {},
      }),
    });
  });

  it("returns false initially when media does not match", () => {
    const { result } = renderHook(() => useMediaQuery("(max-width: 768px)"));
    expect(result.current).toBe(false);
  });

  it("updates when media query changes", () => {
    const { result } = renderHook(() => useMediaQuery("(max-width: 768px)"));
    act(() => {
      for (const cb of listeners) cb({ matches: true });
    });
    expect(result.current).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run test/use-media-query.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

```ts
// apps/web/src/hooks/useMediaQuery.ts
import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handler = (e: MediaQueryListEvent | { matches: boolean }) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run test/use-media-query.test.ts`
Expected: All 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/useMediaQuery.ts apps/web/test/use-media-query.test.ts
git commit -m "feat: add useMediaQuery hook for responsive breakpoint"
```

---

### Task 5: Welcome note

**Files:**
- Create: `apps/web/src/components/shared/WelcomeNote.ts`

- [ ] **Step 1: Create welcome note content**

```ts
// apps/web/src/components/shared/WelcomeNote.ts

const welcomeEn = `# Welcome to Markean

Markean is a Markdown note editor that syncs across devices.

## Quick Start

- **Create a folder** — click the + button in the sidebar
- **Create a note** — click the compose button in the note list
- **Edit in Markdown** — just start typing, the editor renders your formatting live

## Markdown Basics

### Headings

Use \`#\` for headings:

\`\`\`markdown
# Heading 1
## Heading 2
### Heading 3
\`\`\`

### Formatting

- **Bold** — wrap text in \`**double asterisks**\`
- *Italic* — wrap text in \`*single asterisks*\`
- \`Code\` — wrap text in backticks

> Blockquotes start with \`>\`

---

Happy writing!`;

const welcomeZh = `# 欢迎使用 Markean

Markean 是一款跨设备同步的 Markdown 笔记编辑器。

## 快速上手

- **创建文件夹** — 点击侧边栏的 + 按钮
- **创建笔记** — 点击笔记列表的编辑按钮
- **Markdown 编辑** — 直接输入，编辑器会实时渲染格式

## Markdown 基础

### 标题

使用 \`#\` 创建标题：

\`\`\`markdown
# 一级标题
## 二级标题
### 三级标题
\`\`\`

### 格式化

- **加粗** — 用 \`**双星号**\` 包裹文字
- *斜体* — 用 \`*单星号*\` 包裹文字
- \`代码\` — 用反引号包裹文字

> 引用块以 \`>\` 开头

---

开始写作吧！`;

export function getWelcomeNote(locale: string): { title: string; body: string } {
  if (locale.startsWith("zh")) {
    return { title: "欢迎使用 Markean", body: welcomeZh };
  }
  return { title: "Welcome to Markean", body: welcomeEn };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/shared/WelcomeNote.ts
git commit -m "feat: add welcome note content in zh and en"
```

---

### Task 6: Desktop CSS styles

**Files:**
- Create: `apps/web/src/styles/desktop.css`

- [ ] **Step 1: Create desktop layout styles**

```css
/* apps/web/src/styles/desktop.css */

/* Three-pane layout */
.app { display: flex; height: 100vh; overflow: hidden; }

/* SIDEBAR */
.sidebar {
  width: 220px; flex-shrink: 0;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--sep);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.sidebar-header {
  padding: 16px 16px 8px;
  display: flex; align-items: center; justify-content: space-between;
  height: 60px;
}
.sidebar-title { font-size: 22px; font-weight: 700; letter-spacing: -0.4px; }
.sidebar-btn {
  width: 30px; height: 30px; border-radius: 50%;
  background: none; border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: var(--accent); transition: background .15s;
}
.sidebar-btn:hover { background: rgba(0,122,255,0.1); }
.sidebar-search {
  margin: 4px 12px 8px;
  background: rgba(118,118,128,0.12);
  border-radius: 10px;
  display: flex; align-items: center; gap: 6px;
  padding: 7px 10px;
}
.sidebar-search input {
  border: none; background: none; outline: none;
  font-family: var(--font); font-size: 14px;
  color: var(--text-primary); width: 100%;
}
.sidebar-search input::placeholder { color: var(--text-tertiary); }
.sidebar-search svg { color: var(--text-tertiary); flex-shrink: 0; }
.sidebar-scroll { overflow-y: auto; flex: 1; padding-bottom: 12px; }
.folder-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px 8px 14px;
  border-radius: 8px;
  margin: 1px 6px;
  cursor: pointer;
  user-select: none;
  transition: background .12s;
}
.folder-item:hover { background: rgba(0,0,0,0.05); }
.folder-item.active { background: var(--accent); color: white; }
.folder-item.active .folder-count { color: rgba(255,255,255,0.7); }
.folder-icon {
  flex-shrink: 0; width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center;
}
.folder-name {
  flex: 1; font-size: 14px; font-weight: 450;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.folder-count { font-size: 13px; color: var(--text-tertiary); }

/* NOTE LIST */
.note-list {
  width: 300px; flex-shrink: 0;
  background: var(--bg-list);
  border-right: 1px solid var(--sep);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.note-list-header {
  padding: 16px 14px 10px;
  border-bottom: 1px solid var(--sep);
  display: flex; align-items: center; justify-content: space-between;
}
.note-list-title { font-size: 17px; font-weight: 600; }
.note-list-meta { font-size: 12px; color: var(--text-tertiary); margin-top: 1px; }
.note-list-actions { display: flex; gap: 4px; }
.icon-btn {
  width: 32px; height: 32px; border-radius: 8px;
  background: none; border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: var(--accent); font-size: 20px; transition: background .12s;
}
.icon-btn:hover { background: var(--accent-light); }
.note-list-scroll { overflow-y: auto; flex: 1; }
.note-group-label {
  font-size: 13px; font-weight: 600; color: var(--text-secondary);
  padding: 14px 14px 6px;
  position: sticky; top: 0;
  background: var(--bg-list);
  z-index: 1;
}
.note-card {
  padding: 10px 14px;
  border-bottom: 1px solid var(--sep);
  cursor: pointer;
  display: flex; gap: 10px; align-items: flex-start;
  transition: background .1s;
}
.note-card:hover { background: rgba(0,0,0,0.04); }
.note-card.active { background: var(--accent-light); }
.note-card-text { flex: 1; min-width: 0; }
.note-card-title {
  font-size: 14px; font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.note-card-date { font-size: 12px; color: var(--text-secondary); margin: 2px 0; }
.note-card-preview {
  font-size: 12px; color: var(--text-tertiary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  line-height: 1.4;
}
.note-card-tag {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 11px; color: var(--text-tertiary); margin-top: 4px;
}

/* New note animation */
@keyframes notePopIn {
  0%   { opacity: 0; transform: translateY(-8px) scale(0.97); }
  60%  { opacity: 1; transform: translateY(2px) scale(1.005); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
.note-card-new { animation: notePopIn .28s cubic-bezier(.34,1.56,.64,1) both; }

/* EDITOR PANE */
.editor-pane {
  flex: 1; background: var(--bg-editor);
  display: flex; flex-direction: column;
  overflow: hidden; min-width: 0;
}
.editor-meta {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  padding: 12px 20px;
  font-size: 12px; color: var(--text-tertiary);
}
.sync-badge {
  display: inline-flex; align-items: center; gap: 4px;
  color: var(--accent); font-size: 12px; font-weight: 500;
}
.editor-scroll { flex: 1; overflow-y: auto; padding: 28px 60px 60px; }
.editor-content { max-width: 680px; margin: 0 auto; }

/* NO NOTE SELECTED */
.no-note {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  color: var(--text-tertiary); gap: 10px;
  font-size: 15px;
}
.no-note svg { opacity: 0.3; }
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/styles/desktop.css
git commit -m "feat: add desktop three-pane layout CSS"
```

---

### Task 7: Sidebar component

**Files:**
- Create: `apps/web/src/components/desktop/Sidebar.tsx`
- Create: `apps/web/test/sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/test/sidebar.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "../src/components/desktop/Sidebar";
import { I18nProvider, createI18n } from "../src/i18n";

const i18n = createI18n("en");

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider value={i18n}>{ui}</I18nProvider>);
}

const folders = [
  { id: "inbox", name: "Inbox", count: 3 },
  { id: "work", name: "Work", count: 5 },
];

describe("Sidebar", () => {
  it("renders folder list with counts", () => {
    renderWithI18n(
      <Sidebar
        folders={folders}
        activeFolderId="inbox"
        searchQuery=""
        onSearchChange={() => {}}
        onSelectFolder={() => {}}
        onCreateFolder={() => {}}
      />
    );
    expect(screen.getByText("Inbox")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("calls onSelectFolder when a folder is clicked", () => {
    const onSelect = vi.fn();
    renderWithI18n(
      <Sidebar
        folders={folders}
        activeFolderId="inbox"
        searchQuery=""
        onSearchChange={() => {}}
        onSelectFolder={onSelect}
        onCreateFolder={() => {}}
      />
    );
    fireEvent.click(screen.getByText("Work"));
    expect(onSelect).toHaveBeenCalledWith("work");
  });

  it("calls onSearchChange when typing in search", () => {
    const onSearch = vi.fn();
    renderWithI18n(
      <Sidebar
        folders={folders}
        activeFolderId="inbox"
        searchQuery=""
        onSearchChange={onSearch}
        onSelectFolder={() => {}}
        onCreateFolder={() => {}}
      />
    );
    const input = screen.getByPlaceholderText("Search");
    fireEvent.change(input, { target: { value: "test" } });
    expect(onSearch).toHaveBeenCalledWith("test");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run test/sidebar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement Sidebar component**

```tsx
// apps/web/src/components/desktop/Sidebar.tsx
import { useI18n } from "../../i18n";
import { FolderIcon, PlusIcon, SearchIcon } from "../shared/Icons";

type FolderWithCount = {
  id: string;
  name: string;
  count: number;
};

type SidebarProps = {
  folders: FolderWithCount[];
  activeFolderId: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSelectFolder: (folderId: string) => void;
  onCreateFolder: () => void;
};

export function Sidebar({
  folders,
  activeFolderId,
  searchQuery,
  onSearchChange,
  onSelectFolder,
  onCreateFolder,
}: SidebarProps) {
  const { t } = useI18n();

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">{t("sidebar.title")}</span>
        <button className="sidebar-btn" title={t("sidebar.newFolder")} onClick={onCreateFolder}>
          <PlusIcon />
        </button>
      </div>
      <div className="sidebar-search">
        <SearchIcon />
        <input
          placeholder={t("sidebar.search")}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="sidebar-scroll">
        {folders.map((folder) => (
          <div
            key={folder.id}
            className={`folder-item${activeFolderId === folder.id ? " active" : ""}`}
            onClick={() => onSelectFolder(folder.id)}
          >
            <div className="folder-icon">
              <FolderIcon color={activeFolderId === folder.id ? "white" : "#007AFF"} />
            </div>
            <span className="folder-name">{folder.name}</span>
            <span className="folder-count">{folder.count}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run test/sidebar.test.tsx`
Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/desktop/Sidebar.tsx apps/web/test/sidebar.test.tsx
git commit -m "feat: add Sidebar component with folder list and search"
```

---

### Task 8: NoteList component with search highlighting

**Files:**
- Create: `apps/web/src/components/desktop/NoteList.tsx`
- Create: `apps/web/test/note-list.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/test/note-list.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { NoteList } from "../src/components/desktop/NoteList";
import { I18nProvider, createI18n } from "../src/i18n";

const i18n = createI18n("en");

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider value={i18n}>{ui}</I18nProvider>);
}

const sections = [
  {
    label: "Last 7 Days",
    items: [
      { id: "n1", title: "Test Note", preview: "This is a preview", date: "10:30 AM", folderName: "Inbox" },
      { id: "n2", title: "Another Note", preview: "Another preview", date: "9:00 AM", folderName: "Work" },
    ],
  },
];

describe("NoteList", () => {
  it("renders note cards with titles and previews", () => {
    renderWithI18n(
      <NoteList
        folderName="Inbox"
        noteCount={2}
        sections={sections}
        activeNoteId="n1"
        searchQuery=""
        newNoteId={null}
        onSelectNote={() => {}}
        onCreateNote={() => {}}
      />
    );
    expect(screen.getByText("Test Note")).toBeInTheDocument();
    expect(screen.getByText("This is a preview")).toBeInTheDocument();
    expect(screen.getByText("Another Note")).toBeInTheDocument();
  });

  it("calls onSelectNote when a card is clicked", () => {
    const onSelect = vi.fn();
    renderWithI18n(
      <NoteList
        folderName="Inbox"
        noteCount={2}
        sections={sections}
        activeNoteId="n1"
        searchQuery=""
        newNoteId={null}
        onSelectNote={onSelect}
        onCreateNote={() => {}}
      />
    );
    fireEvent.click(screen.getByText("Another Note"));
    expect(onSelect).toHaveBeenCalledWith("n2");
  });

  it("highlights search query in previews", () => {
    const searchSections = [
      {
        label: "Last 7 Days",
        items: [
          { id: "n1", title: "Test Note", preview: "contains async keyword here", date: "10:30 AM", folderName: "Inbox" },
        ],
      },
    ];
    const { container } = renderWithI18n(
      <NoteList
        folderName="Search results"
        noteCount={1}
        sections={searchSections}
        activeNoteId=""
        searchQuery="async"
        newNoteId={null}
        onSelectNote={() => {}}
        onCreateNote={() => {}}
      />
    );
    const mark = container.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark?.textContent).toBe("async");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run test/note-list.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement NoteList component**

```tsx
// apps/web/src/components/desktop/NoteList.tsx
import type { ReactNode } from "react";
import { useI18n } from "../../i18n";
import { ComposeIcon, MoreIcon } from "../shared/Icons";

type NoteItem = {
  id: string;
  title: string;
  preview: string;
  date: string;
  folderName?: string;
};

type NoteSection = {
  label: string;
  items: NoteItem[];
};

type NoteListProps = {
  folderName: string;
  noteCount: number;
  sections: NoteSection[];
  activeNoteId: string;
  searchQuery: string;
  newNoteId: string | null;
  onSelectNote: (noteId: string) => void;
  onCreateNote: () => void;
};

function highlightText(text: string, query: string): ReactNode {
  if (!query) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return text;

  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export function NoteList({
  folderName,
  noteCount,
  sections,
  activeNoteId,
  searchQuery,
  newNoteId,
  onSelectNote,
  onCreateNote,
}: NoteListProps) {
  const { t } = useI18n();

  return (
    <section className="note-list">
      <div className="note-list-header">
        <div>
          <div className="note-list-title">{folderName}</div>
          <div className="note-list-meta">{t("noteList.count", { n: noteCount })}</div>
        </div>
        <div className="note-list-actions">
          <button className="icon-btn" title={t("noteList.newNote")} onClick={onCreateNote}>
            <ComposeIcon />
          </button>
          <button className="icon-btn">
            <MoreIcon />
          </button>
        </div>
      </div>
      <div className="note-list-scroll">
        {sections.length === 0 && (
          <div style={{ padding: "40px 14px", textAlign: "center", color: "var(--text-tertiary)", fontSize: 14 }}>
            {t("noteList.empty")}
          </div>
        )}
        {sections.map((section) => (
          <div key={section.label}>
            <div className="note-group-label">{section.label}</div>
            {section.items.map((note) => (
              <div
                key={note.id}
                className={`note-card${activeNoteId === note.id ? " active" : ""}${note.id === newNoteId ? " note-card-new" : ""}`}
                onClick={() => onSelectNote(note.id)}
              >
                <div className="note-card-text">
                  <div className="note-card-title">{highlightText(note.title, searchQuery)}</div>
                  <div className="note-card-date">{note.date}</div>
                  <div className="note-card-preview">{highlightText(note.preview, searchQuery)}</div>
                  {note.folderName && (
                    <div className="note-card-tag">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <rect x="1" y="2" width="8" height="6" rx="1" stroke="currentColor" strokeWidth="1" />
                      </svg>
                      {note.folderName}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run test/note-list.test.tsx`
Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/desktop/NoteList.tsx apps/web/test/note-list.test.tsx
git commit -m "feat: add NoteList component with search keyword highlighting"
```

---

### Task 9: Desktop Editor pane (without CodeMirror Live Preview)

**Files:**
- Create: `apps/web/src/components/desktop/Editor.tsx`

This task creates the Editor pane shell (meta bar, sync badge, empty state). The CodeMirror Live Preview editor is wired in Task 11.

- [ ] **Step 1: Create Editor component**

```tsx
// apps/web/src/components/desktop/Editor.tsx
import { useI18n } from "../../i18n";
import { EmptyNoteIcon, SyncIcon } from "../shared/Icons";
import type { SyncStatus, WorkspaceNote } from "../../lib/storage";
import { MarkeanEditor } from "../editor/MarkeanEditor";

type EditorProps = {
  note: WorkspaceNote | null;
  syncStatus: SyncStatus;
  onChangeBody: (body: string) => void;
};

function formatModifiedDate(isoString: string, locale: string): string {
  return new Intl.DateTimeFormat(locale.startsWith("zh") ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoString));
}

export function Editor({ note, syncStatus, onChangeBody }: EditorProps) {
  const { t, locale } = useI18n();

  if (!note) {
    return (
      <div className="editor-pane">
        <div className="no-note">
          <EmptyNoteIcon />
          <span>{t("editor.noSelection")}</span>
          <span style={{ fontSize: 13, color: "var(--text-tertiary)" }}>{t("editor.noSelectionHint")}</span>
        </div>
      </div>
    );
  }

  const syncLabel = syncStatus === "syncing" ? t("editor.syncing") : syncStatus === "unsynced" ? t("editor.unsynced") : t("editor.synced");

  return (
    <div className="editor-pane">
      <div className="editor-meta">
        <span>{formatModifiedDate(note.updatedAt, locale)}</span>
        <span className="sync-badge">
          <SyncIcon />
          {syncLabel}
        </span>
      </div>
      <div className="editor-scroll">
        <MarkeanEditor key={note.id} content={note.body} onChange={onChangeBody} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/desktop/Editor.tsx
git commit -m "feat: add Editor pane with meta bar and sync badge"
```

---

### Task 10: CodeMirror 6 Live Preview plugin

**Files:**
- Create: `apps/web/src/components/editor/live-preview.ts`
- Create: `apps/web/src/styles/editor.css`

This is the core Live Preview logic: a `ViewPlugin` that creates `Decoration.replace` entries to hide Markdown syntax on non-cursor lines, and applies CSS classes for rendered styling.

- [ ] **Step 1: Create editor CSS**

```css
/* apps/web/src/styles/editor.css */

/* CodeMirror base overrides */
.cm-editor {
  height: 100%;
  outline: none !important;
  font-family: var(--font);
  font-size: 15px;
}
.cm-editor.cm-focused { outline: none; }
.cm-content { padding: 0; caret-color: var(--accent); }
.cm-line { padding: 0; line-height: 1.65; }
.cm-scroller { overflow-x: hidden; }
.cm-gutters { display: none; }

/* Live Preview rendered styles — applied via Decoration.mark classes */
.cm-md-h1 { font-size: 28px; font-weight: 700; line-height: 1.25; letter-spacing: -0.5px; padding: 6px 0 2px; }
.cm-md-h2 { font-size: 22px; font-weight: 700; line-height: 1.3; letter-spacing: -0.3px; padding: 4px 0 2px; }
.cm-md-h3 { font-size: 18px; font-weight: 600; line-height: 1.35; padding: 3px 0 1px; }
.cm-md-bold { font-weight: 700; }
.cm-md-italic { font-style: italic; }
.cm-md-strikethrough { text-decoration: line-through; color: var(--text-secondary); }
.cm-md-code {
  background: rgba(118,118,128,0.12);
  color: var(--accent);
  border-radius: 4px;
  padding: 1px 5px;
  font-family: var(--font-mono);
  font-size: 13px;
}
.cm-md-blockquote {
  border-left: 3px solid var(--accent);
  padding-left: 12px;
  color: var(--text-secondary);
}
.cm-md-hr {
  display: block;
  border: none;
  border-top: 1px solid var(--sep-strong);
  margin: 4px 0;
}
.cm-md-list-bullet::before {
  content: "•";
  color: var(--text-secondary);
  margin-right: 8px;
}
.cm-md-hidden { display: none; }

/* Code block */
.cm-md-codeblock-line {
  background: #1C1C1E;
  color: #E5E5EA;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
  padding: 0 16px;
}
.cm-md-codeblock-first {
  border-radius: 10px 10px 0 0;
  padding-top: 14px;
}
.cm-md-codeblock-last {
  border-radius: 0 0 10px 10px;
  padding-bottom: 14px;
}
.cm-md-codeblock-single {
  border-radius: 10px;
  padding-top: 14px;
  padding-bottom: 14px;
}

/* Editor content wrapper */
.editor-content { max-width: 680px; margin: 0 auto; }
```

- [ ] **Step 2: Create Live Preview plugin**

```ts
// apps/web/src/components/editor/live-preview.ts
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { EditorState, Range } from "@codemirror/state";

class HrWidget extends WidgetType {
  toDOM() {
    const hr = document.createElement("hr");
    hr.className = "cm-md-hr";
    return hr;
  }
}

function isCursorInRange(state: EditorState, from: number, to: number): boolean {
  for (const range of state.selection.ranges) {
    const lineFrom = state.doc.lineAt(from).number;
    const lineTo = state.doc.lineAt(to).number;
    const cursorLine = state.doc.lineAt(range.head).number;
    if (cursorLine >= lineFrom && cursorLine <= lineTo) return true;
  }
  return false;
}

function buildDecorations(state: EditorState): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const doc = state.doc;

  let inCodeBlock = false;
  let codeBlockStart = -1;

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const text = line.text;

    // Code block fences
    if (text.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockStart = i;
      } else {
        inCodeBlock = false;
        // If cursor is inside the code block, don't decorate
        if (!isCursorInRange(state, doc.line(codeBlockStart).from, line.to)) {
          // Hide opening fence
          decorations.push(Decoration.replace({}).range(doc.line(codeBlockStart).from, doc.line(codeBlockStart).to));
          // Style code lines
          for (let j = codeBlockStart + 1; j < i; j++) {
            const codeLine = doc.line(j);
            const isFirst = j === codeBlockStart + 1;
            const isLast = j === i - 1;
            let cls = "cm-md-codeblock-line";
            if (isFirst && isLast) cls += " cm-md-codeblock-single";
            else if (isFirst) cls += " cm-md-codeblock-first";
            else if (isLast) cls += " cm-md-codeblock-last";
            decorations.push(Decoration.line({ class: cls }).range(codeLine.from));
          }
          // Hide closing fence
          decorations.push(Decoration.replace({}).range(line.from, line.to));
        }
      }
      continue;
    }

    if (inCodeBlock) continue;

    // Skip cursor line
    if (isCursorInRange(state, line.from, line.to)) continue;

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(text.trim())) {
      decorations.push(Decoration.replace({ widget: new HrWidget() }).range(line.from, line.to));
      continue;
    }

    // Headings — hide the # prefix
    const headingMatch = text.match(/^(#{1,3}) /);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const cls = `cm-md-h${level}`;
      // Hide "# " prefix
      decorations.push(Decoration.replace({}).range(line.from, line.from + level + 1));
      // Style the rest of the line
      decorations.push(Decoration.line({ class: cls }).range(line.from));
      continue;
    }

    // Blockquote — hide "> "
    if (text.startsWith("> ")) {
      decorations.push(Decoration.replace({}).range(line.from, line.from + 2));
      decorations.push(Decoration.line({ class: "cm-md-blockquote" }).range(line.from));
      continue;
    }

    // Unordered list — hide "- " or "* ", add bullet class
    if (/^[-*] /.test(text)) {
      decorations.push(Decoration.replace({}).range(line.from, line.from + 2));
      decorations.push(Decoration.line({ class: "cm-md-list-bullet" }).range(line.from));
      continue;
    }

    // Ordered list — hide "N. " prefix
    const oliMatch = text.match(/^(\d+)\. /);
    if (oliMatch) {
      const prefixLen = oliMatch[0].length;
      decorations.push(Decoration.replace({ widget: new OliWidget(oliMatch[1]) }).range(line.from, line.from + prefixLen));
      continue;
    }

    // Inline formatting within a line
    addInlineDecorations(text, line.from, decorations);
  }

  return Decoration.set(decorations, true);
}

class OliWidget extends WidgetType {
  constructor(private num: string) { super(); }
  toDOM() {
    const span = document.createElement("span");
    span.textContent = `${this.num}. `;
    span.style.color = "var(--text-secondary)";
    span.style.marginRight = "4px";
    return span;
  }
}

function addInlineDecorations(text: string, lineFrom: number, decorations: Range<Decoration>[]) {
  // Bold **text**
  const boldRe = /\*\*(.+?)\*\*/g;
  let m: RegExpExecArray | null;
  while ((m = boldRe.exec(text)) !== null) {
    // Hide opening **
    decorations.push(Decoration.replace({}).range(lineFrom + m.index, lineFrom + m.index + 2));
    // Mark content as bold
    decorations.push(Decoration.mark({ class: "cm-md-bold" }).range(lineFrom + m.index + 2, lineFrom + m.index + m[0].length - 2));
    // Hide closing **
    decorations.push(Decoration.replace({}).range(lineFrom + m.index + m[0].length - 2, lineFrom + m.index + m[0].length));
  }

  // Italic *text* (but not **)
  const italicRe = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g;
  while ((m = italicRe.exec(text)) !== null) {
    decorations.push(Decoration.replace({}).range(lineFrom + m.index, lineFrom + m.index + 1));
    decorations.push(Decoration.mark({ class: "cm-md-italic" }).range(lineFrom + m.index + 1, lineFrom + m.index + m[0].length - 1));
    decorations.push(Decoration.replace({}).range(lineFrom + m.index + m[0].length - 1, lineFrom + m.index + m[0].length));
  }

  // Strikethrough ~~text~~
  const strikeRe = /~~(.+?)~~/g;
  while ((m = strikeRe.exec(text)) !== null) {
    decorations.push(Decoration.replace({}).range(lineFrom + m.index, lineFrom + m.index + 2));
    decorations.push(Decoration.mark({ class: "cm-md-strikethrough" }).range(lineFrom + m.index + 2, lineFrom + m.index + m[0].length - 2));
    decorations.push(Decoration.replace({}).range(lineFrom + m.index + m[0].length - 2, lineFrom + m.index + m[0].length));
  }

  // Inline code `text`
  const codeRe = /`([^`]+)`/g;
  while ((m = codeRe.exec(text)) !== null) {
    decorations.push(Decoration.replace({}).range(lineFrom + m.index, lineFrom + m.index + 1));
    decorations.push(Decoration.mark({ class: "cm-md-code" }).range(lineFrom + m.index + 1, lineFrom + m.index + m[0].length - 1));
    decorations.push(Decoration.replace({}).range(lineFrom + m.index + m[0].length - 1, lineFrom + m.index + m[0].length));
  }
}

export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet) {
        this.decorations = buildDecorations(update.state);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/editor/live-preview.ts apps/web/src/styles/editor.css
git commit -m "feat: add CodeMirror 6 Live Preview plugin with Markdown decoration"
```

---

### Task 11: MarkeanEditor wrapper component

**Files:**
- Create: `apps/web/src/components/editor/MarkeanEditor.tsx`

- [ ] **Step 1: Create MarkeanEditor component**

```tsx
// apps/web/src/components/editor/MarkeanEditor.tsx
import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { livePreviewPlugin } from "./live-preview";

type MarkeanEditorProps = {
  content: string;
  onChange: (content: string) => void;
};

export function MarkeanEditor({ content, onChange }: MarkeanEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView>();
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: content,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        livePreviewPlugin,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && onChangeRef.current) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => view.destroy();
    // Only create the editor once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="editor-content" />;
}
```

- [ ] **Step 2: Verify the app compiles**

Run: `cd apps/web && npx vite build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/editor/MarkeanEditor.tsx
git commit -m "feat: add MarkeanEditor wrapper for CodeMirror 6 with Live Preview"
```

---

### Task 12: Mobile CSS styles

**Files:**
- Create: `apps/web/src/styles/mobile.css`

- [ ] **Step 1: Create mobile styles**

```css
/* apps/web/src/styles/mobile.css */

.mobile-app {
  height: 100vh; overflow: hidden;
  display: flex; flex-direction: column;
  background: var(--bg-sidebar);
}
.mobile-nav {
  background: rgba(242,242,247,0.9);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--sep);
  padding: 0 16px;
  padding-top: env(safe-area-inset-top, 44px);
  min-height: 44px;
  display: flex; align-items: center;
  justify-content: space-between;
  position: sticky; top: 0; z-index: 10;
}
.mobile-nav-back {
  display: flex; align-items: center; gap: 2px;
  font-size: 17px; color: var(--accent);
  background: none; border: none; cursor: pointer;
  font-family: var(--font);
}
.mobile-nav-title {
  font-size: 17px; font-weight: 600;
  position: absolute; left: 50%; transform: translateX(-50%);
}
.mobile-nav-actions { display: flex; gap: 8px; }
.mobile-page { flex: 1; overflow-y: auto; }
.mobile-page-title { font-size: 28px; font-weight: 700; padding: 16px 16px 4px; }
.mobile-page-count { font-size: 14px; color: var(--text-secondary); padding: 0 16px 12px; }
.mobile-folder-group { padding: 0 16px 16px; }
.mobile-folder-group-label { font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; }
.mobile-folder-card {
  background: white; border-radius: var(--radius);
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.mobile-folder-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--sep);
  cursor: pointer; transition: background .1s;
  -webkit-tap-highlight-color: transparent;
}
.mobile-folder-row:last-child { border-bottom: none; }
.mobile-folder-row:active { background: rgba(0,0,0,0.06); }
.mobile-folder-row-name { flex: 1; font-size: 16px; }
.mobile-folder-row-count { font-size: 16px; color: var(--text-tertiary); }
.mobile-folder-row-chevron { color: var(--text-tertiary); font-size: 14px; }
.mobile-note-group-label {
  font-size: 14px; font-weight: 600; color: var(--text-secondary);
  padding: 14px 16px 6px;
}
.mobile-note-card {
  background: white; border-radius: var(--radius);
  margin: 4px 16px;
  padding: 12px 14px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.mobile-note-card:active { opacity: 0.7; }
.mobile-note-card-title { font-size: 15px; font-weight: 600; margin-bottom: 3px; }
.mobile-note-card-meta { font-size: 13px; color: var(--text-secondary); margin-bottom: 3px; }
.mobile-note-card-preview {
  font-size: 13px; color: var(--text-tertiary);
  line-height: 1.4; overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.mobile-editor { flex: 1; overflow-y: auto; padding: 16px 20px 60px; }
.mobile-bottom-bar {
  position: fixed; bottom: 0; left: 0; right: 0;
  background: rgba(242,242,247,0.9);
  backdrop-filter: blur(10px);
  border-top: 1px solid var(--sep);
  padding: 8px 20px;
  padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
  display: flex; align-items: center; gap: 12px;
}
.mobile-search-bar {
  flex: 1;
  background: rgba(118,118,128,0.12);
  border-radius: 10px;
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px;
}
.mobile-search-bar input {
  border: none; background: none; outline: none;
  font-family: var(--font); font-size: 15px;
  color: var(--text-primary); width: 100%;
}
.mobile-search-bar input::placeholder { color: var(--text-tertiary); }
.mobile-compose-btn {
  width: 40px; height: 40px; border-radius: 50%;
  background: none; border: none;
  color: var(--accent); font-size: 22px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/styles/mobile.css
git commit -m "feat: add mobile layout CSS"
```

---

### Task 13: Mobile components

**Files:**
- Create: `apps/web/src/components/mobile/MobileFolders.tsx`
- Create: `apps/web/src/components/mobile/MobileNoteList.tsx`
- Create: `apps/web/src/components/mobile/MobileEditor.tsx`

- [ ] **Step 1: Create MobileFolders**

```tsx
// apps/web/src/components/mobile/MobileFolders.tsx
import { useI18n } from "../../i18n";
import { FolderIcon, ChevronIcon, SearchIcon, ComposeIcon } from "../shared/Icons";

type FolderWithCount = { id: string; name: string; count: number };

type MobileFoldersProps = {
  folders: FolderWithCount[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSelectFolder: (folderId: string) => void;
  onCreateNote: () => void;
};

export function MobileFolders({ folders, searchQuery, onSearchChange, onSelectFolder, onCreateNote }: MobileFoldersProps) {
  const { t } = useI18n();

  return (
    <div className="mobile-app">
      <div className="mobile-page" style={{ paddingBottom: 80 }}>
        <div className="mobile-page-title">{t("mobile.folders")}</div>
        <div style={{ height: 16 }} />
        <div className="mobile-folder-group">
          <div className="mobile-folder-group-label">iCloud</div>
          <div className="mobile-folder-card">
            {folders.map((f, i) => (
              <div
                key={f.id}
                className="mobile-folder-row"
                onClick={() => onSelectFolder(f.id)}
                style={i === folders.length - 1 ? { borderBottom: "none" } : {}}
              >
                <div style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <FolderIcon />
                </div>
                <span className="mobile-folder-row-name">{f.name}</span>
                <span className="mobile-folder-row-count">{f.count}</span>
                <span className="mobile-folder-row-chevron"><ChevronIcon /></span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mobile-bottom-bar">
        <div className="mobile-search-bar">
          <SearchIcon size={14} />
          <input
            placeholder={t("sidebar.search")}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <button className="mobile-compose-btn" onClick={onCreateNote}><ComposeIcon /></button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create MobileNoteList**

```tsx
// apps/web/src/components/mobile/MobileNoteList.tsx
import { useI18n } from "../../i18n";
import { BackIcon, MoreIcon, SearchIcon, ComposeIcon } from "../shared/Icons";

type NoteItem = { id: string; title: string; preview: string; date: string };
type NoteSection = { label: string; items: NoteItem[] };

type MobileNoteListProps = {
  folderName: string;
  noteCount: number;
  sections: NoteSection[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onBack: () => void;
  onSelectNote: (noteId: string) => void;
  onCreateNote: () => void;
};

export function MobileNoteList({ folderName, noteCount, sections, searchQuery, onSearchChange, onBack, onSelectNote, onCreateNote }: MobileNoteListProps) {
  const { t } = useI18n();

  return (
    <div className="mobile-app">
      <div className="mobile-nav">
        <button className="mobile-nav-back" onClick={onBack}>
          <BackIcon /><span style={{ marginLeft: 4 }}>{t("mobile.folders")}</span>
        </button>
        <span className="mobile-nav-title">{folderName}</span>
        <div className="mobile-nav-actions">
          <button className="icon-btn"><MoreIcon /></button>
        </div>
      </div>
      <div className="mobile-page" style={{ paddingBottom: 80 }}>
        <div className="mobile-page-title">{folderName}</div>
        <div className="mobile-page-count">{t("noteList.count", { n: noteCount })}</div>
        {sections.map(({ label, items }) => (
          <div key={label}>
            <div className="mobile-note-group-label">{label}</div>
            {items.map((note) => (
              <div key={note.id} className="mobile-note-card" onClick={() => onSelectNote(note.id)}>
                <div className="mobile-note-card-title">{note.title}</div>
                <div className="mobile-note-card-meta">{note.date}</div>
                <div className="mobile-note-card-preview">{note.preview}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="mobile-bottom-bar">
        <div className="mobile-search-bar">
          <SearchIcon size={14} />
          <input
            placeholder={t("sidebar.search")}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <button className="mobile-compose-btn" onClick={onCreateNote}><ComposeIcon /></button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create MobileEditor**

```tsx
// apps/web/src/components/mobile/MobileEditor.tsx
import { useI18n } from "../../i18n";
import { BackIcon } from "../shared/Icons";
import { MarkeanEditor } from "../editor/MarkeanEditor";
import type { WorkspaceNote } from "../../lib/storage";

type MobileEditorProps = {
  note: WorkspaceNote;
  folderName: string;
  onBack: () => void;
  onChangeBody: (body: string) => void;
};

export function MobileEditor({ note, folderName, onBack, onChangeBody }: MobileEditorProps) {
  const { t } = useI18n();

  return (
    <div className="mobile-app">
      <div className="mobile-nav">
        <button className="mobile-nav-back" onClick={onBack}>
          <BackIcon /><span style={{ marginLeft: 4 }}>{folderName}</span>
        </button>
        <div className="mobile-nav-actions">
          <button className="icon-btn" style={{ color: "var(--accent)", fontSize: 13 }}>{t("mobile.done")}</button>
        </div>
      </div>
      <div className="mobile-editor">
        <MarkeanEditor key={note.id} content={note.body} onChange={onChangeBody} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/mobile/
git commit -m "feat: add mobile components (folders, note list, editor)"
```

---

### Task 14: App.tsx — wire everything together

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/index.html`

- [ ] **Step 1: Write App.tsx with full state management**

```tsx
// apps/web/src/App.tsx
import { useEffect, useMemo, useState, useDeferredValue } from "react";
import {
  getDraft,
  getSyncStatus,
  getWorkspaceSnapshot,
  saveDraft,
  saveWorkspaceSnapshot,
  setSyncStatus,
  subscribeToStorageState,
  type SyncStatus,
  type WorkspaceFolder,
  type WorkspaceNote,
  type WorkspaceSnapshot,
} from "./lib/storage";
import { startBackgroundSync } from "./lib/sync";
import { createI18n, detectLocale, I18nProvider } from "./i18n";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { getWelcomeNote } from "./components/shared/WelcomeNote";
import { Sidebar } from "./components/desktop/Sidebar";
import { NoteList } from "./components/desktop/NoteList";
import { Editor } from "./components/desktop/Editor";
import { MobileFolders } from "./components/mobile/MobileFolders";
import { MobileNoteList } from "./components/mobile/MobileNoteList";
import { MobileEditor } from "./components/mobile/MobileEditor";

// --- Helpers (ported from old AppShell.tsx) ---

function createId(prefix: "folder" | "note") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatNoteTitle(note: WorkspaceNote) {
  const trimmed = note.title.trim();
  if (trimmed) return trimmed;
  const bodyHeadline = note.body
    .split(/\n+/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean);
  return bodyHeadline ?? "Untitled note";
}

function summarizeNote(body: string) {
  const summary = body.replace(/^#+\s*/gm, "").replace(/\s+/g, " ").trim();
  if (!summary) return "";
  return summary.length > 96 ? `${summary.slice(0, 96).trimEnd()}...` : summary;
}

function extractSearchPreview(body: string, query: string): string {
  if (!query) return summarizeNote(body);
  const lower = body.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return summarizeNote(body);
  const start = Math.max(0, idx - 40);
  const end = Math.min(body.length, idx + query.length + 40);
  const slice = body.slice(start, end).replace(/\s+/g, " ");
  return (start > 0 ? "..." : "") + slice + (end < body.length ? "..." : "");
}

function formatTimeLabel(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale.startsWith("zh") ? "zh-CN" : "en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateLabel(value: string, locale: string, t: (key: string) => string) {
  const date = new Date(value);
  const now = new Date();
  const diffDays = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) /
      86_400_000,
  );
  if (diffDays < 7) return t("noteList.group.7d");
  if (diffDays < 30) return t("noteList.group.30d");
  return t("noteList.group.older");
}

function sortNotes(notes: WorkspaceNote[]) {
  return [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// --- Workspace initialization ---

const defaultLocale = detectLocale();

function buildDefaultWorkspace(): WorkspaceSnapshot {
  const welcome = getWelcomeNote(defaultLocale);
  const defaultFolder: WorkspaceFolder = { id: "default", name: defaultLocale.startsWith("zh") ? "笔记" : "Notes" };
  const welcomeNote: WorkspaceNote = {
    id: "note-welcome",
    folderId: "default",
    title: welcome.title,
    body: getDraft("note-welcome", welcome.body),
    updatedAt: new Date().toISOString(),
  };

  return {
    folders: [defaultFolder],
    notes: [welcomeNote],
    activeFolderId: "default",
    activeNoteId: "note-welcome",
  };
}

function normalizeWorkspace(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const folders = snapshot.folders.length > 0 ? snapshot.folders : buildDefaultWorkspace().folders;
  const notes = snapshot.notes.map((note) => ({
    ...note,
    body: getDraft(note.id, note.body),
    updatedAt: typeof note.updatedAt === "string" && note.updatedAt.length > 0 ? note.updatedAt : new Date().toISOString(),
  }));
  const activeFolderId = folders.some((f) => f.id === snapshot.activeFolderId) ? snapshot.activeFolderId : folders[0]?.id ?? "";
  const activeNoteId = notes.some((n) => n.id === snapshot.activeNoteId)
    ? snapshot.activeNoteId
    : notes.find((n) => n.folderId === activeFolderId)?.id ?? notes[0]?.id ?? "";

  return { folders, notes, activeFolderId, activeNoteId };
}

function loadWorkspace() {
  const persisted = getWorkspaceSnapshot();
  return normalizeWorkspace(persisted ?? buildDefaultWorkspace());
}

// --- Main App ---

type MobileView = "folders" | "notes" | "editor";

export function App() {
  const i18n = useMemo(() => createI18n(defaultLocale), []);
  const isMobile = useMediaQuery("(max-width: 768px)");

  const [workspace, setWorkspace] = useState(loadWorkspace);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredQuery = useDeferredValue(searchQuery.trim().toLowerCase());
  const [mobileView, setMobileView] = useState<MobileView>("folders");
  const [newNoteId, setNewNoteId] = useState<string | null>(null);
  const [syncStatus, setSyncStatusLocal] = useState<SyncStatus>(getSyncStatus);

  // Persist workspace
  useEffect(() => { saveWorkspaceSnapshot(workspace); }, [workspace]);

  // Background sync
  useEffect(() => {
    return startBackgroundSync(async () => {
      if (!navigator.onLine || getSyncStatus() !== "unsynced") return;
      setSyncStatus("syncing");
      await Promise.resolve();
      setSyncStatus("idle");
    });
  }, []);

  // Listen to sync status changes
  useEffect(() => subscribeToStorageState(() => setSyncStatusLocal(getSyncStatus())), []);

  // --- Derived state ---
  const folderNameById = new Map(workspace.folders.map((f) => [f.id, f.name]));
  const folders = workspace.folders.map((f) => ({
    ...f,
    count: workspace.notes.filter((n) => n.folderId === f.id).length,
  }));
  const activeFolder = workspace.folders.find((f) => f.id === workspace.activeFolderId) ?? workspace.folders[0] ?? null;
  const notesInScope = deferredQuery
    ? workspace.notes.filter((n) => {
        const haystack = `${n.title}\n${n.body}`.toLowerCase();
        return haystack.includes(deferredQuery);
      })
    : workspace.notes.filter((n) => n.folderId === activeFolder?.id);
  const activeNote = workspace.notes.find((n) => n.id === workspace.activeNoteId) ?? sortNotes(notesInScope)[0] ?? null;

  // Build sections for NoteList
  const sections = useMemo(() => {
    const groups = new Map<string, Array<{ id: string; title: string; preview: string; date: string; folderName?: string }>>();
    for (const note of sortNotes(notesInScope)) {
      const label = formatDateLabel(note.updatedAt, i18n.locale, i18n.t);
      const items = groups.get(label) ?? [];
      items.push({
        id: note.id,
        title: formatNoteTitle(note),
        preview: deferredQuery ? extractSearchPreview(note.body, deferredQuery) : summarizeNote(note.body),
        date: formatTimeLabel(note.updatedAt, i18n.locale),
        folderName: deferredQuery ? folderNameById.get(note.folderId) : undefined,
      });
      groups.set(label, items);
    }
    return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
  }, [notesInScope, deferredQuery, i18n.locale, i18n.t, folderNameById]);

  // --- Handlers ---
  const handleSelectFolder = (folderId: string) => {
    setWorkspace((c) => {
      const next = sortNotes(c.notes.filter((n) => n.folderId === folderId));
      return { ...c, activeFolderId: folderId, activeNoteId: next[0]?.id ?? "" };
    });
    setSearchQuery("");
    if (isMobile) setMobileView("notes");
  };

  const handleCreateFolder = () => {
    const name = window.prompt(i18n.t("sidebar.newFolder"), i18n.locale.startsWith("zh") ? "新文件夹" : "New Folder")?.trim();
    if (!name) return;
    const folderId = createId("folder");
    setWorkspace((c) => ({
      ...c,
      folders: [{ id: folderId, name }, ...c.folders],
      activeFolderId: folderId,
      activeNoteId: "",
    }));
    setSyncStatus("unsynced");
  };

  const handleCreateNote = () => {
    const folderId = workspace.activeFolderId || workspace.folders[0]?.id;
    if (!folderId) return;
    const noteId = createId("note");
    const now = new Date().toISOString();
    saveDraft(noteId, "");
    setWorkspace((c) => ({
      ...c,
      activeFolderId: folderId,
      activeNoteId: noteId,
      notes: [{ id: noteId, folderId, title: "", body: "", updatedAt: now }, ...c.notes],
    }));
    setNewNoteId(noteId);
    setTimeout(() => setNewNoteId(null), 600);
    setSyncStatus("unsynced");
    if (isMobile) setMobileView("editor");
  };

  const handleSelectNote = (noteId: string) => {
    const note = workspace.notes.find((n) => n.id === noteId);
    setWorkspace((c) => ({
      ...c,
      activeFolderId: note?.folderId ?? c.activeFolderId,
      activeNoteId: noteId,
    }));
    if (isMobile) setMobileView("editor");
  };

  const handleChangeBody = (nextBody: string) => {
    if (!activeNote) return;
    saveDraft(activeNote.id, nextBody);
    setWorkspace((c) => ({
      ...c,
      notes: c.notes.map((n) =>
        n.id === activeNote.id
          ? { ...n, body: nextBody, title: formatNoteTitle({ ...n, body: nextBody }), updatedAt: new Date().toISOString() }
          : n,
      ),
    }));
    setSyncStatus("unsynced");
  };

  // --- Render ---
  if (isMobile) {
    return (
      <I18nProvider value={i18n}>
        {mobileView === "folders" && (
          <MobileFolders
            folders={folders}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onSelectFolder={handleSelectFolder}
            onCreateNote={handleCreateNote}
          />
        )}
        {mobileView === "notes" && (
          <MobileNoteList
            folderName={activeFolder?.name ?? ""}
            noteCount={notesInScope.length}
            sections={sections}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onBack={() => setMobileView("folders")}
            onSelectNote={handleSelectNote}
            onCreateNote={handleCreateNote}
          />
        )}
        {mobileView === "editor" && activeNote && (
          <MobileEditor
            note={activeNote}
            folderName={activeFolder?.name ?? ""}
            onBack={() => setMobileView("notes")}
            onChangeBody={handleChangeBody}
          />
        )}
      </I18nProvider>
    );
  }

  return (
    <I18nProvider value={i18n}>
      <div className="app">
        <Sidebar
          folders={folders}
          activeFolderId={activeFolder?.id ?? ""}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelectFolder={handleSelectFolder}
          onCreateFolder={handleCreateFolder}
        />
        <NoteList
          folderName={deferredQuery ? (i18n.locale.startsWith("zh") ? "搜索结果" : "Search results") : activeFolder?.name ?? ""}
          noteCount={notesInScope.length}
          sections={sections}
          activeNoteId={activeNote?.id ?? ""}
          searchQuery={deferredQuery}
          newNoteId={newNoteId}
          onSelectNote={handleSelectNote}
          onCreateNote={handleCreateNote}
        />
        <Editor note={activeNote} syncStatus={syncStatus} onChangeBody={handleChangeBody} />
      </div>
    </I18nProvider>
  );
}
```

- [ ] **Step 2: Update main.tsx to import all CSS**

```tsx
// apps/web/src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/variables.css";
import "./styles/desktop.css";
import "./styles/mobile.css";
import "./styles/editor.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js").catch(() => {});
}
```

- [ ] **Step 3: Update index.html lang and viewport**

```html
<!-- apps/web/index.html -->
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <title>Markean</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Verify the full app compiles**

Run: `cd apps/web && npx vite build`
Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/main.tsx apps/web/index.html
git commit -m "feat: wire App.tsx with all components, state management, and responsive layout"
```

---

### Task 15: App integration test

**Files:**
- Create: `apps/web/test/app.test.tsx`

- [ ] **Step 1: Write integration test**

```tsx
// apps/web/test/app.test.tsx
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, beforeEach } from "vitest";
import { App } from "../src/App";

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    // Mock matchMedia for desktop
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
  });

  it("renders the sidebar with Folders title", () => {
    render(<App />);
    // Default locale fallback is 'en' in test env
    expect(screen.getByText("Folders")).toBeInTheDocument();
  });

  it("renders the welcome note on first load", () => {
    render(<App />);
    expect(screen.getByText("Welcome to Markean")).toBeInTheDocument();
  });

  it("shows the search placeholder", () => {
    render(<App />);
    expect(screen.getByPlaceholderText("Search")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test**

Run: `cd apps/web && npx vitest run test/app.test.tsx`
Expected: All 3 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/test/app.test.tsx
git commit -m "test: add App integration tests for sidebar, welcome note, and search"
```

---

### Task 16: Run full test suite and type check

**Files:** None (verification only)

- [ ] **Step 1: Run all web tests**

Run: `cd apps/web && npx vitest run`
Expected: All tests pass.

- [ ] **Step 2: Run type check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Run full build**

Run: `cd apps/web && npx vite build`
Expected: Build succeeds.

- [ ] **Step 4: Clean up empty directories**

```bash
# Remove empty directories left from deletions
rmdir apps/web/src/app 2>/dev/null || true
rmdir apps/web/src/routes 2>/dev/null || true
rmdir apps/web/src/components/layout 2>/dev/null || true
```

- [ ] **Step 5: Final commit**

```bash
git add -A apps/web
git commit -m "chore: clean up empty directories and verify full build"
```

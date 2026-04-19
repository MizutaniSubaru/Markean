# Markean V1 Frontend Rewrite Design Spec

Date: 2026-04-19

## Overview

Based on the AI-generated Markean V1 HTML prototype, rewrite the `apps/web` frontend with an Apple Notes-inspired UI. The backend (Cloudflare Workers + Hono + D1 + Durable Objects) is preserved unchanged. Existing infrastructure in `apps/web/src/lib/` and shared packages (`@markean/domain`, `@markean/api-client`, `@markean/storage-web`, `@markean/sync-core`) is reused.

## Approach

Rewrite on top of the existing `apps/web` structure (Approach A):

- **Delete** old UI components: `AppShell.tsx`, `FoldersPane.tsx`, `NotesPane.tsx`, `EditorPane.tsx`, `LiveEditor.tsx`, `SyncBadge.tsx`, `icons.tsx`, `router.tsx`, `providers.tsx`, `app.css`
- **Delete** `routes/` directory (single-page app, no routing)
- **Keep** `lib/storage.ts`, `lib/sync.ts`, `lib/bootstrap.ts`, `state/app-store.ts`
- **Keep** all shared packages and backend unchanged

## File Structure

```
apps/web/src/
├── main.tsx                     # Entry, mount App
├── App.tsx                      # Top-level: state management + responsive switch
├── i18n/
│   ├── index.ts                 # i18n engine: language detection, t() function, React context
│   ├── zh.ts                    # Chinese translations
│   └── en.ts                    # English translations
├── components/
│   ├── desktop/
│   │   ├── Sidebar.tsx          # Folder sidebar (220px)
│   │   ├── NoteList.tsx         # Note list (300px)
│   │   └── Editor.tsx           # Editor pane (flex-1)
│   ├── mobile/
│   │   ├── MobileFolders.tsx    # Folder list page
│   │   ├── MobileNoteList.tsx   # Note list page
│   │   └── MobileEditor.tsx     # Editor page
│   ├── shared/
│   │   ├── Icons.tsx            # SVG icon components
│   │   └── WelcomeNote.ts      # Welcome note content (zh + en)
│   └── editor/
│       ├── MarkeanEditor.tsx    # CodeMirror 6 wrapper component
│       └── live-preview.ts     # Live Preview plugin (Decoration logic)
├── hooks/
│   └── useMediaQuery.ts         # Responsive breakpoint hook (768px)
├── styles/
│   ├── variables.css            # CSS variables, reset, scrollbar, font
│   ├── desktop.css              # Desktop three-pane layout, sidebar, note list, search highlight
│   ├── mobile.css               # Mobile nav, folder cards, note cards, bottom bar
│   └── editor.css               # CodeMirror 6 theme overrides, Live Preview rendered styles
├── lib/
│   ├── storage.ts               # KEEP: localStorage workspace snapshot, drafts
│   ├── sync.ts                  # KEEP: sync flow
│   └── bootstrap.ts             # KEEP: startup loading
└── state/
    └── app-store.ts             # KEEP: application state
```

## Desktop Layout

Three-pane layout via CSS flexbox:

```
┌──────────┬─────────────┬────────────────────────┐
│ Sidebar  │  NoteList   │       Editor           │
│  220px   │   300px     │      flex-1            │
│          │             │                        │
│ Folders  │ Notes by    │  CodeMirror 6          │
│ Search   │ date group  │  Live Preview mode     │
│ +Folder  │ +Note       │                        │
└──────────┴─────────────┴────────────────────────┘
```

### Sidebar (220px)

- Header: title + new folder button
- Search input (inline, not overlay)
- Folder list with icons and note count
- Active folder: `#007AFF` filled background, white text

### NoteList (300px)

- Header: folder name + note count + new note button
- Notes grouped by date: Last 7 Days / Last 30 Days / Older
- Note card: title, date, preview text, folder tag
- Active note: `rgba(0,122,255,0.12)` background
- New note pop-in animation

### Editor (flex-1)

- Meta bar: modification date + sync status badge
- CodeMirror 6 with Live Preview plugin
- Content area: `max-width: 680px`, centered
- Empty state: "Select a note to start editing"

## Mobile Layout

Three pages, switched by state (no routing). Breakpoint: `768px`.

1. **MobileFolders** — folder list, bottom search bar + compose button
2. **MobileNoteList** — back button + folder name, notes grouped by date, bottom bar
3. **MobileEditor** — back button + done button, CodeMirror 6 editor

Navigation: Folders → tap folder → NoteList → tap note → Editor. Each level has a back button.

## Search

Inline search, not overlay. Search box lives in Sidebar (desktop) and bottom bar (mobile).

### Flow

1. User types keyword in Sidebar search box, text stays in the box
2. NoteList switches to search results mode — shows matching notes across all folders
3. Each note card preview shows the **context paragraph containing the keyword**, with keyword **highlighted** (`<mark>`)
4. Clearing the search box restores NoteList to current folder view

### Implementation

- `useDeferredValue` for debouncing (already exists in codebase)
- Match against note `title` + `body`
- Preview extraction: find keyword position in body, extract ~40 chars before and after as context
- Highlight: wrap matched text with `<mark>` tag

## CodeMirror 6 Live Preview Editor

### Principle

Uses CodeMirror 6 `ViewPlugin` + `Decoration.replace/widget`:

- **Default**: hide Markdown syntax markers, show rendered styles
- **Cursor line**: show raw Markdown syntax for editing
- **Cursor leaves**: switch back to rendered state

### Supported Markdown Elements

| Syntax | Rendered Effect |
|--------|----------------|
| `# ` / `## ` / `### ` | Hide `#`, apply heading font size/weight |
| `**text**` | Hide `**`, show bold |
| `*text*` | Hide `*`, show italic |
| `` `code` `` | Hide backticks, show inline code style |
| `> ` | Hide `>`, show blockquote with blue left border |
| `- ` / `* ` | Hide marker, show bullet list |
| `1. ` | Hide marker, show ordered list |
| `---` | Render as horizontal rule |
| ` ``` ` code blocks | Dark background + monospace font + language label |
| `~~text~~` | Hide `~~`, show strikethrough |

### Component Interface

```tsx
<MarkeanEditor
  content={note.bodyMd}
  onChange={(newContent: string) => void}
/>
```

- Receives/outputs Markdown strings
- Reinitializes on `note.id` change

### Editor Styles

- Content area: `max-width: 680px`, centered, padding `28px 60px 60px`
- Font: `-apple-system`, body 15px, headings 28/22/18px
- Inline code: `rgba(118,118,128,0.12)` bg + `#007AFF` text
- Code block: `#1C1C1E` dark bg + language label header

## i18n

Lightweight custom i18n, no third-party library.

### Usage

```tsx
const { t } = useI18n();
<span>{t('sidebar.title')}</span>  // "Folders" or "文件夹"
```

### Language Detection Priority

1. `localStorage` manual override (reserved, no UI toggle currently)
2. `navigator.language` system language
3. Fallback: `en`

Rule: `zh`, `zh-CN`, `zh-TW` etc. all map to Chinese. Everything else maps to English.

### Translation Scope

UI text only (~30-40 keys). User content is never translated.

Key examples:

| Key | zh | en |
|-----|----|----|
| `sidebar.title` | 文件夹 | Folders |
| `sidebar.search` | 搜索 | Search |
| `noteList.count` | {n} 篇笔记 | {n} notes |
| `noteList.newNote` | 新建笔记 | New Note |
| `noteList.group.7d` | 过去 7 天 | Last 7 Days |
| `noteList.group.30d` | 过去 30 天 | Last 30 Days |
| `noteList.group.older` | 更早 | Older |
| `noteList.empty` | 暂无笔记 | No Notes |
| `editor.noSelection` | 选择笔记以开始编辑 | Select a note to start editing |
| `editor.synced` | 已同步 | Synced |
| `search.noResults` | 未找到相关笔记 | No matching notes |
| `mobile.done` | 完成 | Done |
| `welcome.title` | 欢迎使用 Markean | Welcome to Markean |

### Welcome Note

Language-specific Markdown content loaded based on detected language.

## Data Integration

### Reused Infrastructure

- `@markean/storage-web` — Dexie/IndexedDB local storage
- `@markean/sync-core` — sync logic
- `@markean/api-client` — API request wrapper
- `@markean/domain` — domain type definitions
- `apps/web/src/lib/storage.ts` — localStorage workspace snapshot, drafts
- `apps/web/src/lib/sync.ts` — sync flow
- `apps/web/src/lib/bootstrap.ts` — startup loading
- `apps/web/src/state/app-store.ts` — application state

### Startup Flow

1. App mounts → `loadWorkspace()` reads snapshot from localStorage
2. Has data → render immediately
3. No data → load welcome note + default folder
4. Background: `bootstrap()` fetches from server

### Edit Flow

1. User edits → `onChange` callback
2. `saveDraft()` to localStorage (immediate)
3. Update workspace state → `saveWorkspaceSnapshot()` (immediate)
4. `setSyncStatus('unsynced')` (mark pending sync)
5. Sync module pushes to server in background

### Type Mapping

Prototype data maps directly to existing types:

| Prototype | Existing Type | Notes |
|-----------|--------------|-------|
| `FOLDERS[].id/name` | `WorkspaceFolder.id/name` | Direct match |
| `NOTES_RAW[].folder` | `WorkspaceNote.folderId` | Field name differs |
| `NOTES_RAW[].content` | `WorkspaceNote.body` | Field name differs |
| `note.modified` (Date) | `WorkspaceNote.updatedAt` (ISO string) | Format differs |

No data structure changes needed.

## Style System

### CSS Variables

```css
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
```

### Style Files

| File | Content |
|------|---------|
| `variables.css` | CSS variables, reset, scrollbar, font |
| `desktop.css` | Three-pane layout, sidebar, note list, search highlight |
| `mobile.css` | Mobile nav, folder cards, note cards, bottom bar |
| `editor.css` | CodeMirror 6 theme overrides, Live Preview styles |

### Responsive Breakpoint

Single breakpoint at `768px`:
- `>= 769px`: desktop three-pane layout
- `<= 768px`: mobile navigation stack

Determined by `useMediaQuery` hook in `App.tsx`, rendering different component trees (not CSS `display:none`).

### Animation

New note pop-in animation:

```css
@keyframes notePopIn {
  0%   { opacity: 0; transform: translateY(-8px) scale(0.97); }
  60%  { opacity: 1; transform: translateY(2px) scale(1.005); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
```

## State Management

`App.tsx` manages core state, passed via props:

```
App state:
├── folders: WorkspaceFolder[]
├── notes: WorkspaceNote[]
├── activeFolderId: string
├── activeNoteId: string
├── mobileView: 'folders' | 'notes' | 'editor'
└── searchQuery: string
```

Follows existing `AppShell.tsx` patterns with additions for mobile view and search.

## Out of Scope

- Tweaks panel (removed)
- Dark mode
- Multi-page routing
- User authentication UI (handled by existing dev-session)
- Offline-first conflict resolution UI

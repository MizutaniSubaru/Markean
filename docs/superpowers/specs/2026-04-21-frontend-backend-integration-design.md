# Frontend-Backend Integration Design

> Date: 2026-04-21
> Status: Approved
> Scope: apps/web refactor + sync-core minor change

## Overview

Connect the frontend web app to the backend API by introducing proper layered architecture:
IndexedDB persistence (Dexie), Zustand state stores, sync orchestration via sync-core,
all replacing the current localStorage-only approach.

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Persistence storage | IndexedDB now (not later) | storage-web already implemented with Dexie; sync-core expects Dexie interface |
| State management | Zustand | Matches `.store.ts` file pattern; works outside React (sync/persistence layers can read/write); simple API |
| Sync trigger | Event-driven push + polling pull | Write ops push immediately (debounce 500ms); pull every 30s as fallback |
| useAppModel refactor | Full rewrite (delete) | Components use stores directly; no facade hook |
| Conflict handling | Conflict copy (Dropbox-style) | Never lose data; user merges manually |
| Architecture pattern | Store-Centric | Store is the UI authority; IndexedDB is the persistence authority; single-direction flows |

## Architecture — Five Layers

```
┌─────────────────────────────────────────┐
│  UI Layer (React components)            │
│  Read from stores, call store actions   │
├─────────────────────────────────────────┤
│  Store Layer (Zustand)                  │
│  notes / folders / editor / sync        │
│  Optimistic updates, delegate persist   │
├─────────────────────────────────────────┤
│  Persistence Layer                      │
│  Wraps storage-web (Dexie)              │
│  Write IndexedDB + record PendingChange │
├─────────────────────────────────────────┤
│  Sync Layer                             │
│  Wraps sync-core push/pull              │
│  Debounce push, poll pull, conflicts    │
├─────────────────────────────────────────┤
│  API Layer                              │
│  Wraps api-client, pure HTTP calls      │
└─────────────────────────────────────────┘
```

**Call rules:**
- UI → Store (direct action calls)
- Store → Persistence (on write operations)
- Store ← Persistence (bootstrap hydrate, pull hydrate)
- Persistence → Sync (triggers sync after writes)
- Sync → API (network calls)
- Each layer depends only on the layer below; no cross-layer calls

## Directory Structure

```
apps/web/src/
├─ app/
│  ├─ App.tsx                        # Top-level component
│  └─ bootstrap.ts                   # Init: create DB, hydrate stores, start sync
│
├─ features/
│  └─ notes/
│     ├─ components/                 # UI layer (migrate existing)
│     │  ├─ desktop/
│     │  │  ├─ Editor.tsx
│     │  │  ├─ NoteList.tsx
│     │  │  └─ Sidebar.tsx
│     │  ├─ mobile/
│     │  │  ├─ MobileEditor.tsx
│     │  │  ├─ MobileFolders.tsx
│     │  │  └─ MobileNoteList.tsx
│     │  ├─ editor/
│     │  │  ├─ MarkeanEditor.tsx
│     │  │  └─ live-preview.ts
│     │  └─ shared/
│     │     ├─ Icons.tsx
│     │     ├─ SyncStatusBadge.tsx
│     │     └─ WelcomeNote.ts
│     │
│     ├─ store/                      # Zustand stores
│     │  ├─ notes.store.ts
│     │  ├─ folders.store.ts
│     │  ├─ editor.store.ts
│     │  └─ sync.store.ts
│     │
│     ├─ persistence/                # Dexie operations
│     │  ├─ notes.persistence.ts
│     │  └─ folders.persistence.ts
│     │
│     ├─ sync/                       # Sync orchestration
│     │  ├─ sync.service.ts
│     │  ├─ sync.scheduler.ts
│     │  └─ conflict.handler.ts
│     │
│     ├─ hooks/
│     │  ├─ useNoteList.ts
│     │  └─ useEditorActions.ts
│     │
│     └─ index.ts
│
├─ hooks/
│  └─ useMediaQuery.ts
│
├─ i18n/                             # Unchanged
├─ styles/                           # Unchanged
└─ main.tsx
```

### File Migration Map

| Existing file | Destination | Action |
|---------------|-------------|--------|
| `useAppModel.ts` | — | Delete; split into 4 stores + hooks |
| `lib/storage.ts` | — | Delete; replaced by IndexedDB |
| `lib/sync.ts` | `sync/sync.scheduler.ts` | Migrate, reuse timer logic |
| `lib/bootstrap.ts` | `app/bootstrap.ts` | Migrate, expand init logic |
| `state/app-store.ts` | — | Delete; replaced by Zustand stores |
| `components/*` | `features/notes/components/` | Move; change to use stores directly |

## Store Layer Design

### notes.store.ts

```ts
State:
  notes: NoteRecord[]

Actions:
  loadNotes(notes: NoteRecord[])         // Hydrate from bootstrap/pull
  addNote(folderId: string)              // Optimistic create → persistence → PendingChange
  updateNote(id, { bodyMd, title })      // Optimistic update → persistence
  deleteNote(id)                         // Optimistic soft-delete → persistence
  addConflictCopy(note: NoteRecord)      // Insert conflict copy as new note
```

### folders.store.ts

```ts
State:
  folders: FolderRecord[]

Actions:
  loadFolders(folders: FolderRecord[])
  addFolder(name: string)                // Optimistic create → persistence
  deleteFolder(id)                       // Optimistic soft-delete → persistence
```

### editor.store.ts

```ts
State:
  activeFolderId: string
  activeNoteId: string
  searchQuery: string
  mobileView: 'folders' | 'notes' | 'editor'
  newNoteId: string | null

Actions:
  selectFolder(id)
  selectNote(id)
  setSearchQuery(query)
  setMobileView(view)
  setNewNoteId(id)
```

Pure UI state — no persistence, no sync.

### sync.store.ts

```ts
State:
  status: 'idle' | 'syncing' | 'unsynced' | 'error'
  isOnline: boolean
  lastSyncedAt: string | null

Actions:
  markUnsynced()
  markSyncing()
  markSynced()
  markError(error?: string)
  setOnline(online: boolean)
```

### Store Collaboration Flow

**Write path (user creates a note):**
```
editor.store.setNewNoteId(id)
→ notes.store.addNote(folderId)
    → persistence.createNote(noteRecord)
        → Dexie: notes.put(record)
        → Dexie: pendingChanges.put(change)
    → sync.store.markUnsynced()
        → scheduler detects unsynced → debounce 500ms → runSyncCycle
```

**Read path (pull receives new data):**
```
sync.service calls sync-core.pullChanges (writes IndexedDB)
→ Re-read from IndexedDB
→ notes.store.loadNotes(freshNotes)
→ folders.store.loadFolders(freshFolders)
→ sync.store.markSynced()
```

## Persistence Layer Design

### Core Responsibility

Wraps all IndexedDB (Dexie) operations. Automatically records `PendingChange` on every write via sync-core's `queueChange`. Store layer never touches Dexie or PendingChange directly.

### notes.persistence.ts

```ts
Read:
  getAllNotes(): Promise<NoteRecord[]>
  getNoteById(id): Promise<NoteRecord | undefined>

Write (each auto-queues PendingChange):
  createNote(note: NoteRecord)
    → db.notes.put(note)
    → queueChange(db, { entityType: 'note', entityId, operation: 'create', baseRevision: 0 })

  updateNote(id, changes: Partial<NoteRecord>)
    → read current revision
    → db.notes.update(id, { ...changes, updatedAt: now })
    → queueChange(db, { entityType: 'note', entityId, operation: 'update', baseRevision })

  deleteNote(id)
    → db.notes.update(id, { deletedAt: now })
    → queueChange(db, { entityType: 'note', entityId, operation: 'delete', baseRevision })
```

### folders.persistence.ts

Same pattern as notes.persistence.ts.

### DB Instance Management

```ts
// Module-level variable, initialized once at bootstrap
let _db: MarkeanWebDatabase

export function initPersistence(db: MarkeanWebDatabase) {
  _db = db
}
```

## Sync Layer Design

### sync.service.ts — Core Orchestration

```ts
async function executeSyncCycle(): Promise<void>
  1. sync.store.markSyncing()
  2. const { conflicts } = await sync-core.runSyncCycle(db, apiClient)
  3. If conflicts.length > 0 → conflict.handler.handleConflicts(conflicts)
  4. Hydrate stores from IndexedDB:
     → notes.store.loadNotes(await getAllNotes())
     → folders.store.loadFolders(await getAllFolders())
  5. sync.store.markSynced()
  6. On error → sync.store.markError()
```

### sync.scheduler.ts — Trigger Strategy

```
Two trigger mechanisms:

1. Event-driven push (after writes):
   → sync.store.markUnsynced() called
   → Scheduler subscribes to sync.store status
   → Debounce 500ms → executeSyncCycle()
   → New writes during debounce reset the timer

2. Polling pull (fallback):
   → Every 30 seconds → executeSyncCycle()
   → Only when status === 'idle'

3. Network recovery:
   → Listen to window 'online' event
   → Immediately executeSyncCycle()

Mutex protection:
   → isSyncing flag ensures one cycle at a time
   → New requests during execution set pendingRetry = true
   → After current cycle finishes, run one more if pending
```

### conflict.handler.ts — Conflict Copy Creation

```ts
handleConflicts(conflicts):
  For each conflicting note:
  1. Read local version from IndexedDB
  2. Create conflict copy (new ID, title + " (conflict copy)")
  3. notes.persistence.createNote(conflictCopy)
  4. notes.store.addConflictCopy(conflictCopy)
  5. Clear original pendingChange; let pull overwrite with server version
```

## Bootstrap Flow

```ts
async function bootstrapApp():

  // Phase 1: Infrastructure init
  1. db = createWebDatabase('markean')
  2. apiClient = createApiClient(baseUrl)
  3. initPersistence(db)
  4. initSyncService(db, apiClient)

  // Phase 1.5: localStorage → IndexedDB migration (one-time)
  5. migrateFromLocalStorage(db)

  // Phase 2: Local data load (offline-ready)
  6. localNotes = await notes.persistence.getAllNotes()
  7. localFolders = await folders.persistence.getAllFolders()
  8. notes.store.loadNotes(localNotes)
  9. folders.store.loadFolders(localFolders)
  10. Restore editor.store UI state
  → UI is now renderable and interactive

  // Phase 3: Remote sync (async, non-blocking)
  11. Try apiClient.bootstrap() for full server data
  12. Write server notes/folders to IndexedDB (server revision wins)
  13. Update syncCursor
  14. Re-hydrate stores
  15. Start sync.scheduler
  → If offline or failed, skip Phase 3; work with local data only
```

### localStorage → IndexedDB Migration

One-time migration for existing users:

```ts
async function migrateFromLocalStorage(db):
  1. Check if localStorage 'markean:workspace' exists
  2. If exists AND IndexedDB is empty (first migration):
     → Parse WorkspaceSnapshot
     → Convert folders to FolderRecord (add currentRevision: 0, updatedAt, etc.)
     → Convert notes to NoteRecord (body → bodyMd, add bodyPlain via markdownToPlainText, currentRevision: 0)
     → Read all 'markean:draft:*' drafts, merge into corresponding note bodyMd
     → Bulk write to IndexedDB
  3. Clear old localStorage data after successful migration
  4. If IndexedDB already has data, skip (idempotent)
```

**Field mapping:**

| localStorage (WorkspaceNote) | IndexedDB (NoteRecord) |
|-----|------|
| `id` | `id` |
| `folderId` | `folderId` |
| `title` | `title` |
| `body` | `bodyMd` |
| — | `bodyPlain` (via `markdownToPlainText`) |
| — | `currentRevision: 0` |
| `updatedAt` | `updatedAt` |
| — | `deletedAt: null` |

## Component Refactoring

### Principle

Components switch from `useAppModel()` destructuring to importing individual stores:

```ts
// Before
const { folders, activeFolder, createNote, ... } = useAppModel()

// After
const folders = useFoldersStore(s => s.folders)
const createNote = useNotesStore(s => s.addNote)
```

### Component → Store Dependency Map

| Component | Reads from | Calls actions on |
|-----------|-----------|-----------------|
| Sidebar | folders.store, editor.store, sync.store | selectFolder, createFolder |
| NoteList | notes.store, editor.store | selectNote, createNote |
| Editor / MarkeanEditor | notes.store, editor.store | updateNote |
| MobileFolders | folders.store, editor.store | selectFolder, createFolder, setMobileView |
| MobileNoteList | notes.store, editor.store | selectNote, setMobileView |
| MobileEditor | notes.store, editor.store | updateNote, setMobileView |
| SyncStatusBadge (new) | sync.store | — (read-only) |

### Hooks

**useNoteList.ts:**
- Derives filtered, sorted, grouped note sections
- Reads: notes.store.notes, editor.store.searchQuery, editor.store.activeFolderId
- Returns: `{ sections: NoteSection[], notesInScope: NoteRecord[] }`

**useEditorActions.ts:**
- Wraps changeBody logic: update notes.store (optimistic) → persistence → markUnsynced
- Returns: `{ changeBody: (body: string) => void }`

### App.tsx

```tsx
function App() {
  const isMobile = useMediaQuery('(max-width: 767px)')
  if (isMobile) return <MobileLayout />
  return <DesktopLayout />
}
```

### WelcomeNote

On first use (empty IndexedDB, no localStorage migration):
- Create WelcomeNote and write to IndexedDB as a normal note
- No special handling thereafter

## Package Changes

### sync-core — pushChanges return type (only change)

```ts
// Before
export async function pushChanges(db, apiClient, deviceId): Promise<void>

// After
export async function pushChanges(db, apiClient, deviceId): Promise<{
  conflicts: Array<{ entityType: string; entityId: string; serverRevision: number }>
}>

// runSyncCycle also returns conflicts
export async function runSyncCycle(db, apiClient): Promise<{
  conflicts: Array<{ entityType: string; entityId: string; serverRevision: number }>
}>
```

Non-breaking: callers that ignore the return value still work.

### apps/web/package.json — New Dependencies

```json
{
  "dependencies": {
    "@markean/storage-web": "workspace:*",
    "@markean/sync-core": "workspace:*",
    "zustand": "^5.0.0"
  }
}
```

### Unchanged Packages

| Package | Reason |
|---------|--------|
| `@markean/domain` | Types already sufficient |
| `@markean/api-client` | Interface already complete |
| `@markean/storage-web` | Dexie schema covers all needed tables |
| `apps/api` | Backend API already ready |

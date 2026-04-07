# Markean Cloudflare Web Architecture Design

Date: 2026-04-07

## Summary

Markean will become a web-first, local-first Markdown notes product with a lightweight Apple Notes-inspired feel and a Markdown-native editing model. The desktop experience is the primary interface pattern, but the product will support both browser desktop and mobile clients from the same backend platform. The backend will use an all-Cloudflare architecture: Workers for the public API, D1 for structured relational data, R2 for exports and backups, and Durable Objects for per-user sync coordination.

The product goal for v1 is a personal notes application for a single signed-in user across multiple devices. It must support full offline editing, background sync, global search, note export, folder-based organization, and safe conflict handling without introducing collaboration complexity.

## Product Scope

### In Scope

- Three-pane desktop web experience:
  - folder list
  - note list
  - editor and preview pane
- Mobile app with the same domain model and sync behavior, but mobile-native navigation
- Markdown editing and preview
- Folder-based organization without nested tree folders
- Drag-and-drop note moves between folders on desktop
- Global search across notes
- Full offline editing of previously synced content
- Background sync across devices
- Google login
- Sign in with Apple
- Export to Markdown, HTML, and PDF
- System-managed backups

### Out of Scope for v1

- Multi-user collaboration
- Shared workspaces
- Real-time co-editing
- CRDT-based merge logic
- AI search or semantic retrieval
- Server push for every content change
- MessagePack or other binary transport optimizations
- SignalR or other non-Cloudflare real-time frameworks
- Attachments beyond future-ready placeholders

## Core Product Decisions

- Web is the primary product surface.
- Desktop apps are future thin shells around the web app.
- Mobile is a separate Expo app, not a responsive web compromise.
- Domain logic, sync logic, and API types are shared across clients.
- UI is platform-specific and should not be forced into a single component layer.
- Notes are local-first: every edit is written locally before syncing.
- Cloud data is the canonical cross-device truth after a change is accepted by sync.
- Conflicts are handled by preserving both copies, not by risky automatic merges.

## Monorepo Structure

The project should evolve into a monorepo with separate app entry points and shared packages.

### Applications

- `apps/web`
  - React
  - Vite
  - TypeScript
  - TanStack Router
- `apps/mobile`
  - Expo
  - React Native
  - Expo Router

### Shared Packages

- `packages/domain`
  - shared types
  - entities
  - validation
  - sort and filter rules
- `packages/api-client`
  - typed Worker API client
  - session handling helpers
  - request and response models
- `packages/sync-core`
  - sync queue logic
  - cursor reconciliation
  - conflict parsing
  - retry policies
- `packages/storage-web`
  - IndexedDB implementation via Dexie
- `packages/storage-native`
  - Expo SQLite implementation
- `packages/markdown-core`
  - Markdown-specific helpers
  - title extraction
  - preview snippet generation
  - plain-text normalization for search

## Frontend Architecture

### Web Client

The desktop web client is the primary UI benchmark. It should feel calm, fast, and sparse like Apple Notes, while remaining explicitly Markdown-oriented.

Responsibilities:

- render the three-pane layout
- manage folder selection and note selection
- provide edit and preview modes
- support drag-and-drop note movement
- surface sync status with minimal interruption
- execute local search immediately
- trigger background push and pull sync cycles

The web client should be implemented as a client-heavy SPA. SEO is not a core concern for the private notes surface, so the architecture should optimize for application state, offline behavior, and predictable sync handling rather than server-rendered pages.

### Mobile Client

The mobile app should share backend protocol and sync behavior, but not desktop layout assumptions.

Responsibilities:

- use stacked navigation instead of a permanent three-pane layout
- reuse the same note, folder, sync, and auth models as web
- preserve offline-first behavior
- prioritize quick open, edit, and search workflows

## Local-First Data Layer

### Web Local Storage

The web app will store data in IndexedDB. IndexedDB is the browser's structured local database, suitable for storing notes, folders, sync metadata, and change queues. Dexie will be used as a developer-friendly wrapper around IndexedDB so the codebase can work with predictable tables, queries, and transactions instead of the low-level browser API.

Local IndexedDB tables:

- `folders`
- `notes`
- `pending_changes`
- `sync_state`
- `search_cache`

### Mobile Local Storage

The mobile app will store equivalent data in SQLite through Expo. The schema should mirror the web storage model closely enough that the shared sync engine can operate through a storage adapter interface rather than knowing the details of the underlying local database.

### Local Storage Design Rule

The sync engine must target an abstract storage interface. It should not know whether the current client uses Dexie or Expo SQLite.

## Cloudflare Backend Architecture

### Public Entry Point

A single public Worker will serve as the backend entry point in v1.

Responsibilities:

- session validation
- auth callback handling
- folder and note CRUD APIs
- sync push and pull APIs
- search APIs
- export APIs
- device registration

This keeps deployment, observability, and debugging simple at the start. If some backend capabilities become meaningfully heavier later, they can be split into private Workers behind service bindings.

### Durable Objects

Durable Objects will be used as per-user sync coordinators.

Design rule:

- one user maps to one sync Durable Object

Responsibilities:

- serialize sync writes for that user
- validate incoming base revisions
- detect conflicts
- assign accepted sync cursors
- ensure idempotent handling of repeated client change IDs

Durable Objects are not the primary long-term storage system. They coordinate writes and ordering. D1 remains the structured system of record.

### D1

D1 stores structured relational data for the product.

Core tables:

- `users`
- `sessions`
- `devices`
- `folders`
- `notes`
- `note_revisions`
- `sync_events`
- `deleted_records`
- `export_jobs`

Design rules:

- `notes` stores the latest accepted note snapshot
- `note_revisions` stores immutable history
- `sync_events` stores accepted changes with a cursor for incremental pulls
- `deleted_records` preserves tombstones for sync correctness

### R2

R2 is used for object storage rather than primary note content.

Responsibilities:

- exported files
- user-level backup snapshots
- future note attachments

R2 must not become the primary note database in v1.

## Data Model

### Folder

Fields:

- `id`
- `user_id`
- `name`
- `sort_order`
- `created_at`
- `updated_at`
- `deleted_at`

### Note

Fields:

- `id`
- `user_id`
- `folder_id`
- `title`
- `body_md`
- `body_plain`
- `current_revision`
- `created_at`
- `updated_at`
- `deleted_at`

### Note Revision

Fields:

- `id`
- `note_id`
- `user_id`
- `revision_number`
- `title`
- `body_md`
- `body_plain`
- `source_device_id`
- `created_at`

### Sync Event

Fields:

- `id`
- `user_id`
- `cursor`
- `entity_type`
- `entity_id`
- `operation`
- `revision_number`
- `client_change_id`
- `source_device_id`
- `created_at`

### Device

Fields:

- `id`
- `user_id`
- `platform`
- `app_kind`
- `last_seen_at`
- `last_pulled_cursor`

## API Surface

### Bootstrap

- `GET /api/bootstrap`

Returns:

- current user info
- known folders
- recent notes
- sync cursor
- device metadata

### Folder APIs

- `GET /api/folders`
- `POST /api/folders`
- `PATCH /api/folders/:id`
- `DELETE /api/folders/:id`

### Note APIs

- `GET /api/notes/:id`
- `POST /api/notes`
- `PATCH /api/notes/:id`
- `DELETE /api/notes/:id`
- `POST /api/notes/:id/move`

### Sync APIs

- `POST /api/sync/push`
- `GET /api/sync/pull?cursor=...`

### Search and Export APIs

- `GET /api/search?q=...`
- `POST /api/exports`
- `GET /api/exports/:id`

## Sync Protocol

### Push Flow

1. Client edits a note.
2. Client writes the change to local storage immediately.
3. Client records a `pending_change`.
4. Client sends a batch to `POST /api/sync/push`.
5. Worker validates session and routes to the user's Durable Object.
6. Durable Object validates `base_revision` and `client_change_id`.
7. D1 stores the updated note snapshot, immutable revision row, and sync event.
8. Response returns accepted revisions, new cursor, or conflict data.

### Pull Flow

1. Client sends the last known cursor.
2. Worker returns sync events after that cursor.
3. Client applies remote changes to local storage.
4. Client advances local sync state.

### Sync Triggers

Clients should pull or push under these conditions:

- app startup
- successful login
- app regains focus
- network reconnect
- after successful push
- periodic lightweight background sync

## Conflict Handling

The v1 strategy is explicit conflict preservation rather than smart merging.

Conflict rule:

- each edit is submitted with a `base_revision`
- if the server still has that revision, the write is accepted
- if the server has moved ahead, the write conflicts

Conflict result:

- keep the cloud version as the accepted latest note
- preserve the local change as a conflicted copy
- mark the conflict clearly in the local UI

This prevents silent data loss and keeps the implementation understandable.

## Authentication

V1 authentication should avoid passwords.

Supported sign-in methods:

- Google
- Sign in with Apple
- optional email magic link fallback

Design rule:

- provider identity proves the user
- app-managed session proves the request

The Worker should establish and validate its own session layer after third-party login rather than treating provider tokens as the long-lived application session. The v1 session model should use app-issued session tokens or cookies backed by persistent session records in D1.

## Search Design

Search should work in both offline and online contexts.

### Local Search

Local search runs against locally stored notes so the user can search while offline.

### Cloud Search

When online, the app can ask the Worker for fresher results that may include updates from other devices not yet synced to the current client.

Indexed fields for v1:

- note title
- normalized plain-text body
- updated time
- folder membership

V1 should not include semantic search or embedding infrastructure.

## Export and Backup

### User-Facing Export

Supported export formats:

- Markdown
- HTML
- PDF
- folder export as zip

Exports should be created through the Worker and stored temporarily in R2 for download.

### System Backup

Backups are internal recovery assets rather than a user-facing time-travel feature in v1.

Backup strategy:

- periodic user snapshot generation
- snapshot stored in R2
- enough metadata included to restore folders, notes, and revision context

## Error Handling

Errors should be surfaced by category.

### Local Save Failure

- interrupt the current save flow
- clearly tell the user the local write failed

### Sync Failure

- preserve local edits
- show unsynced state
- retry in the background

### Conflict

- keep both versions
- require user review later

### Auth Failure

- stop sync
- ask the user to sign in again

UI rule:

- do not overuse blocking alerts
- prefer lightweight status indicators unless user action is required

## Real-Time and Transport Decisions

The following are intentionally excluded from v1:

- SignalR
- MessagePack
- server push of full note payloads on every change

Rationale:

- the product is single-user rather than collaborative
- push and pull cursor sync is enough for v1
- JSON is easier to inspect, debug, and evolve
- Cloudflare-native WebSockets can be introduced later if low-latency device awareness becomes important

If real-time is added later, it should send light invalidation signals such as "new cursor available" rather than broadcasting entire note bodies after every edit.

## Testing Strategy

### Unit Tests

Cover:

- domain model validation
- sync queue rules
- conflict detection
- cursor advancement
- retry policies

### Integration Tests

Cover:

- Worker API behavior
- Durable Object sync coordination
- D1 persistence rules

### Storage Adapter Tests

Cover:

- Dexie-backed web storage
- Expo SQLite-backed mobile storage
- shared adapter contract compliance

### End-to-End Tests

Critical scenarios:

- sign in and bootstrap
- create folder and note
- offline edit and later sync
- note move between folders
- conflict creates duplicate safe copy
- search finds expected note
- export completes successfully

## Observability and Operations

The initial operational focus should be practical rather than enterprise-heavy.

Track:

- sync success and failure counts
- Durable Object conflict rates
- API latency
- export job failures
- auth callback failures
- backup job health

Logs should be structured and tied to user ID and device ID where safe and appropriate.

## Phased Delivery

### Phase 1

- monorepo setup
- web app scaffold
- Cloudflare Worker scaffold
- D1 schema
- basic auth

### Phase 2

- local storage adapters
- note and folder CRUD
- offline bootstrap
- basic sync push and pull

### Phase 3

- search
- export
- conflict UI
- mobile app scaffold

### Phase 4

- backups
- operational dashboards
- desktop shell exploration

## Why This Design

This design intentionally favors correctness, clarity, and platform fit over premature sophistication.

- Web and mobile share product logic without forcing a shared UI
- Cloudflare services are used for the jobs they are best suited for
- local-first behavior is treated as a core product feature rather than an enhancement
- conflict safety is prioritized over impressive but risky merge logic
- the system stays teachable for a developer using the project as a learning vehicle

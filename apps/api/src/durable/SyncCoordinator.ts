import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";

export type NotePayload = {
  folderId: string;
  title: string;
  bodyMd: string;
};

export type FolderPayload = {
  name: string;
  sortOrder: number;
};

export type SyncChangeInput = {
  userId: string;
  deviceId: string;
  clientChangeId: string;
  entityType: "note" | "folder";
  entityId: string;
  operation: "create" | "update" | "delete";
  baseRevision: number;
  payload: NotePayload | FolderPayload | null;
};

export type SyncChangeResult = {
  acceptedRevision: number;
  cursor: number;
};

type HandledChangeRow = SyncChangeResult & {
  client_change_id: string;
};

const toBodyPlain = (bodyMd: string) => bodyMd.replace(/\s+/g, " ").trim();
const expectOneChanged = (changes: number | undefined, description: string) => {
  if ((changes ?? 0) !== 1) {
    throw new Error(`SyncCoordinator: expected exactly one row for ${description}`);
  }
};

export class SyncCoordinator extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS handled_changes (
          client_change_id TEXT PRIMARY KEY,
          accepted_revision INTEGER NOT NULL,
          cursor INTEGER NOT NULL
        )
      `);
    });
  }

  async applyChange(change: SyncChangeInput): Promise<SyncChangeResult> {
    const existing = this.ctx.storage.sql
      .exec<HandledChangeRow>(
        `SELECT
           client_change_id,
           accepted_revision AS acceptedRevision,
           cursor
         FROM handled_changes
         WHERE client_change_id = ?`,
        change.clientChangeId,
      )
      .toArray()[0];

    if (existing) {
      return {
        acceptedRevision: existing.acceptedRevision,
        cursor: existing.cursor,
      };
    }

    const now = new Date().toISOString();
    let acceptedRevision = change.baseRevision + 1;

    if (change.entityType === "note") {
      acceptedRevision = await this.applyNoteChange(change, acceptedRevision, now);
    } else {
      acceptedRevision = await this.applyFolderChange(change, acceptedRevision, now);
    }

    const eventRow = await this.env.DB.prepare(
      `INSERT INTO sync_events (
         id, user_id, entity_type, entity_id, operation,
         revision_number, client_change_id, source_device_id, created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING cursor`,
    )
      .bind(
        `evt_${crypto.randomUUID()}`,
        change.userId,
        change.entityType,
        change.entityId,
        change.operation,
        acceptedRevision,
        change.clientChangeId,
        change.deviceId,
        now,
      )
      .first<{ cursor: number }>();

    let cursor = eventRow?.cursor ?? 0;

    if (change.entityType === "folder" && change.operation === "delete") {
      const cascadeCursor = await this.cascadeDeleteNotes(change.userId, change.entityId, change.deviceId, now);
      cursor = Math.max(cursor, cascadeCursor);
    }

    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO handled_changes (
         client_change_id, accepted_revision, cursor
       ) VALUES (?, ?, ?)`,
      change.clientChangeId,
      acceptedRevision,
      cursor,
    );

    return { acceptedRevision, cursor };
  }

  private async applyNoteChange(
    change: SyncChangeInput,
    acceptedRevision: number,
    now: string,
  ): Promise<number> {
    if (change.operation === "delete") {
      const result = await this.env.DB.prepare(
        `UPDATE notes
         SET deleted_at = ?, current_revision = current_revision + 1, updated_at = ?
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL
         RETURNING current_revision AS acceptedRevision`,
      )
        .bind(now, now, change.entityId, change.userId)
        .first<{ acceptedRevision: number }>();

      if (!result) {
        throw new Error(`SyncCoordinator: expected exactly one row for note delete ${change.entityId}`);
      }

      return result.acceptedRevision;
    }

    const payload = change.payload as NotePayload;
    const bodyPlain = toBodyPlain(payload.bodyMd);

    if (change.operation === "create") {
      await this.env.DB.prepare(
        `INSERT INTO notes (
           id, user_id, folder_id, title, body_md, body_plain,
           current_revision, created_at, updated_at, deleted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
        .bind(
          change.entityId,
          change.userId,
          payload.folderId,
          payload.title,
          payload.bodyMd,
          bodyPlain,
          acceptedRevision,
          now,
          now,
        )
        .run();
      return acceptedRevision;
    }

    const result = await this.env.DB.prepare(
      `UPDATE notes SET
         folder_id = ?, title = ?, body_md = ?, body_plain = ?,
         current_revision = ?, updated_at = ?, deleted_at = NULL
       WHERE id = ? AND user_id = ?`,
    )
      .bind(
        payload.folderId,
        payload.title,
        payload.bodyMd,
        bodyPlain,
        acceptedRevision,
        now,
        change.entityId,
        change.userId,
    )
      .run();
    expectOneChanged(result.meta.changes, `note update ${change.entityId}`);
    return acceptedRevision;
  }

  private async applyFolderChange(
    change: SyncChangeInput,
    acceptedRevision: number,
    now: string,
  ): Promise<number> {
    if (change.operation === "delete") {
      const result = await this.env.DB.prepare(
        `UPDATE folders
         SET deleted_at = ?, current_revision = current_revision + 1, updated_at = ?
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL
         RETURNING current_revision AS acceptedRevision`,
      )
        .bind(now, now, change.entityId, change.userId)
        .first<{ acceptedRevision: number }>();

      if (!result) {
        throw new Error(`SyncCoordinator: expected exactly one row for folder delete ${change.entityId}`);
      }

      return result.acceptedRevision;
    }

    const payload = change.payload as FolderPayload;

    if (change.operation === "create") {
      await this.env.DB.prepare(
        `INSERT INTO folders (
           id, user_id, name, sort_order, current_revision,
           created_at, updated_at, deleted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
        .bind(
          change.entityId,
          change.userId,
          payload.name,
          payload.sortOrder,
          acceptedRevision,
          now,
          now,
        )
        .run();
      return acceptedRevision;
    }

    const result = await this.env.DB.prepare(
      `UPDATE folders SET
         name = ?, sort_order = ?, current_revision = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
      .bind(
        payload.name,
        payload.sortOrder,
        acceptedRevision,
        now,
        change.entityId,
        change.userId,
    )
      .run();
    expectOneChanged(result.meta.changes, `folder update ${change.entityId}`);
    return acceptedRevision;
  }

  private async cascadeDeleteNotes(
    userId: string,
    folderId: string,
    deviceId: string,
    now: string,
  ): Promise<number> {
    const notes = await this.env.DB.prepare(
      `SELECT id, current_revision FROM notes WHERE folder_id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
      .bind(folderId, userId)
      .all<{ id: string; current_revision: number }>();

    let maxCursor = 0;

    for (const note of notes.results) {
      const newRevision = note.current_revision + 1;
      const updateResult = await this.env.DB.prepare(
        `UPDATE notes SET deleted_at = ?, current_revision = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      )
        .bind(now, newRevision, now, note.id, userId)
        .run();
      expectOneChanged(updateResult.meta.changes, `cascade note delete ${note.id}`);

      const eventRow = await this.env.DB.prepare(
        `INSERT INTO sync_events (
           id, user_id, entity_type, entity_id, operation,
           revision_number, client_change_id, source_device_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING cursor`,
      )
        .bind(
          `evt_${crypto.randomUUID()}`,
          userId,
          "note",
          note.id,
          "delete",
          newRevision,
          `cascade_${folderId}_${note.id}`,
          deviceId,
          now,
        )
        .first<{ cursor: number }>();
      maxCursor = Math.max(maxCursor, eventRow?.cursor ?? 0);
    }

    return maxCursor;
  }
}

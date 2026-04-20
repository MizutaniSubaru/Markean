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

type SyncEventRow = SyncChangeResult & {
  createdAt: string;
};

type QueryRunner = Pick<D1Database, "prepare">;

const toBodyPlain = (bodyMd: string) => bodyMd.replace(/\s+/g, " ").trim();

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
    const existing = this.getHandledChange(change.clientChangeId);

    if (existing) {
      return {
        acceptedRevision: existing.acceptedRevision,
        cursor: existing.cursor,
      };
    }

    const session = this.env.DB.withSession("first-primary");
    const existingEvent = await this.findExistingEvent(session, change);
    if (existingEvent) {
      this.rememberHandledChange(change.clientChangeId, existingEvent);
      return existingEvent;
    }

    const now = new Date().toISOString();
    let result: SyncChangeResult;

    if (change.entityType === "folder" && change.operation === "delete") {
      result = await this.applyFolderDeleteChange(session, change, now);
    } else {
      let acceptedRevision = change.baseRevision + 1;

      if (change.entityType === "note") {
        acceptedRevision = await this.applyNoteChange(session, change, acceptedRevision, now);
      } else {
        acceptedRevision = await this.applyFolderChange(session, change, acceptedRevision, now);
      }

      const eventRow = await session
        .prepare(
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

      result = {
        acceptedRevision,
        cursor: eventRow?.cursor ?? 0,
      };
    }

    this.rememberHandledChange(change.clientChangeId, result);

    return result;
  }

  private async applyNoteChange(
    db: QueryRunner,
    change: SyncChangeInput,
    acceptedRevision: number,
    now: string,
  ): Promise<number> {
    if (change.operation === "delete") {
      const result = await db
        .prepare(
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
      await db
        .prepare(
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

    const result = await db
      .prepare(
        `UPDATE notes SET
           folder_id = ?, title = ?, body_md = ?, body_plain = ?,
           current_revision = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL
         RETURNING current_revision AS acceptedRevision`,
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
      .first<{ acceptedRevision: number }>();

    if (!result) {
      throw new Error(`SyncCoordinator: expected exactly one row for note update ${change.entityId}`);
    }

    return result.acceptedRevision;
  }

  private async applyFolderChange(
    db: QueryRunner,
    change: SyncChangeInput,
    acceptedRevision: number,
    now: string,
  ): Promise<number> {
    if (change.operation === "delete") {
      const result = await db
        .prepare(
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
      await db
        .prepare(
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

    const result = await db
      .prepare(
        `UPDATE folders SET
           name = ?, sort_order = ?, current_revision = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL
         RETURNING current_revision AS acceptedRevision`,
      )
      .bind(
        payload.name,
        payload.sortOrder,
        acceptedRevision,
        now,
        change.entityId,
        change.userId,
      )
      .first<{ acceptedRevision: number }>();

    if (!result) {
      throw new Error(`SyncCoordinator: expected exactly one row for folder update ${change.entityId}`);
    }

    return result.acceptedRevision;
  }

  private async applyFolderDeleteChange(
    session: D1DatabaseSession,
    change: SyncChangeInput,
    now: string,
  ): Promise<SyncChangeResult> {
    const batchResults = await session.batch([
      session
        .prepare(
          `UPDATE folders
           SET deleted_at = ?, current_revision = current_revision + 1, updated_at = ?
           WHERE id = ? AND user_id = ? AND deleted_at IS NULL
           RETURNING current_revision AS acceptedRevision`,
        )
        .bind(now, now, change.entityId, change.userId),
      session
        .prepare(
          `INSERT INTO sync_events (
             id, user_id, entity_type, entity_id, operation,
             revision_number, client_change_id, source_device_id, created_at
           )
           SELECT ?, ?, 'folder', ?, 'delete', current_revision, ?, ?, ?
           FROM folders
           WHERE id = ? AND user_id = ? AND deleted_at = ?
           RETURNING cursor`,
        )
        .bind(
          `evt_${crypto.randomUUID()}`,
          change.userId,
          change.entityId,
          change.clientChangeId,
          change.deviceId,
          now,
          change.entityId,
          change.userId,
          now,
        ),
      session
        .prepare(
          `UPDATE notes
           SET deleted_at = ?, current_revision = current_revision + 1, updated_at = ?
           WHERE folder_id = ? AND user_id = ? AND deleted_at IS NULL
             AND EXISTS (
               SELECT 1
               FROM folders
               WHERE id = ? AND user_id = ? AND deleted_at = ?
             )
           RETURNING id, current_revision AS acceptedRevision`,
        )
        .bind(now, now, change.entityId, change.userId, change.entityId, change.userId, now),
      session
        .prepare(
          `INSERT INTO sync_events (
             id, user_id, entity_type, entity_id, operation,
             revision_number, client_change_id, source_device_id, created_at
           )
           SELECT
             'evt_' || hex(randomblob(16)),
             ?,
             'note',
             id,
             'delete',
             current_revision,
             'cascade_' || ? || '_' || id,
             ?,
             ?
           FROM notes
           WHERE folder_id = ? AND user_id = ? AND deleted_at = ? AND updated_at = ?
           RETURNING cursor`,
        )
        .bind(
          change.userId,
          change.entityId,
          change.deviceId,
          now,
          change.entityId,
          change.userId,
          now,
          now,
        ),
    ]);

    const folderUpdate = batchResults[0]?.results[0] as { acceptedRevision: number } | undefined;
    if (!folderUpdate) {
      throw new Error(`SyncCoordinator: expected exactly one row for folder delete ${change.entityId}`);
    }

    const folderCursor = (batchResults[1]?.results[0] as { cursor: number } | undefined)?.cursor ?? 0;
    const cascadeCursors = (batchResults[3]?.results as Array<{ cursor: number }> | undefined) ?? [];
    const cursor = cascadeCursors.reduce((max, row) => Math.max(max, row.cursor), folderCursor);

    return {
      acceptedRevision: folderUpdate.acceptedRevision,
      cursor,
    };
  }

  private findExistingEvent(db: QueryRunner, change: SyncChangeInput) {
    return db
      .prepare(
        `SELECT
           revision_number AS acceptedRevision,
           cursor,
           created_at AS createdAt
         FROM sync_events
         WHERE user_id = ?
           AND client_change_id = ?
           AND entity_type = ?
           AND entity_id = ?
           AND operation = ?
         ORDER BY cursor ASC
         LIMIT 1`,
      )
      .bind(
        change.userId,
        change.clientChangeId,
        change.entityType,
        change.entityId,
        change.operation,
      )
      .first<SyncEventRow>()
      .then(async (existing) => {
        if (!existing) {
          return null;
        }

        if (change.entityType !== "folder" || change.operation !== "delete") {
          return {
            acceptedRevision: existing.acceptedRevision,
            cursor: existing.cursor,
          };
        }

        const cascade = await db
          .prepare(
            `SELECT MAX(cursor) AS cursor
             FROM sync_events
             WHERE user_id = ?
               AND created_at = ?
               AND (
                 client_change_id = ?
                 OR client_change_id LIKE ?
               )`,
          )
          .bind(
            change.userId,
            existing.createdAt,
            change.clientChangeId,
            `cascade_${change.entityId}_%`,
          )
          .first<{ cursor: number | null }>();

        return {
          acceptedRevision: existing.acceptedRevision,
          cursor: cascade?.cursor ?? existing.cursor,
        };
      });
  }

  private getHandledChange(clientChangeId: string) {
    return this.ctx.storage.sql
      .exec<HandledChangeRow>(
        `SELECT
           client_change_id,
           accepted_revision AS acceptedRevision,
           cursor
         FROM handled_changes
         WHERE client_change_id = ?`,
        clientChangeId,
      )
      .toArray()[0];
  }

  private rememberHandledChange(clientChangeId: string, result: SyncChangeResult) {
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO handled_changes (
         client_change_id, accepted_revision, cursor
       ) VALUES (?, ?, ?)`,
      clientChangeId,
      result.acceptedRevision,
      result.cursor,
    );
  }
}

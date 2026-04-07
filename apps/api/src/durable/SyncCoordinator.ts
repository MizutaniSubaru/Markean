import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";

export type SyncChangeInput = {
  userId: string;
  deviceId: string;
  clientChangeId: string;
  entityType: "note";
  entityId: string;
  operation: "update";
  baseRevision: number;
  payload: {
    folderId: string;
    title: string;
    bodyMd: string;
  };
};

export type SyncChangeResult = {
  acceptedRevision: number;
  cursor: number;
};

type HandledChangeRow = SyncChangeResult & {
  client_change_id: string;
};

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
    const acceptedRevision = change.baseRevision + 1;
    const bodyPlain = toBodyPlain(change.payload.bodyMd);

    await this.env.DB.prepare(
      `INSERT INTO notes (
         id,
         user_id,
         folder_id,
         title,
         body_md,
         body_plain,
         current_revision,
         created_at,
         updated_at,
         deleted_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         folder_id = excluded.folder_id,
         title = excluded.title,
         body_md = excluded.body_md,
         body_plain = excluded.body_plain,
         current_revision = excluded.current_revision,
         updated_at = excluded.updated_at,
         deleted_at = NULL`,
    )
      .bind(
        change.entityId,
        change.userId,
        change.payload.folderId,
        change.payload.title,
        change.payload.bodyMd,
        bodyPlain,
        acceptedRevision,
        now,
        now,
      )
      .run();

    const eventRow = await this.env.DB.prepare(
      `INSERT INTO sync_events (
         id,
         user_id,
         entity_type,
         entity_id,
         operation,
         revision_number,
         client_change_id,
         source_device_id,
         created_at
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

    const cursor = eventRow?.cursor ?? 0;

    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO handled_changes (
         client_change_id,
         accepted_revision,
         cursor
       ) VALUES (?, ?, ?)`,
      change.clientChangeId,
      acceptedRevision,
      cursor,
    );

    return {
      acceptedRevision,
      cursor,
    };
  }
}

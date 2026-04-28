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

export type SyncConflict = {
  entityType: SyncChangeInput["entityType"];
  entityId: string;
  serverRevision: number;
};

export type SyncPushResult =
  | {
      ok: true;
      accepted: SyncChangeResult[];
      cursor: number;
    }
  | {
      ok: false;
      conflicts: SyncConflict[];
    }
  | {
      ok: false;
      error: "sync_push_failed";
    };

type HandledChangeRow = SyncChangeResult & {
  client_change_id: string;
};

type SyncEventRow = SyncChangeResult & {
  createdAt: string;
};

type CurrentEntityRow = {
  currentRevision: number;
  deletedAt: string | null;
  folderId: string | null;
};

type ProjectedEntities = Map<string, CurrentEntityRow | null>;

type QueryRunner = Pick<D1Database, "prepare">;

const toBodyPlain = (bodyMd: string) => bodyMd.replace(/\s+/g, " ").trim();
const getEntityKey = (
  entityType: SyncChangeInput["entityType"],
  entityId: string,
) => `${entityType}:${entityId}`;
const SAME_BATCH_DELETED_AT = "__same_batch_deleted__";

export class SyncConflictError extends Error {
  constructor(public readonly conflicts: SyncConflict[]) {
    super("sync_conflict");
  }
}

class SyncMissingUpdateTargetError extends Error {
  constructor() {
    super("sync_missing_update_target");
  }
}

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

  async applyChanges(changes: SyncChangeInput[]): Promise<SyncPushResult> {
    const session = this.env.DB.withSession("first-primary");

    try {
      await this.preflightChanges(session, changes);

      const accepted: SyncChangeResult[] = [];

      for (const change of changes) {
        accepted.push(await this.applyChangeAfterPreflight(session, change));
      }

      return {
        ok: true,
        accepted,
        cursor: Math.max(0, ...accepted.map((result) => result.cursor)),
      };
    } catch (error) {
      if (error instanceof SyncConflictError) {
        return {
          ok: false,
          conflicts: error.conflicts,
        };
      }

      if (error instanceof SyncMissingUpdateTargetError) {
        return {
          ok: false,
          error: "sync_push_failed",
        };
      }

      throw error;
    }
  }

  async applyChange(change: SyncChangeInput): Promise<SyncChangeResult> {
    const session = this.env.DB.withSession("first-primary");
    await this.preflightChanges(session, [change]);
    return this.applyChangeAfterPreflight(session, change);
  }

  private async applyChangeAfterPreflight(
    session: D1DatabaseSession,
    change: SyncChangeInput,
  ): Promise<SyncChangeResult> {
    const existing = this.getHandledChange(change.clientChangeId);

    if (existing) {
      const result = {
        acceptedRevision: existing.acceptedRevision,
        cursor: existing.cursor,
      };

      if (change.entityType === "folder" && change.operation === "delete") {
        return this.repairFolderDeleteCascade(session, change, result, new Date().toISOString());
      }

      return result;
    }

    const existingEvent = await this.findExistingEvent(session, change);
    if (existingEvent) {
      const result =
        change.entityType === "folder" && change.operation === "delete"
          ? await this.repairFolderDeleteCascade(
              session,
              change,
              existingEvent,
              new Date().toISOString(),
            )
          : existingEvent;

      this.rememberHandledChange(change.clientChangeId, result);
      return result;
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

  private async preflightChanges(db: QueryRunner, changes: SyncChangeInput[]) {
    const conflicts: SyncConflict[] = [];
    let hasMissingUpdateTarget = false;
    const projectedEntities: ProjectedEntities = new Map();
    const sameBatchHandledNoteIds = new Set<string>();
    const sameBatchDeletedFolderIds = new Set<string>();
    const sameBatchCreatedEntities = new Set<string>();
    const sameBatchDeletedEntities = new Set<string>();
    const seenClientChangeIds = new Set<string>();

    for (const change of changes) {
      const entityKey = getEntityKey(change.entityType, change.entityId);
      const currentEntity = await this.getProjectedEntity(
        db,
        projectedEntities,
        change.userId,
        change.entityType,
        change.entityId,
      );

      if (seenClientChangeIds.has(change.clientChangeId)) {
        conflicts.push({
          entityType: change.entityType,
          entityId: change.entityId,
          serverRevision: currentEntity?.currentRevision ?? 0,
        });
        continue;
      }
      seenClientChangeIds.add(change.clientChangeId);

      const existingEvent = await this.findExistingEvent(db, change);
      if (existingEvent) {
        if (
          change.entityType === "note" &&
          (change.operation === "update" || change.operation === "delete") &&
          currentEntity &&
          currentEntity.currentRevision === existingEvent.acceptedRevision
        ) {
          sameBatchHandledNoteIds.add(change.entityId);
        }

        if (
          change.entityType === "folder" &&
          change.operation === "delete" &&
          currentEntity &&
          currentEntity.deletedAt !== null &&
          currentEntity.currentRevision === existingEvent.acceptedRevision
        ) {
          sameBatchDeletedFolderIds.add(change.entityId);
        }

        continue;
      }

      let rejectedChange = false;

      if (change.entityType === "note" && change.operation !== "delete") {
        const targetFolderId = (change.payload as NotePayload).folderId;
        const targetFolder = await this.getProjectedEntity(
          db,
          projectedEntities,
          change.userId,
          "folder",
          targetFolderId,
        );

        if (
          (targetFolder !== null && targetFolder.deletedAt !== null) ||
          sameBatchDeletedFolderIds.has(targetFolderId)
        ) {
          conflicts.push({
            entityType: "note",
            entityId: change.entityId,
            serverRevision: currentEntity?.currentRevision ?? 0,
          });
          rejectedChange = true;
        }
      }

      if (
        !rejectedChange &&
        change.entityType === "note" &&
        (change.operation === "update" || change.operation === "delete") &&
        currentEntity &&
        currentEntity.deletedAt === null &&
        currentEntity.folderId &&
        sameBatchDeletedFolderIds.has(currentEntity.folderId)
      ) {
        conflicts.push({
          entityType: "note",
          entityId: change.entityId,
          serverRevision: currentEntity.currentRevision,
        });
        rejectedChange = true;
      }

      if (change.operation === "update" || change.operation === "delete") {
        const wasCreatedEarlierInBatch = sameBatchCreatedEntities.has(entityKey);

        if (
          currentEntity &&
          currentEntity.deletedAt !== null &&
          sameBatchDeletedEntities.has(entityKey)
        ) {
          conflicts.push({
            entityType: change.entityType,
            entityId: change.entityId,
            serverRevision: currentEntity.currentRevision,
          });
          continue;
        }

        if (!currentEntity || currentEntity.deletedAt !== null) {
          if (change.operation === "update" && !wasCreatedEarlierInBatch) {
            hasMissingUpdateTarget = true;
          }

          continue;
        }

        if (currentEntity.currentRevision !== change.baseRevision) {
          conflicts.push({
            entityType: change.entityType,
            entityId: change.entityId,
            serverRevision: currentEntity.currentRevision,
          });
          continue;
        }

        if (
          change.entityType === "folder" &&
          change.operation === "delete" &&
          currentEntity.deletedAt === null
        ) {
          const childNoteConflicts = await db
            .prepare(
              `SELECT id, current_revision AS currentRevision
               FROM notes
               WHERE user_id = ?
                 AND folder_id = ?
                 AND deleted_at IS NULL
               ORDER BY id ASC`,
            )
            .bind(change.userId, change.entityId)
            .all<{ id: string; currentRevision: number }>();

          for (const childNote of childNoteConflicts.results ?? []) {
            const projectedChild = projectedEntities.get(getEntityKey("note", childNote.id));

            if (projectedChild) {
              if (
                projectedChild.deletedAt !== null ||
                projectedChild.folderId !== change.entityId ||
                sameBatchHandledNoteIds.has(childNote.id)
              ) {
                continue;
              }
            }

            if (childNote.currentRevision === 1 || sameBatchHandledNoteIds.has(childNote.id)) {
              continue;
            }

            conflicts.push({
              entityType: "note",
              entityId: childNote.id,
              serverRevision: childNote.currentRevision,
            });
            rejectedChange = true;
          }
        }
      }

      if (rejectedChange) {
        continue;
      }

      if (change.operation === "create") {
        sameBatchCreatedEntities.add(entityKey);

        if (change.entityType === "note") {
          projectedEntities.set(entityKey, {
            currentRevision: change.baseRevision + 1,
            deletedAt: null,
            folderId: (change.payload as NotePayload).folderId,
          });
        } else {
          projectedEntities.set(entityKey, {
            currentRevision: change.baseRevision + 1,
            deletedAt: null,
            folderId: null,
          });
        }

        continue;
      }

      if (!currentEntity || currentEntity.deletedAt !== null) {
        continue;
      }

      if (change.entityType === "note") {
        sameBatchHandledNoteIds.add(change.entityId);

        projectedEntities.set(entityKey, {
          currentRevision: change.baseRevision + 1,
          deletedAt: change.operation === "delete" ? SAME_BATCH_DELETED_AT : null,
          folderId:
            change.operation === "update"
              ? (change.payload as NotePayload).folderId
              : currentEntity.folderId,
        });
        if (change.operation === "delete") {
          sameBatchDeletedEntities.add(entityKey);
        }
        continue;
      }

      projectedEntities.set(entityKey, {
        currentRevision: change.baseRevision + 1,
        deletedAt: change.operation === "delete" ? SAME_BATCH_DELETED_AT : null,
        folderId: null,
      });

      if (change.operation === "delete") {
        sameBatchDeletedEntities.add(entityKey);
        sameBatchDeletedFolderIds.add(change.entityId);
      }
    }

    if (conflicts.length > 0) {
      throw new SyncConflictError(conflicts);
    }

    if (hasMissingUpdateTarget) {
      throw new SyncMissingUpdateTargetError();
    }
  }

  private async getProjectedEntity(
    db: QueryRunner,
    projectedEntities: ProjectedEntities,
    userId: string,
    entityType: SyncChangeInput["entityType"],
    entityId: string,
  ) {
    const entityKey = getEntityKey(entityType, entityId);
    if (!projectedEntities.has(entityKey)) {
      projectedEntities.set(
        entityKey,
        await this.getCurrentEntityByType(db, userId, entityType, entityId),
      );
    }

    return projectedEntities.get(entityKey) ?? null;
  }

  private getCurrentEntity(db: QueryRunner, change: SyncChangeInput) {
    return this.getCurrentEntityByType(db, change.userId, change.entityType, change.entityId);
  }

  private getCurrentEntityByType(
    db: QueryRunner,
    userId: string,
    entityType: SyncChangeInput["entityType"],
    entityId: string,
  ) {
    if (entityType === "note") {
      return db
        .prepare(
          `SELECT
             current_revision AS currentRevision,
             deleted_at AS deletedAt,
             folder_id AS folderId
           FROM notes
           WHERE id = ? AND user_id = ?`,
          )
        .bind(entityId, userId)
        .first<CurrentEntityRow>();
    }

    return db
      .prepare(
        `SELECT
           current_revision AS currentRevision,
           deleted_at AS deletedAt,
           NULL AS folderId
         FROM folders
         WHERE id = ? AND user_id = ?`,
      )
      .bind(entityId, userId)
      .first<CurrentEntityRow>();
  }

  private async throwConflictForCurrentRevision(
    db: QueryRunner,
    change: SyncChangeInput,
    fallbackMessage: string,
  ): Promise<never> {
    const currentEntity = await this.getCurrentEntity(db, change);

    if (currentEntity && currentEntity.currentRevision > change.baseRevision) {
      throw new SyncConflictError([
        {
          entityType: change.entityType,
          entityId: change.entityId,
          serverRevision: currentEntity.currentRevision,
        },
      ]);
    }

    throw new Error(fallbackMessage);
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
           WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND current_revision = ?
           RETURNING current_revision AS acceptedRevision`,
        )
        .bind(now, now, change.entityId, change.userId, change.baseRevision)
        .first<{ acceptedRevision: number }>();

      if (!result) {
        return this.throwConflictForCurrentRevision(
          db,
          change,
          `SyncCoordinator: expected exactly one row for note delete ${change.entityId}`,
        );
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
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND current_revision = ?
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
        change.baseRevision,
      )
      .first<{ acceptedRevision: number }>();

    if (!result) {
      return this.throwConflictForCurrentRevision(
        db,
        change,
        `SyncCoordinator: expected exactly one row for note update ${change.entityId}`,
      );
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
           WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND current_revision = ?
           RETURNING current_revision AS acceptedRevision`,
        )
        .bind(now, now, change.entityId, change.userId, change.baseRevision)
        .first<{ acceptedRevision: number }>();

      if (!result) {
        return this.throwConflictForCurrentRevision(
          db,
          change,
          `SyncCoordinator: expected exactly one row for folder delete ${change.entityId}`,
        );
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
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND current_revision = ?
         RETURNING current_revision AS acceptedRevision`,
      )
      .bind(
        payload.name,
        payload.sortOrder,
        acceptedRevision,
        now,
        change.entityId,
        change.userId,
        change.baseRevision,
      )
      .first<{ acceptedRevision: number }>();

    if (!result) {
      return this.throwConflictForCurrentRevision(
        db,
        change,
        `SyncCoordinator: expected exactly one row for folder update ${change.entityId}`,
      );
    }

    return result.acceptedRevision;
  }

  private async applyFolderDeleteChange(
    session: D1DatabaseSession,
    change: SyncChangeInput,
    now: string,
  ): Promise<SyncChangeResult> {
    const folderUpdate = await session
      .prepare(
        `UPDATE folders
         SET deleted_at = ?, current_revision = current_revision + 1, updated_at = ?
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND current_revision = ?
         RETURNING current_revision AS acceptedRevision`,
      )
      .bind(now, now, change.entityId, change.userId, change.baseRevision)
      .first<{ acceptedRevision: number }>();

    if (!folderUpdate) {
      return this.throwConflictForCurrentRevision(
        session,
        change,
        `SyncCoordinator: expected exactly one row for folder delete ${change.entityId}`,
      );
    }

    const folderEvent = await session
      .prepare(
        `INSERT INTO sync_events (
           id, user_id, entity_type, entity_id, operation,
           revision_number, client_change_id, source_device_id, created_at
         )
         VALUES (?, ?, 'folder', ?, 'delete', ?, ?, ?, ?)
         RETURNING cursor`,
      )
      .bind(
        `evt_${crypto.randomUUID()}`,
        change.userId,
        change.entityId,
        folderUpdate.acceptedRevision,
        change.clientChangeId,
        change.deviceId,
        now,
      )
      .first<{ cursor: number }>();

    return this.repairFolderDeleteCascade(
      session,
      change,
      {
        acceptedRevision: folderUpdate.acceptedRevision,
        cursor: folderEvent?.cursor ?? 0,
      },
      now,
    );
  }

  private async repairFolderDeleteCascade(
    session: D1DatabaseSession,
    change: SyncChangeInput,
    result: SyncChangeResult,
    now: string,
  ): Promise<SyncChangeResult> {
    const cascadeNotes = await session
      .prepare(
        `UPDATE notes
         SET deleted_at = ?, current_revision = current_revision + 1, updated_at = ?
         WHERE folder_id = ? AND user_id = ? AND deleted_at IS NULL
           AND EXISTS (
             SELECT 1
             FROM folders
             WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL
           )
         RETURNING id, current_revision AS acceptedRevision`,
      )
      .bind(now, now, change.entityId, change.userId, change.entityId, change.userId)
      .all<{ id: string; acceptedRevision: number }>();

    let cursor = result.cursor;

    for (const note of cascadeNotes.results ?? []) {
      const cascadeEvent = await session
        .prepare(
          `INSERT INTO sync_events (
             id, user_id, entity_type, entity_id, operation,
             revision_number, client_change_id, source_device_id, created_at
           )
           VALUES (?, ?, 'note', ?, 'delete', ?, ?, ?, ?)
           RETURNING cursor`,
        )
        .bind(
          `evt_${crypto.randomUUID()}`,
          change.userId,
          note.id,
          note.acceptedRevision,
          `cascade_${change.entityId}_${note.id}`,
          change.deviceId,
          now,
        )
        .first<{ cursor: number }>();

      cursor = Math.max(cursor, cascadeEvent?.cursor ?? 0);
    }

    return {
      acceptedRevision: result.acceptedRevision,
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
               AND (
                 client_change_id = ?
                 OR client_change_id LIKE ?
               )`,
          )
          .bind(
            change.userId,
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

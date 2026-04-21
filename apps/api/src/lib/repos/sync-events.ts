type SyncEventRow = {
  cursor: number;
  entityType: string;
  entityId: string;
  operation: string;
  revisionNumber: number;
  sourceDeviceId: string;
};

export const listSyncEventsByUserIdAfterCursor = async (
  db: D1Database,
  userId: string,
  cursor: number,
) => {
  const result = await db
    .prepare(
      `SELECT
         cursor,
         entity_type AS entityType,
         entity_id AS entityId,
         operation,
         revision_number AS revisionNumber,
         source_device_id AS sourceDeviceId
       FROM sync_events
       WHERE user_id = ?
         AND cursor > ?
       ORDER BY cursor ASC`,
    )
    .bind(userId, cursor)
    .all<SyncEventRow>();

  return result.results ?? [];
};

type NoteEntityData = {
  id: string;
  folderId: string;
  title: string;
  bodyMd: string;
  bodyPlain: string;
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

type FolderEntityData = {
  id: string;
  name: string;
  sortOrder: number;
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type SyncEventWithEntity = {
  cursor: number;
  entityType: string;
  entityId: string;
  operation: string;
  revisionNumber: number;
  sourceDeviceId: string;
  entity: NoteEntityData | FolderEntityData | null;
};

export const listSyncEventsWithEntities = async (
  db: D1Database,
  userId: string,
  cursor: number,
): Promise<SyncEventWithEntity[]> => {
  const noteEvents = await db
    .prepare(
      `SELECT
         se.cursor,
         se.entity_type AS entityType,
         se.entity_id AS entityId,
         se.operation,
         se.revision_number AS revisionNumber,
         se.source_device_id AS sourceDeviceId,
         n.id AS n_id,
         n.folder_id AS n_folderId,
         n.title AS n_title,
         n.body_md AS n_bodyMd,
         n.body_plain AS n_bodyPlain,
         n.current_revision AS n_currentRevision,
         n.created_at AS n_createdAt,
         n.updated_at AS n_updatedAt,
         n.deleted_at AS n_deletedAt
       FROM sync_events se
       LEFT JOIN notes n ON se.entity_id = n.id
       WHERE se.user_id = ?
         AND se.cursor > ?
         AND se.entity_type = 'note'
       ORDER BY se.cursor ASC`,
    )
    .bind(userId, cursor)
    .all<
      SyncEventRow & {
        n_id: string | null;
        n_folderId: string;
        n_title: string;
        n_bodyMd: string;
        n_bodyPlain: string;
        n_currentRevision: number;
        n_createdAt: string;
        n_updatedAt: string;
        n_deletedAt: string | null;
      }
    >();

  const folderEvents = await db
    .prepare(
      `SELECT
         se.cursor,
         se.entity_type AS entityType,
         se.entity_id AS entityId,
         se.operation,
         se.revision_number AS revisionNumber,
         se.source_device_id AS sourceDeviceId,
         f.id AS f_id,
         f.name AS f_name,
         f.sort_order AS f_sortOrder,
         f.current_revision AS f_currentRevision,
         f.created_at AS f_createdAt,
         f.updated_at AS f_updatedAt,
         f.deleted_at AS f_deletedAt
       FROM sync_events se
       LEFT JOIN folders f ON se.entity_id = f.id
       WHERE se.user_id = ?
         AND se.cursor > ?
         AND se.entity_type = 'folder'
       ORDER BY se.cursor ASC`,
    )
    .bind(userId, cursor)
    .all<
      SyncEventRow & {
        f_id: string | null;
        f_name: string;
        f_sortOrder: number;
        f_currentRevision: number;
        f_createdAt: string;
        f_updatedAt: string;
        f_deletedAt: string | null;
      }
    >();

  const noteResults: SyncEventWithEntity[] = (noteEvents.results ?? []).map((row) => ({
    cursor: row.cursor,
    entityType: row.entityType,
    entityId: row.entityId,
    operation: row.operation,
    revisionNumber: row.revisionNumber,
    sourceDeviceId: row.sourceDeviceId,
    entity: row.n_id
      ? {
          id: row.n_id,
          folderId: row.n_folderId,
          title: row.n_title,
          bodyMd: row.n_bodyMd,
          bodyPlain: row.n_bodyPlain,
          currentRevision: row.n_currentRevision,
          createdAt: row.n_createdAt,
          updatedAt: row.n_updatedAt,
          deletedAt: row.n_deletedAt,
        }
      : null,
  }));

  const folderResults: SyncEventWithEntity[] = (folderEvents.results ?? []).map((row) => ({
    cursor: row.cursor,
    entityType: row.entityType,
    entityId: row.entityId,
    operation: row.operation,
    revisionNumber: row.revisionNumber,
    sourceDeviceId: row.sourceDeviceId,
    entity: row.f_id
      ? {
          id: row.f_id,
          name: row.f_name,
          sortOrder: row.f_sortOrder,
          currentRevision: row.f_currentRevision,
          createdAt: row.f_createdAt,
          updatedAt: row.f_updatedAt,
          deletedAt: row.f_deletedAt,
        }
      : null,
  }));

  return [...noteResults, ...folderResults].sort((a, b) => a.cursor - b.cursor);
};

type SyncEventRow = {
  cursor: number;
  entityId: string;
  revisionNumber: number;
  operation: string;
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
         entity_id AS entityId,
         revision_number AS revisionNumber,
         operation
       FROM sync_events
       WHERE user_id = ?
         AND cursor > ?
       ORDER BY cursor ASC`,
    )
    .bind(userId, cursor)
    .all<SyncEventRow>();

  return result.results ?? [];
};

type FolderRow = {
  id: string;
  name: string;
  sortOrder: number;
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export const listFoldersByUserId = async (db: D1Database, userId: string) => {
  const result = await db
    .prepare(
      `SELECT
         id,
         name,
         sort_order AS sortOrder,
         current_revision AS currentRevision,
         created_at AS createdAt,
         updated_at AS updatedAt,
         deleted_at AS deletedAt
       FROM folders
       WHERE user_id = ?
       ORDER BY sort_order ASC, created_at ASC`,
    )
    .bind(userId)
    .all<FolderRow>();

  return result.results;
};

export const listActiveFoldersByUserId = async (db: D1Database, userId: string) => {
  const result = await db
    .prepare(
      `SELECT
         id,
         name,
         sort_order AS sortOrder,
         current_revision AS currentRevision,
         created_at AS createdAt,
         updated_at AS updatedAt,
         deleted_at AS deletedAt
       FROM folders
       WHERE user_id = ?
         AND deleted_at IS NULL
       ORDER BY sort_order ASC, created_at ASC`,
    )
    .bind(userId)
    .all<FolderRow>();

  return result.results;
};

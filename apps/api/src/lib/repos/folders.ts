type FolderRow = {
  id: string;
  name: string;
  sortOrder: number;
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

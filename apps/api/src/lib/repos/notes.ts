type NoteRow = {
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

export const listNotesByUserId = async (db: D1Database, userId: string) => {
  const result = await db
    .prepare(
      `SELECT
         id,
         folder_id AS folderId,
         title,
         body_md AS bodyMd,
         body_plain AS bodyPlain,
         current_revision AS currentRevision,
         created_at AS createdAt,
         updated_at AS updatedAt,
         deleted_at AS deletedAt
       FROM notes
       WHERE user_id = ?
       ORDER BY updated_at DESC, created_at DESC`,
    )
    .bind(userId)
    .all<NoteRow>();

  return result.results;
};

export const getLatestSyncCursorForUser = async (db: D1Database, userId: string) => {
  const result = await db
    .prepare("SELECT MAX(cursor) AS cursor FROM sync_events WHERE user_id = ?")
    .bind(userId)
    .first<{ cursor: number | null }>();

  return result?.cursor ?? 0;
};

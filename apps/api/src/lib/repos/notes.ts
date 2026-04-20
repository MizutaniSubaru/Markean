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

export const listActiveNotesByUserId = async (db: D1Database, userId: string) => {
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
         AND deleted_at IS NULL
       ORDER BY updated_at DESC, created_at DESC`,
    )
    .bind(userId)
    .all<NoteRow>();

  return result.results;
};

export const listDeletedNotesByUserId = async (db: D1Database, userId: string) => {
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
         AND deleted_at IS NOT NULL
       ORDER BY deleted_at DESC`,
    )
    .bind(userId)
    .all<NoteRow>();

  return result.results;
};

export const restoreNote = async (db: D1Database, userId: string, noteId: string) => {
  const note = await db
    .prepare("SELECT id, current_revision FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL")
    .bind(noteId, userId)
    .first<{ id: string; current_revision: number }>();

  if (!note) return null;

  const now = new Date().toISOString();
  const newRevision = note.current_revision + 1;

  await db.batch([
    db.prepare("UPDATE notes SET deleted_at = NULL, current_revision = ?, updated_at = ? WHERE id = ?")
      .bind(newRevision, now, noteId),
    db.prepare(
      `INSERT INTO sync_events (id, user_id, entity_type, entity_id, operation, revision_number, client_change_id, source_device_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(`evt_${crypto.randomUUID()}`, userId, "note", noteId, "update", newRevision, `restore_${noteId}`, "server", now),
  ]);

  return { id: noteId, revision: newRevision };
};

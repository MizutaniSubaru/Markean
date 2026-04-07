const DEV_USER_ID = "user_dev";
const DEV_USER_EMAIL = "dev@markean.local";
const SESSION_COOKIE_NAME = "markean_session";
const SESSION_TTL_MS = 7 * 86400_000;

export const createDevSession = async (db: D1Database) => {
  const sessionId = `sess_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  await db.batch([
    db
      .prepare("INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?, ?, ?)")
      .bind(DEV_USER_ID, DEV_USER_EMAIL, createdAt),
    db
      .prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind(sessionId, DEV_USER_ID, createdAt, expiresAt),
  ]);

  return { sessionId, userId: DEV_USER_ID, email: DEV_USER_EMAIL };
};

const getCookieValue = (cookieHeader: string | undefined, name: string) => {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) {
      return rawValue.join("=");
    }
  }

  return null;
};

export const getSessionIdFromCookie = (cookieHeader: string | undefined) =>
  getCookieValue(cookieHeader, SESSION_COOKIE_NAME);

export const getUserForSession = async (db: D1Database, sessionId: string) => {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `SELECT users.id, users.email
       FROM sessions
       INNER JOIN users ON users.id = sessions.user_id
       WHERE sessions.id = ?
         AND sessions.expires_at > ?`,
    )
    .bind(sessionId, now)
    .first<{ id: string; email: string }>();

  return result ?? null;
};

export const sessionCookieName = SESSION_COOKIE_NAME;

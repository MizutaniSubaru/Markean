import { createOpaqueToken, hashOpaqueToken } from "../auth/crypto";

type AuthCodeRow = {
  id: string;
  userId: string;
  provider: "google" | "apple" | "magic_link";
};

export async function createAuthCode(
  db: D1Database,
  input: { userId: string; provider: "google" | "apple" | "magic_link"; ttlMs: number },
) {
  const value = await createOpaqueToken("ac");
  const codeHash = await hashOpaqueToken(value);
  const id = `ac_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + input.ttlMs).toISOString();

  await db
    .prepare(
      "INSERT INTO auth_codes (id, user_id, code_hash, provider, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)",
    )
    .bind(id, input.userId, codeHash, input.provider, expiresAt, createdAt)
    .run();

  return { id, value };
}

export async function consumeAuthCode(db: D1Database, value: string) {
  const codeHash = await hashOpaqueToken(value);
  const now = new Date().toISOString();
  const row = await db
    .prepare(
      `SELECT id, user_id AS userId, provider
       FROM auth_codes
       WHERE code_hash = ?
         AND consumed_at IS NULL
         AND expires_at > ?`,
    )
    .bind(codeHash, now)
    .first<AuthCodeRow>();

  if (!row) {
    return null;
  }

  await db.prepare("UPDATE auth_codes SET consumed_at = ? WHERE id = ?").bind(now, row.id).run();
  return row;
}

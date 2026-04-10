import { createOpaqueToken, hashOpaqueToken } from "../auth/crypto";
import type { AuthProvider } from "./auth-accounts";

type AuthCodeRow = {
  id: string;
  userId: string;
  provider: AuthProvider;
};

export async function createAuthCode(
  db: D1Database,
  input: { userId: string; provider: AuthProvider; ttlMs: number },
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
      `UPDATE auth_codes
       SET consumed_at = ?
       WHERE code_hash = ?
         AND consumed_at IS NULL
         AND expires_at > ?
       RETURNING id, user_id AS userId, provider`,
    )
    .bind(now, codeHash, now)
    .first<AuthCodeRow>();

  return row ?? null;
}

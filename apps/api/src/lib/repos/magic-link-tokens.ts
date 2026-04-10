import { createOpaqueToken, hashOpaqueToken } from "../auth/crypto";

type MagicLinkTokenRow = {
  id: string;
  email: string;
  clientType: "web" | "mobile";
  redirectTarget: string;
};

export async function createMagicLinkToken(
  db: D1Database,
  input: { email: string; clientType: "web" | "mobile"; redirectTarget: string; ttlMs: number },
) {
  const token = await createOpaqueToken("ml");
  const tokenHash = await hashOpaqueToken(token);
  const id = `ml_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + input.ttlMs).toISOString();

  await db
    .prepare(
      "INSERT INTO magic_link_tokens (id, email, token_hash, client_type, redirect_target, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
    )
    .bind(id, input.email.trim().toLowerCase(), tokenHash, input.clientType, input.redirectTarget, expiresAt, createdAt)
    .run();

  return { id, token };
}

export async function consumeMagicLinkToken(db: D1Database, token: string) {
  const tokenHash = await hashOpaqueToken(token);
  const now = new Date().toISOString();
  const row = await db
    .prepare(
      `SELECT id, email, client_type AS clientType, redirect_target AS redirectTarget
       FROM magic_link_tokens
       WHERE token_hash = ?
         AND consumed_at IS NULL
         AND expires_at > ?`,
    )
    .bind(tokenHash, now)
    .first<MagicLinkTokenRow>();

  if (!row) {
    return null;
  }

  await db.prepare("UPDATE magic_link_tokens SET consumed_at = ? WHERE id = ?").bind(now, row.id).run();
  return row;
}

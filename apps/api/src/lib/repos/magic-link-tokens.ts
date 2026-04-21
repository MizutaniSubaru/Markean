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
      `UPDATE magic_link_tokens
       SET consumed_at = ?
       WHERE token_hash = ?
         AND consumed_at IS NULL
         AND expires_at > ?
       RETURNING id, email, client_type AS clientType, redirect_target AS redirectTarget`,
    )
    .bind(now, tokenHash, now)
    .first<MagicLinkTokenRow>();

  return row ?? null;
}

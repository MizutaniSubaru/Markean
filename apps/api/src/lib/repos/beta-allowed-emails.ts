const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function allowEmail(db: D1Database, email: string) {
  const normalizedEmail = normalizeEmail(email);
  await db
    .prepare("INSERT OR IGNORE INTO beta_allowed_emails (email, created_at) VALUES (?, ?)")
    .bind(normalizedEmail, new Date().toISOString())
    .run();
}

export async function isEmailAllowed(db: D1Database, email: string) {
  const normalizedEmail = normalizeEmail(email);
  const row = await db
    .prepare("SELECT email FROM beta_allowed_emails WHERE email = ?")
    .bind(normalizedEmail)
    .first<{ email: string }>();

  return Boolean(row);
}

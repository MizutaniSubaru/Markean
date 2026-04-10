export type AuthProvider = "google" | "apple" | "magic_link";

type AuthAccountRow = {
  id: string;
  userId: string;
  provider: AuthProvider;
  providerSubject: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
};

const mapAuthAccountRow = (row: {
  id: string;
  userId: string;
  provider: AuthProvider;
  providerSubject: string;
  email: string;
  emailVerified: number;
  createdAt: string;
  updatedAt: string;
}): AuthAccountRow => ({
  ...row,
  emailVerified: row.emailVerified === 1,
});

export async function upsertAuthAccount(
  db: D1Database,
  input: {
    userId: string;
    provider: AuthProvider;
    providerSubject: string;
    email: string;
    emailVerified: boolean;
  },
) {
  const id = `aa_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO auth_accounts (
         id,
         user_id,
         provider,
         provider_subject,
         email,
         email_verified,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, provider_subject) DO UPDATE SET
         email = excluded.email,
         email_verified = excluded.email_verified,
         updated_at = excluded.updated_at`,
    )
    .bind(id, input.userId, input.provider, input.providerSubject, input.email, input.emailVerified ? 1 : 0, now, now)
    .run();

  return getAuthAccountByProviderSubject(db, input.provider, input.providerSubject);
}

export const createAuthAccount = upsertAuthAccount;

export async function getAuthAccountByProviderSubject(
  db: D1Database,
  provider: AuthProvider,
  providerSubject: string,
) {
  const row = await db
    .prepare(
      `SELECT
         id,
         user_id AS userId,
         provider,
         provider_subject AS providerSubject,
         email,
         email_verified AS emailVerified,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM auth_accounts
       WHERE provider = ?
         AND provider_subject = ?`,
    )
    .bind(provider, providerSubject)
    .first<{
      id: string;
      userId: string;
      provider: AuthProvider;
      providerSubject: string;
      email: string;
      emailVerified: number;
      createdAt: string;
      updatedAt: string;
    }>();

  return row ? mapAuthAccountRow(row) : null;
}

export async function listAuthAccountsByUserId(db: D1Database, userId: string) {
  const result = await db
    .prepare(
      `SELECT
         id,
         user_id AS userId,
         provider,
         provider_subject AS providerSubject,
         email,
         email_verified AS emailVerified,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM auth_accounts
       WHERE user_id = ?
       ORDER BY created_at ASC`,
    )
    .bind(userId)
    .all<{
      id: string;
      userId: string;
      provider: AuthProvider;
      providerSubject: string;
      email: string;
      emailVerified: number;
      createdAt: string;
      updatedAt: string;
    }>();

  return result.results.map(mapAuthAccountRow);
}

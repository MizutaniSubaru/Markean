import type { MarkeanWebDatabase } from "@markean/storage-web";

let _db: MarkeanWebDatabase | null = null;

export function initDb(db: MarkeanWebDatabase): void {
  _db = db;
}

export function resetDbForTests(): void {
  _db = null;
}

export function getDb(): MarkeanWebDatabase {
  if (!_db) throw new Error("Database not initialized. Call initDb() first.");
  return _db;
}

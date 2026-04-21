import type { MarkeanWebDatabase } from "@markean/storage-web";

let dbInstance: MarkeanWebDatabase | null = null;

export function initDb(db: MarkeanWebDatabase): void {
  dbInstance = db;
}

export function getDb(): MarkeanWebDatabase {
  if (!dbInstance) {
    throw new Error("Database not initialized. Call initDb() first.");
  }

  return dbInstance;
}

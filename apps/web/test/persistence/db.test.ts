import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";
import { createWebDatabase } from "@markean/storage-web";
import type { MarkeanWebDatabase } from "@markean/storage-web";
import { getDb, initDb } from "../../src/features/notes/persistence/db";

describe("persistence db holder", () => {
  let db: MarkeanWebDatabase | null = null;

  afterEach(async () => {
    if (db) {
      await db.delete();
      db = null;
    }
  });

  it("throws when getDb is called before initialization", () => {
    expect(() => getDb()).toThrow("Database not initialized. Call initDb() first.");
  });

  it("returns the initialized database instance", () => {
    db = createWebDatabase(`test-db-holder-${crypto.randomUUID()}`);
    initDb(db);
    expect(getDb()).toBe(db);
  });
});

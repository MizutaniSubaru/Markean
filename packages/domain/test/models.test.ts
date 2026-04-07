import { describe, expect, it } from "vitest";
import { createFolderRecord, createNoteRecord, createPendingChange } from "../src/index";

describe("domain factories", () => {
  it("creates a folder with the expected minimal record shape", () => {
    const folder = createFolderRecord({
      id: "folder_1",
      name: "Inbox",
    });

    expect(folder.name).toBe("Inbox");
    expect(folder.currentRevision).toBe(1);
  });

  it("creates a note with plain text derived from markdown", () => {
    const note = createNoteRecord({
      id: "note_1",
      folderId: "folder_1",
      title: "Hello",
      bodyMd: "# Hello\n\nWorld",
    });

    expect(note.bodyPlain).toBe("Hello World");
    expect(note.currentRevision).toBe(1);
  });

  it("creates a pending note update with a stable client change id", () => {
    const change = createPendingChange({
      entityType: "note",
      entityId: "note_1",
      operation: "update",
      baseRevision: 1,
    });

    expect(change.clientChangeId).toMatch(/^chg_/);
    expect(change.baseRevision).toBe(1);
  });
});

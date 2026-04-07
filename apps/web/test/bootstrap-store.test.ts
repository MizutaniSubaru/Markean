import { describe, expect, it, vi } from "vitest";
import { createAppStore } from "../src/state/app-store";

describe("app bootstrap", () => {
  it("hydrates folders, notes, and sync cursor from the API client", async () => {
    const api = {
      bootstrap: vi.fn().mockResolvedValue({
        user: { id: "user_1" },
        folders: [{ id: "folder_1", name: "Inbox", currentRevision: 1, updatedAt: "2026-04-07T00:00:00.000Z", deletedAt: null }],
        notes: [
          {
            id: "note_1",
            folderId: "folder_1",
            title: "Hello",
            bodyMd: "",
            bodyPlain: "",
            currentRevision: 1,
            updatedAt: "2026-04-07T00:00:00.000Z",
            deletedAt: null,
          },
        ],
        syncCursor: 42,
      }),
    };

    const store = createAppStore({ api });

    await store.bootstrap();

    expect(api.bootstrap).toHaveBeenCalledTimes(1);
    expect(store.getState().folders).toHaveLength(1);
    expect(store.getState().notes).toHaveLength(1);
    expect(store.getState().syncCursor).toBe(42);
  });
});

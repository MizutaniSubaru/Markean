import { afterEach, describe, expect, it, vi } from "vitest";
import type { FolderRecord } from "@markean/domain";
import { useFoldersStore } from "../../src/features/notes/store/folders.store";

const folder1: FolderRecord = {
  id: "folder_1",
  name: "Notes",
  sortOrder: 0,
  currentRevision: 1,
  updatedAt: "2026-04-21T09:00:00.000Z",
  deletedAt: null,
};

const folder2: FolderRecord = {
  id: "folder_2",
  name: "Archive",
  sortOrder: 1,
  currentRevision: 2,
  updatedAt: "2026-04-22T10:00:00.000Z",
  deletedAt: null,
};

describe("folders.store", () => {
  afterEach(() => {
    vi.useRealTimers();
    useFoldersStore.setState({ folders: [] });
  });

  it("starts with empty folders", () => {
    expect(useFoldersStore.getState().folders).toEqual([]);
  });

  it("loads folders from hydration", () => {
    useFoldersStore.getState().loadFolders([folder1]);
    expect(useFoldersStore.getState().folders).toEqual([folder1]);
  });

  it("adds a folder optimistically", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T12:34:56.789Z"));

    const folder = useFoldersStore.getState().addFolder("Work");
    const folders = useFoldersStore.getState().folders;

    expect(folders).toHaveLength(1);
    expect(folder).toEqual(folders[0]);
    expect(folders[0].name).toBe("Work");
    expect(folders[0].id).toMatch(/^folder_/);
    expect(folders[0].sortOrder).toBe(0);
    expect(folders[0].currentRevision).toBe(0);
    expect(folders[0].updatedAt).toBe("2026-04-27T12:34:56.789Z");
    expect(folders[0].deletedAt).toBeNull();
  });

  it("soft-deletes a folder optimistically", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T12:34:56.789Z"));

    useFoldersStore.getState().loadFolders([folder1, folder2]);
    useFoldersStore.getState().deleteFolder("folder_1");
    const folders = useFoldersStore.getState().folders;

    expect(folders[0]).toEqual({
      ...folder1,
      deletedAt: "2026-04-27T12:34:56.789Z",
    });
    expect(folders[1]).toEqual(folder2);
  });
});

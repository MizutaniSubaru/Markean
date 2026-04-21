import { afterEach, describe, expect, it } from "vitest";
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

describe("folders.store", () => {
  afterEach(() => {
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
    useFoldersStore.getState().addFolder("Work");
    const folders = useFoldersStore.getState().folders;
    expect(folders).toHaveLength(1);
    expect(folders[0].name).toBe("Work");
    expect(folders[0].id).toMatch(/^folder_/);
    expect(folders[0].currentRevision).toBe(0);
    expect(folders[0].deletedAt).toBeNull();
  });

  it("assigns sort order based on the current folder count", () => {
    useFoldersStore.getState().loadFolders([folder1]);
    const folder = useFoldersStore.getState().addFolder("Work");
    expect(folder.sortOrder).toBe(1);
  });

  it("soft-deletes a folder optimistically", () => {
    useFoldersStore.getState().loadFolders([folder1]);
    useFoldersStore.getState().deleteFolder("folder_1");
    const folders = useFoldersStore.getState().folders;
    expect(folders[0].deletedAt).not.toBeNull();
  });
});

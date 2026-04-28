import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { FolderRecord, NoteRecord } from "@markean/domain";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  deriveNoteList,
  type NoteListResult,
  useNoteList,
} from "../../src/features/notes/hooks/useNoteList";
import { useEditorStore } from "../../src/features/notes/store/editor.store";
import { useFoldersStore } from "../../src/features/notes/store/folders.store";
import { useNotesStore } from "../../src/features/notes/store/notes.store";

function folder(overrides: Partial<FolderRecord> & Pick<FolderRecord, "id" | "name">): FolderRecord {
  return {
    sortOrder: 0,
    currentRevision: 1,
    updatedAt: "2026-04-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function note(overrides: Partial<NoteRecord> & Pick<NoteRecord, "id" | "folderId">): NoteRecord {
  return {
    title: overrides.id,
    bodyMd: "",
    bodyPlain: "",
    currentRevision: 1,
    updatedAt: "2026-04-27T12:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function loadFixture() {
  useFoldersStore.getState().loadFolders([
    folder({ id: "folder_work", name: "Work" }),
    folder({ id: "folder_home", name: "Home" }),
  ]);
  useNotesStore.getState().loadNotes([
    note({
      id: "newer_work",
      folderId: "folder_work",
      title: "Newer Work",
      bodyMd: "latest work note",
      updatedAt: "2026-04-27T12:00:00.000Z",
    }),
    note({
      id: "older_work",
      folderId: "folder_work",
      title: "Older Work",
      bodyMd: "older work note",
      updatedAt: "2026-04-20T12:00:00.000Z",
    }),
    note({
      id: "home_note",
      folderId: "folder_home",
      title: "Groceries",
      bodyMd: "buy milk",
      updatedAt: "2026-04-26T12:00:00.000Z",
    }),
    note({
      id: "deleted_work",
      folderId: "folder_work",
      title: "Deleted Work",
      bodyMd: "removed",
      deletedAt: "2026-04-27T13:00:00.000Z",
      updatedAt: "2026-04-27T13:00:00.000Z",
    }),
  ]);
  useEditorStore.setState({
    activeFolderId: "folder_work",
    activeNoteId: "",
    searchQuery: "",
    mobileView: "folders",
    newNoteId: null,
  });
}

describe("useNoteList", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-28T12:00:00.000Z"));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useNotesStore.setState({ notes: [] });
    useFoldersStore.setState({ folders: [] });
    useEditorStore.setState({
      activeFolderId: "",
      activeNoteId: "",
      searchQuery: "",
      mobileView: "folders",
      newNoteId: null,
    });
  });

  it("filters by active folder when no search query is set", () => {
    loadFixture();

    const result = deriveNoteList("en");

    expect(result.notesInScope.map((item) => item.id)).toEqual(["newer_work", "older_work"]);
    expect(result.notesInScope.every((item) => !("folderName" in item))).toBe(true);
  });

  it("falls back to the first active folder when activeFolderId points to a missing folder", () => {
    loadFixture();
    useEditorStore.setState({ activeFolderId: "missing_folder", searchQuery: "" });

    const result = deriveNoteList("en");

    expect(result.notesInScope.map((item) => item.id)).toEqual(["newer_work", "older_work"]);
  });

  it("falls back to the first active folder when activeFolderId points to a deleted folder", () => {
    loadFixture();
    useFoldersStore.getState().loadFolders([
      folder({
        id: "folder_deleted",
        name: "Deleted",
        deletedAt: "2026-04-27T12:00:00.000Z",
      }),
      folder({ id: "folder_work", name: "Work" }),
      folder({ id: "folder_home", name: "Home" }),
    ]);
    useEditorStore.setState({ activeFolderId: "folder_deleted", searchQuery: "" });

    const result = deriveNoteList("en");

    expect(result.notesInScope.map((item) => item.id)).toEqual(["newer_work", "older_work"]);
  });

  it("returns NoteRecord objects in notesInScope while sections contain display items", () => {
    loadFixture();

    const result = deriveNoteList("en");

    expectTypeOf<NoteListResult["notesInScope"]>().toEqualTypeOf<NoteRecord[]>();
    expect(result.notesInScope[0]).toMatchObject({
      id: "newer_work",
      folderId: "folder_work",
      title: "Newer Work",
      bodyMd: "latest work note",
      bodyPlain: "",
      currentRevision: 1,
      updatedAt: "2026-04-27T12:00:00.000Z",
      deletedAt: null,
    });
    expect(result.notesInScope[0]).not.toHaveProperty("preview");
    expect(result.notesInScope[0]).not.toHaveProperty("date");
    expect(result.sections[0].items[0]).toMatchObject({
      id: "newer_work",
      title: "Newer Work",
      preview: "latest work note",
      date: "Apr 27",
    });
  });

  it("searches active notes across title, body, and folder name", () => {
    loadFixture();

    useEditorStore.getState().setSearchQuery("home");
    expect(deriveNoteList("en").notesInScope.map((item) => item.id)).toEqual(["home_note"]);

    useEditorStore.getState().setSearchQuery("milk");
    expect(deriveNoteList("en").notesInScope.map((item) => item.id)).toEqual(["home_note"]);

    useEditorStore.getState().setSearchQuery("older work");
    expect(deriveNoteList("en").notesInScope.map((item) => item.id)).toEqual(["older_work"]);
  });

  it("excludes soft-deleted notes from folder and search results", () => {
    loadFixture();

    expect(deriveNoteList("en").notesInScope.map((item) => item.id)).not.toContain("deleted_work");

    useEditorStore.getState().setSearchQuery("deleted");
    expect(deriveNoteList("en").notesInScope).toEqual([]);
  });

  it("sorts notes newest first", () => {
    loadFixture();

    expect(deriveNoteList("en").notesInScope.map((item) => item.id)).toEqual([
      "newer_work",
      "older_work",
    ]);
  });

  it("groups notes into age sections using injected labels", () => {
    useFoldersStore.getState().loadFolders([folder({ id: "folder_work", name: "Work" })]);
    useNotesStore.getState().loadNotes([
      note({ id: "recent", folderId: "folder_work", updatedAt: "2026-04-27T00:00:00.000Z" }),
      note({ id: "month", folderId: "folder_work", updatedAt: "2026-04-10T00:00:00.000Z" }),
      note({ id: "older", folderId: "folder_work", updatedAt: "2026-03-01T00:00:00.000Z" }),
    ]);
    useEditorStore.setState({ activeFolderId: "folder_work", searchQuery: "" });

    const result = deriveNoteList("en", (key) => `label:${key}`);

    expect(result.sections).toEqual([
      { label: "label:noteList.group.7d", items: [expect.objectContaining({ id: "recent" })] },
      { label: "label:noteList.group.30d", items: [expect.objectContaining({ id: "month" })] },
      { label: "label:noteList.group.older", items: [expect.objectContaining({ id: "older" })] },
    ]);
  });

  it("falls back from blank titles to body headings or Untitled", () => {
    useFoldersStore.getState().loadFolders([folder({ id: "folder_work", name: "Work" })]);
    useNotesStore.getState().loadNotes([
      note({
        id: "body_title",
        folderId: "folder_work",
        title: "   ",
        bodyMd: "\n\n## Body Heading\nmore text",
      }),
      note({
        id: "untitled",
        folderId: "folder_work",
        title: "",
        bodyMd: " \n \n",
        updatedAt: "2026-04-26T12:00:00.000Z",
      }),
    ]);
    useEditorStore.setState({ activeFolderId: "folder_work", searchQuery: "" });

    const result = deriveNoteList("en");

    expect(result.notesInScope.map((item) => item.title)).toEqual(["   ", ""]);
    expect(result.sections.flatMap((section) => section.items.map((item) => item.title))).toEqual([
      "Body Heading",
      "Untitled",
    ]);
  });

  it("strips heading markers, collapses whitespace, and truncates previews", () => {
    const longBody = `# Heading\n\n${"word ".repeat(40)}`;
    useFoldersStore.getState().loadFolders([folder({ id: "folder_work", name: "Work" })]);
    useNotesStore.getState().loadNotes([note({ id: "preview", folderId: "folder_work", bodyMd: longBody })]);
    useEditorStore.setState({ activeFolderId: "folder_work", searchQuery: "" });

    const [{ preview }] = deriveNoteList("en").sections[0].items;

    expect(preview.startsWith("Heading word word")).toBe(true);
    expect(preview).not.toContain("#");
    expect(preview).not.toContain("\n");
    expect(preview).toHaveLength(123);
    expect(preview.endsWith("...")).toBe(true);
  });

  it("includes folderName only in search mode", () => {
    loadFixture();

    expect(deriveNoteList("en").sections[0].items[0]).not.toHaveProperty("folderName");

    useEditorStore.getState().setSearchQuery("work");

    expect(deriveNoteList("en").sections[0].items[0]).toHaveProperty("folderName", "Work");
  });

  it("formats zh locale dates through zh-CN", () => {
    useFoldersStore.getState().loadFolders([folder({ id: "folder_work", name: "Work" })]);
    useNotesStore.getState().loadNotes([
      note({ id: "localized", folderId: "folder_work", updatedAt: "2026-04-27T12:00:00.000Z" }),
    ]);
    useEditorStore.setState({ activeFolderId: "folder_work", searchQuery: "" });

    const [{ date }] = deriveNoteList("zh").sections[0].items;

    expect(date).toContain("4");
    expect(date).toContain("27");
    expect(date).not.toBe("Apr 27");
  });

  it("reacts to store changes when used as a hook", () => {
    function Probe() {
      const { notesInScope } = useNoteList("en");
      return React.createElement(
        "output",
        {},
        notesInScope.map((item) => item.title).join(","),
      );
    }

    useFoldersStore.getState().loadFolders([folder({ id: "folder_work", name: "Work" })]);
    useEditorStore.setState({ activeFolderId: "folder_work", searchQuery: "" });

    render(React.createElement(Probe));
    expect(screen.getByRole("status", { hidden: true }).textContent).toBe("");

    act(() => {
      useNotesStore.getState().loadNotes([
        note({ id: "reactive", folderId: "folder_work", title: "Reactive Note" }),
      ]);
    });

    expect(screen.getByText("Reactive Note")).toBeTruthy();
  });
});

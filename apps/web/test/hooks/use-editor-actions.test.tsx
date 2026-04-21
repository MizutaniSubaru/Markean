import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNotesStore } from "../../src/features/notes/store/notes.store";
import { useSyncStore } from "../../src/features/notes/store/sync.store";

const updateNoteMock = vi.fn().mockResolvedValue(undefined);
const requestSyncMock = vi.fn();

vi.mock("../../src/features/notes/persistence/notes.persistence", () => ({
  updateNote: (...args: unknown[]) => updateNoteMock(...args),
}));

vi.mock("../../src/app/bootstrap", () => ({
  getScheduler: () => ({ requestSync: requestSyncMock }),
}));

import { useEditorActions } from "../../src/features/notes/hooks/useEditorActions";

describe("useEditorActions", () => {
  afterEach(() => {
    updateNoteMock.mockClear();
    requestSyncMock.mockClear();
    useNotesStore.setState({ notes: [] });
    useSyncStore.setState({ status: "idle", isOnline: true, lastSyncedAt: null });
  });

  it("updates the note optimistically, persists it, marks unsynced, and schedules sync", () => {
    useNotesStore.setState({
      notes: [
        {
          id: "note_1",
          folderId: "folder_1",
          title: "Old",
          bodyMd: "# Old",
          bodyPlain: "Old",
          currentRevision: 1,
          updatedAt: "2026-04-21T09:00:00.000Z",
          deletedAt: null,
        },
      ],
    });

    const { result } = renderHook(() => useEditorActions());

    result.current.changeBody("note_1", "# Updated title\n\nBody");

    const note = useNotesStore.getState().notes[0];
    expect(note.bodyMd).toBe("# Updated title\n\nBody");
    expect(note.title).toBe("Updated title");
    expect(useSyncStore.getState().status).toBe("unsynced");
    expect(updateNoteMock).toHaveBeenCalledWith("note_1", {
      bodyMd: "# Updated title\n\nBody",
      bodyPlain: "Updated title Body",
      title: "Updated title",
    });
    expect(requestSyncMock).toHaveBeenCalledTimes(1);
  });
});

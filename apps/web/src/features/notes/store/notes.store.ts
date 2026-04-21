import { create } from "zustand";
import { markdownToPlainText } from "@markean/domain";
import type { NoteRecord } from "@markean/domain";

type UpdateNoteChanges = Partial<Pick<NoteRecord, "bodyMd" | "title" | "folderId">>;

type NotesState = {
  notes: NoteRecord[];
  loadNotes: (notes: NoteRecord[]) => void;
  addNote: (folderId: string) => NoteRecord;
  updateNote: (id: string, changes: UpdateNoteChanges) => void;
  deleteNote: (id: string) => void;
  addConflictCopy: (note: NoteRecord) => void;
};

function createId() {
  return `note_${crypto.randomUUID()}`;
}

export const useNotesStore = create<NotesState>((set) => ({
  notes: [],
  loadNotes: (notes) => set({ notes }),
  addNote: (folderId) => {
    const note: NoteRecord = {
      id: createId(),
      folderId,
      title: "",
      bodyMd: "",
      bodyPlain: "",
      currentRevision: 0,
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    };

    set((state) => ({ notes: [note, ...state.notes] }));
    return note;
  },
  updateNote: (id, changes) =>
    set((state) => ({
      notes: state.notes.map((note) => {
        if (note.id !== id) {
          return note;
        }

        const updated: NoteRecord = {
          ...note,
          ...changes,
          updatedAt: new Date().toISOString(),
        };

        if (changes.bodyMd !== undefined) {
          updated.bodyPlain = markdownToPlainText(changes.bodyMd);
        }

        return updated;
      }),
    })),
  deleteNote: (id) =>
    set((state) => ({
      notes: state.notes.map((note) =>
        note.id === id ? { ...note, deletedAt: new Date().toISOString() } : note,
      ),
    })),
  addConflictCopy: (note) => set((state) => ({ notes: [note, ...state.notes] })),
}));

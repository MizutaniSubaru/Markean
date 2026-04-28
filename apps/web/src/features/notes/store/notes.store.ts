import { create } from "zustand";
import { markdownToPlainText } from "@markean/domain";
import type { NoteRecord } from "@markean/domain";

type NotesState = {
  notes: NoteRecord[];
  loadNotes: (notes: NoteRecord[]) => void;
  addNote: (folderId: string) => NoteRecord;
  updateNote: (
    id: string,
    changes: Partial<Pick<NoteRecord, "bodyMd" | "title" | "folderId">>,
  ) => void;
  deleteNote: (id: string) => void;
  addConflictCopy: (note: NoteRecord) => void;
};

function createId() {
  return `note_${crypto.randomUUID()}`;
}

export const useNotesStore = create<NotesState>((set) => ({
  notes: [],

  loadNotes: (notes) => set({ notes: notes.map((note) => ({ ...note })) }),

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
      notes: state.notes.map((n) => {
        if (n.id !== id) return n;
        const updated = { ...n, ...changes, updatedAt: new Date().toISOString() };
        if (changes.bodyMd !== undefined) {
          updated.bodyPlain = markdownToPlainText(changes.bodyMd);
        }
        return updated;
      }),
    })),

  deleteNote: (id) =>
    set((state) => ({
      notes: state.notes.map((n) =>
        n.id === id ? { ...n, deletedAt: new Date().toISOString() } : n,
      ),
    })),

  addConflictCopy: (note) => set((state) => ({ notes: [{ ...note }, ...state.notes] })),
}));

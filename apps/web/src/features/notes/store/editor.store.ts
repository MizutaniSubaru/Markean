import { create } from "zustand";

export type MobileView = "folders" | "notes" | "editor";

type EditorState = {
  activeFolderId: string;
  activeNoteId: string;
  searchQuery: string;
  mobileView: MobileView;
  newNoteId: string | null;
  selectFolder: (id: string) => void;
  selectNote: (id: string) => void;
  setSearchQuery: (query: string) => void;
  setMobileView: (view: MobileView) => void;
  setNewNoteId: (id: string | null) => void;
};

export const useEditorStore = create<EditorState>((set) => ({
  activeFolderId: "",
  activeNoteId: "",
  searchQuery: "",
  mobileView: "folders",
  newNoteId: null,
  selectFolder: (id) => set({ activeFolderId: id, searchQuery: "" }),
  selectNote: (id) => set({ activeNoteId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setMobileView: (view) => set({ mobileView: view }),
  setNewNoteId: (id) => set({ newNoteId: id }),
}));

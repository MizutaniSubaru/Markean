import { useEffect, useMemo } from "react";
import type { FolderRecord, NoteRecord } from "@markean/domain";
import { Editor } from "../features/notes/components/desktop/Editor";
import { NoteList } from "../features/notes/components/desktop/NoteList";
import { Sidebar } from "../features/notes/components/desktop/Sidebar";
import { MobileEditor } from "../features/notes/components/mobile/MobileEditor";
import { MobileFolders } from "../features/notes/components/mobile/MobileFolders";
import { MobileNoteList } from "../features/notes/components/mobile/MobileNoteList";
import { useEditorActions } from "../features/notes/hooks/useEditorActions";
import { useNoteList } from "../features/notes/hooks/useNoteList";
import { createFolder as persistFolderCreate } from "../features/notes/persistence/folders.persistence";
import { createNote as persistNoteCreate } from "../features/notes/persistence/notes.persistence";
import { useEditorStore } from "../features/notes/store/editor.store";
import { useFoldersStore } from "../features/notes/store/folders.store";
import { useNotesStore } from "../features/notes/store/notes.store";
import { useSyncStore } from "../features/notes/store/sync.store";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { createI18n, detectLocale, I18nProvider } from "../i18n";
import { getScheduler } from "./bootstrap";

function isActiveFolder(folder: FolderRecord): boolean {
  return folder.deletedAt === null;
}

function isActiveNote(note: NoteRecord): boolean {
  return note.deletedAt === null;
}

function persistCreatedEntity(
  persist: () => Promise<void>,
  errorMessage: string,
  rollback: () => void,
): void {
  void persist()
    .then(() => {
      useSyncStore.getState().markUnsynced();
      getScheduler()?.requestSync();
    })
    .catch((error) => {
      rollback();
      console.error(errorMessage, error);
    });
}

function AppShell() {
  const i18n = useMemo(() => createI18n(detectLocale()), []);
  const isMobile = useMediaQuery("(max-width: 767px)");
  const notes = useNotesStore((state) => state.notes);
  const folders = useFoldersStore((state) => state.folders);
  const addNote = useNotesStore((state) => state.addNote);
  const addFolder = useFoldersStore((state) => state.addFolder);
  const activeFolderId = useEditorStore((state) => state.activeFolderId);
  const activeNoteId = useEditorStore((state) => state.activeNoteId);
  const searchQuery = useEditorStore((state) => state.searchQuery);
  const mobileView = useEditorStore((state) => state.mobileView);
  const newNoteId = useEditorStore((state) => state.newNoteId);
  const setSearchQuery = useEditorStore((state) => state.setSearchQuery);
  const setMobileView = useEditorStore((state) => state.setMobileView);
  const setNewNoteId = useEditorStore((state) => state.setNewNoteId);
  const editorActions = useEditorActions();
  const { notesInScope, sections: noteSections } = useNoteList(i18n.locale, i18n.t);

  useEffect(() => {
    document.documentElement.lang = i18n.locale.startsWith("zh") ? "zh-CN" : "en";
  }, [i18n.locale]);

  useEffect(() => {
    setMobileView(isMobile ? "folders" : "editor");
  }, [isMobile, setMobileView]);

  useEffect(() => {
    if (!newNoteId) return;

    const timeoutId = window.setTimeout(() => setNewNoteId(null), 1600);
    return () => window.clearTimeout(timeoutId);
  }, [newNoteId, setNewNoteId]);

  const activeNotes = notes.filter(isActiveNote);
  const activeFolders = folders.filter(isActiveFolder);
  const folderNameById = new Map(activeFolders.map((folder) => [folder.id, folder.name]));
  const sidebarFolders = activeFolders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    count: activeNotes.filter((note) => note.folderId === folder.id).length,
  }));
  const activeFolder =
    activeFolders.find((folder) => folder.id === activeFolderId) ?? activeFolders[0] ?? null;
  const activeNote = notesInScope.find((note) => note.id === activeNoteId) ?? null;
  const fallbackFolderName = i18n.locale.startsWith("zh") ? "笔记" : "Notes";
  const folderName = activeFolder?.name ?? fallbackFolderName;
  const noteListTitle = searchQuery
    ? i18n.locale.startsWith("zh")
      ? "搜索结果"
      : "Search results"
    : folderName;

  const selectFolder = (folderId: string) => {
    const nextNote = activeNotes
      .filter((note) => note.folderId === folderId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

    useEditorStore.setState({
      activeFolderId: folderId,
      activeNoteId: nextNote?.id ?? "",
      searchQuery: "",
      mobileView: isMobile ? "notes" : "editor",
    });
  };

  const selectNote = (noteId: string) => {
    const nextNote = activeNotes.find((note) => note.id === noteId);
    useEditorStore.setState({
      activeFolderId: nextNote?.folderId ?? activeFolderId,
      activeNoteId: noteId,
      mobileView: "editor",
    });
  };

  const createFolder = () => {
    const defaultName = i18n.locale.startsWith("zh") ? "新建文件夹" : "New Folder";
    const name = window.prompt(defaultName, defaultName)?.trim();
    if (!name) return;

    const previousEditorState = useEditorStore.getState();
    const folder = addFolder(name);
    useEditorStore.setState({
      activeFolderId: folder.id,
      activeNoteId: "",
      searchQuery: "",
      mobileView: isMobile ? "notes" : "editor",
    });
    persistCreatedEntity(
      () => persistFolderCreate(folder),
      "Failed to persist created folder",
      () => {
        useFoldersStore.setState((state) => ({
          folders: state.folders.filter((existing) => existing.id !== folder.id),
        }));
        useEditorStore.setState((state) =>
          state.activeFolderId === folder.id
            ? {
                activeFolderId: previousEditorState.activeFolderId,
                activeNoteId: previousEditorState.activeNoteId,
                searchQuery: previousEditorState.searchQuery,
                mobileView: previousEditorState.mobileView,
                newNoteId: previousEditorState.newNoteId,
              }
            : state,
        );
      },
    );
  };

  const createNote = () => {
    const folderId =
      isMobile && mobileView === "folders"
        ? activeFolders[0]?.id
        : activeFolder?.id ?? activeFolderId ?? activeFolders[0]?.id;
    if (!folderId) return;

    const previousEditorState = useEditorStore.getState();
    const note = addNote(folderId);
    useEditorStore.setState({
      activeFolderId: folderId,
      activeNoteId: note.id,
      searchQuery: "",
      mobileView: "editor",
      newNoteId: note.id,
    });
    persistCreatedEntity(
      () => persistNoteCreate(note),
      "Failed to persist created note",
      () => {
        useNotesStore.setState((state) => ({
          notes: state.notes.filter((existing) => existing.id !== note.id),
        }));
        useEditorStore.setState((state) =>
          state.activeNoteId === note.id || state.newNoteId === note.id
            ? {
                activeFolderId: previousEditorState.activeFolderId,
                activeNoteId: previousEditorState.activeNoteId,
                searchQuery: previousEditorState.searchQuery,
                mobileView: previousEditorState.mobileView,
                newNoteId: previousEditorState.newNoteId,
              }
            : state,
        );
      },
    );
  };

  const changeBody = (bodyMd: string) => {
    if (!activeNote) return;
    void editorActions.changeBody(activeNote.id, bodyMd);
  };

  let content;
  if (isMobile) {
    if (mobileView === "editor" && activeNote) {
      content = (
        <MobileEditor
          folderName={folderNameById.get(activeNote.folderId) ?? folderName}
          note={activeNote}
          onBack={() => setMobileView("notes")}
          onChangeBody={changeBody}
        />
      );
    } else if (mobileView === "notes") {
      content = (
        <MobileNoteList
          folderName={folderName}
          noteCount={notesInScope.length}
          sections={noteSections}
          searchQuery={searchQuery}
          onBack={() => setMobileView("folders")}
          onSearchChange={setSearchQuery}
          onSelectNote={selectNote}
          onCreateNote={createNote}
        />
      );
    } else {
      content = (
        <MobileFolders
          folders={sidebarFolders}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelectFolder={selectFolder}
          onCreateNote={createNote}
        />
      );
    }
  } else {
    content = (
      <div className="app">
        <Sidebar
          folders={sidebarFolders}
          activeFolderId={activeFolder?.id ?? ""}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelectFolder={selectFolder}
          onCreateFolder={createFolder}
        />
        <NoteList
          folderName={noteListTitle}
          noteCount={notesInScope.length}
          sections={noteSections}
          activeNoteId={activeNote?.id ?? ""}
          searchQuery={searchQuery}
          newNoteId={newNoteId}
          onSelectNote={selectNote}
          onCreateNote={createNote}
        />
        <Editor note={activeNote} onChangeBody={changeBody} />
      </div>
    );
  }

  return <I18nProvider value={i18n}>{content}</I18nProvider>;
}

export function App() {
  return <AppShell />;
}

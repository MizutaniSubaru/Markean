import { useEffect, useMemo } from "react";
import type { NoteRecord } from "@markean/domain";
import { MobileEditor } from "../features/notes/components/mobile/MobileEditor";
import { MobileFolders } from "../features/notes/components/mobile/MobileFolders";
import { MobileNoteList } from "../features/notes/components/mobile/MobileNoteList";
import { Editor } from "../features/notes/components/desktop/Editor";
import { NoteList } from "../features/notes/components/desktop/NoteList";
import { Sidebar } from "../features/notes/components/desktop/Sidebar";
import { createFolder as persistCreateFolder } from "../features/notes/persistence/folders.persistence";
import { createNote as persistCreateNote } from "../features/notes/persistence/notes.persistence";
import { useEditorActions } from "../features/notes/hooks/useEditorActions";
import { useNoteList } from "../features/notes/hooks/useNoteList";
import { useEditorStore } from "../features/notes/store/editor.store";
import { useFoldersStore } from "../features/notes/store/folders.store";
import { useNotesStore } from "../features/notes/store/notes.store";
import { useSyncStore } from "../features/notes/store/sync.store";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { createI18n, detectLocale, I18nProvider } from "../i18n";
import { getScheduler } from "./bootstrap";

function AppShell() {
  const locale = detectLocale();
  const i18n = useMemo(() => createI18n(locale), [locale]);
  const isMobile = useMediaQuery("(max-width: 767px)");

  const notes = useNotesStore((state) => state.notes);
  const addNote = useNotesStore((state) => state.addNote);
  const rawFolders = useFoldersStore((state) => state.folders);
  const addFolderToStore = useFoldersStore((state) => state.addFolder);
  const activeFolderId = useEditorStore((state) => state.activeFolderId);
  const activeNoteId = useEditorStore((state) => state.activeNoteId);
  const searchQuery = useEditorStore((state) => state.searchQuery);
  const mobileView = useEditorStore((state) => state.mobileView);
  const newNoteId = useEditorStore((state) => state.newNoteId);
  const selectFolder = useEditorStore((state) => state.selectFolder);
  const selectNote = useEditorStore((state) => state.selectNote);
  const setSearchQuery = useEditorStore((state) => state.setSearchQuery);
  const setMobileView = useEditorStore((state) => state.setMobileView);
  const setNewNoteId = useEditorStore((state) => state.setNewNoteId);

  const { changeBody } = useEditorActions();
  const { notesInScope, sections } = useNoteList(i18n.locale, i18n.t);

  const activeFolders = useMemo(
    () => rawFolders.filter((folder) => !folder.deletedAt),
    [rawFolders],
  );
  const folders = useMemo(
    () =>
      activeFolders.map((folder) => ({
        ...folder,
        count: notes.filter((note) => note.folderId === folder.id && !note.deletedAt).length,
      })),
    [activeFolders, notes],
  );
  const activeFolder = activeFolders.find((folder) => folder.id === activeFolderId) ?? activeFolders[0] ?? null;
  const activeNote: NoteRecord | null =
    notes.find((note) => note.id === activeNoteId && !note.deletedAt) ?? notesInScope[0] ?? null;

  useEffect(() => {
    document.documentElement.lang = i18n.locale.startsWith("zh") ? "zh-CN" : "en";
  }, [i18n.locale]);

  useEffect(() => {
    setMobileView(isMobile ? "folders" : "editor");
  }, [isMobile, setMobileView]);

  useEffect(() => {
    if (!newNoteId) {
      return;
    }

    const timeoutId = window.setTimeout(() => setNewNoteId(null), 1600);
    return () => window.clearTimeout(timeoutId);
  }, [newNoteId, setNewNoteId]);

  const handleSelectFolder = (folderId: string) => {
    selectFolder(folderId);
    const firstNote = notes.find((note) => note.folderId === folderId && !note.deletedAt);
    if (firstNote) {
      selectNote(firstNote.id);
    } else {
      selectNote("");
    }
    setMobileView(isMobile ? "notes" : "editor");
  };

  const handleCreateFolder = () => {
    const defaultName = i18n.locale.startsWith("zh") ? "新建文件夹" : "New Folder";
    const name = window.prompt(defaultName, defaultName)?.trim();
    if (!name) {
      return;
    }

    const folder = addFolderToStore(name);
    selectFolder(folder.id);
    selectNote("");
    useSyncStore.getState().markUnsynced();
    void persistCreateFolder(folder);
    getScheduler()?.requestSync();
    setMobileView(isMobile ? "notes" : "editor");
  };

  const handleCreateNote = () => {
    const folderId =
      isMobile && mobileView === "folders"
        ? activeFolders[0]?.id
        : activeFolder?.id ?? activeFolders[0]?.id;

    if (!folderId) {
      return;
    }

    const note = addNote(folderId);
    selectFolder(folderId);
    selectNote(note.id);
    setNewNoteId(note.id);
    setSearchQuery("");
    useSyncStore.getState().markUnsynced();
    void persistCreateNote(note);
    getScheduler()?.requestSync();
    setMobileView("editor");
  };

  const handleSelectNote = (noteId: string) => {
    selectNote(noteId);
    setMobileView("editor");
  };

  const handleChangeBody = (body: string) => {
    if (!activeNote) {
      return;
    }

    changeBody(activeNote.id, body);
  };

  const folderName = activeFolder?.name ?? (i18n.locale.startsWith("zh") ? "笔记" : "Notes");

  let content;
  if (isMobile) {
    if (mobileView === "editor" && activeNote) {
      content = (
        <MobileEditor
          folderName={folderName}
          note={activeNote}
          onBack={() => setMobileView("notes")}
          onChangeBody={handleChangeBody}
        />
      );
    } else if (mobileView === "notes") {
      content = (
        <MobileNoteList
          folderName={folderName}
          noteCount={notesInScope.length}
          sections={sections}
          searchQuery={searchQuery}
          onBack={() => setMobileView("folders")}
          onSearchChange={setSearchQuery}
          onSelectNote={handleSelectNote}
          onCreateNote={handleCreateNote}
        />
      );
    } else {
      content = (
        <MobileFolders
          folders={folders}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelectFolder={handleSelectFolder}
          onCreateNote={handleCreateNote}
        />
      );
    }
  } else {
    content = (
      <div className="app">
        <Sidebar
          folders={folders}
          activeFolderId={activeFolder?.id ?? ""}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelectFolder={handleSelectFolder}
          onCreateFolder={handleCreateFolder}
        />
        <NoteList
          folderName={searchQuery ? (i18n.locale.startsWith("zh") ? "搜索结果" : "Search results") : folderName}
          noteCount={notesInScope.length}
          sections={sections}
          activeNoteId={activeNote?.id ?? ""}
          searchQuery={searchQuery}
          newNoteId={newNoteId}
          onSelectNote={handleSelectNote}
          onCreateNote={handleCreateNote}
        />
        <Editor note={activeNote} onChangeBody={handleChangeBody} />
      </div>
    );
  }

  return <I18nProvider value={i18n}>{content}</I18nProvider>;
}

export function App() {
  return <AppShell />;
}

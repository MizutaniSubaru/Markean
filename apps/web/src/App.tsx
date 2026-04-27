import { useEffect } from "react";
import { markdownToPlainText, type NoteRecord } from "@markean/domain";
import { Editor } from "./features/notes/components/desktop/Editor";
import { NoteList } from "./features/notes/components/desktop/NoteList";
import { Sidebar } from "./features/notes/components/desktop/Sidebar";
import { MobileEditor } from "./features/notes/components/mobile/MobileEditor";
import { MobileFolders } from "./features/notes/components/mobile/MobileFolders";
import { MobileNoteList } from "./features/notes/components/mobile/MobileNoteList";
import { useSyncStore } from "./features/notes/store/sync.store";
import { I18nProvider } from "./i18n";
import type { WorkspaceNote } from "./lib/storage";
import { useAppModel } from "./useAppModel";

function toNoteRecord(note: WorkspaceNote | null): NoteRecord | null {
  if (!note) return null;

  return {
    id: note.id,
    folderId: note.folderId,
    title: note.title,
    bodyMd: note.body,
    bodyPlain: markdownToPlainText(note.body),
    currentRevision: 0,
    updatedAt: note.updatedAt,
    deletedAt: null,
  };
}

function AppShell() {
  const {
    i18n,
    isMobile,
    folders,
    activeFolder,
    activeNote,
    searchQuery,
    noteSections,
    notesInScope,
    mobileView,
    newNoteId,
    syncStatus,
    setSearchQuery,
    selectFolder,
    createFolder,
    createNote,
    selectNote,
    changeBody,
    setMobileView,
  } = useAppModel();

  useEffect(() => {
    document.documentElement.lang = i18n.locale.startsWith("zh") ? "zh-CN" : "en";
  }, [i18n.locale]);

  useEffect(() => {
    useSyncStore.setState({
      status: syncStatus === "syncing" || syncStatus === "unsynced" ? syncStatus : "idle",
    });
  }, [syncStatus]);

  const folderName = activeFolder?.name ?? (i18n.locale.startsWith("zh") ? "笔记" : "Notes");
  const activeNoteRecord = toNoteRecord(activeNote);

  let content;
  if (isMobile) {
    if (mobileView === "editor" && activeNoteRecord) {
      content = (
        <MobileEditor
          folderName={folderName}
          note={activeNoteRecord}
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
          folders={folders}
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
          folders={folders}
          activeFolderId={activeFolder?.id ?? ""}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelectFolder={selectFolder}
          onCreateFolder={createFolder}
        />
        <NoteList
          folderName={searchQuery ? (i18n.locale.startsWith("zh") ? "搜索结果" : "Search results") : folderName}
          noteCount={notesInScope.length}
          sections={noteSections}
          activeNoteId={activeNote?.id ?? ""}
          searchQuery={searchQuery}
          newNoteId={newNoteId}
          onSelectNote={selectNote}
          onCreateNote={createNote}
        />
        <Editor note={activeNoteRecord} onChangeBody={changeBody} />
      </div>
    );
  }

  return <I18nProvider value={i18n}>{content}</I18nProvider>;
}

export function App() {
  return <AppShell />;
}

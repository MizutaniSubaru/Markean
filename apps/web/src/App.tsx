import { useEffect } from "react";
import { Editor } from "./components/desktop/Editor";
import { NoteList } from "./components/desktop/NoteList";
import { Sidebar } from "./components/desktop/Sidebar";
import { MobileEditor } from "./components/mobile/MobileEditor";
import { MobileFolders } from "./components/mobile/MobileFolders";
import { MobileNoteList } from "./components/mobile/MobileNoteList";
import { I18nProvider } from "./i18n";
import { useAppModel } from "./useAppModel";

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

  const folderName = activeFolder?.name ?? (i18n.locale.startsWith("zh") ? "笔记" : "Notes");

  let content;
  if (isMobile) {
    if (mobileView === "editor" && activeNote) {
      content = (
        <MobileEditor
          folderName={folderName}
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
        <Editor note={activeNote} syncStatus={syncStatus} onChangeBody={changeBody} />
      </div>
    );
  }

  return <I18nProvider value={i18n}>{content}</I18nProvider>;
}

export function App() {
  return <AppShell />;
}

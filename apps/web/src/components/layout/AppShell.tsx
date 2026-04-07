import { useState } from "react";
import { EditorPane } from "./EditorPane";
import { FoldersPane } from "./FoldersPane";
import { NotesPane } from "./NotesPane";
import { SyncBadge } from "./SyncBadge";

const folders = [
  { id: "inbox", name: "Inbox", count: 8 },
  { id: "research", name: "Research", count: 4 },
  { id: "archive", name: "Archive", count: 19 },
];

const notes = [
  {
    id: "note-dawn",
    folderId: "research",
    title: "Dawn notes",
    summary: "Map the opening scene with a softer cadence.",
    body: "# Dawn notes\n\nKeep the first paragraph quiet.",
  },
  {
    id: "note-margin",
    folderId: "inbox",
    title: "Margin draft",
    summary: "Trim the middle section and keep the pulse steady.",
    body: "# Margin draft\n\nA calmer pass on the middle section.",
  },
  {
    id: "note-archive",
    folderId: "archive",
    title: "Archive note",
    summary: "Hold one reference note for later comparison.",
    body: "# Archive note\n\nReference lines and tone samples.",
  },
];

export function AppShell() {
  const [previewMode, setPreviewMode] = useState(false);
  const activeNote = notes[0];

  return (
    <div className="app-shell">
      <header className="shell-header">
        <div>
          <p className="eyebrow">Markean</p>
          <h1 className="shell-title">A quiet writing workspace</h1>
        </div>
        <div className="shell-status">
          <SyncBadge />
          <div className="mode-toggle" role="group" aria-label="Editor mode">
            <button
              className="mode-toggle__button"
              type="button"
              aria-pressed={!previewMode}
              onClick={() => setPreviewMode(false)}
            >
              Edit
            </button>
            <button
              className="mode-toggle__button"
              type="button"
              aria-pressed={previewMode}
              onClick={() => setPreviewMode(true)}
            >
              Preview
            </button>
          </div>
        </div>
      </header>

      <main className="workspace-grid">
        <FoldersPane folders={folders} activeFolderId="research" />
        <NotesPane notes={notes} activeNoteId={activeNote.id} />
        <EditorPane note={activeNote} previewMode={previewMode} />
      </main>
    </div>
  );
}

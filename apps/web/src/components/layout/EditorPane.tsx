import { MarkdownIcon } from "./icons";

type Note = {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
} | null;

type EditorPaneProps = {
  note: Note;
  previewMode: boolean;
  onCreateNote: () => void;
  onChangeTitle: (title: string) => void;
  onChangeBody: (body: string) => void;
  onTogglePreview: (preview: boolean) => void;
};

function formatStamp(updatedAt: string) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(updatedAt));
}

export function EditorPane({
  note,
  previewMode,
  onCreateNote,
  onChangeTitle,
  onChangeBody,
  onTogglePreview,
}: EditorPaneProps) {
  return (
    <section className="pane pane--editor" aria-labelledby="editor-title">
      <div className="editor-topbar">
        <div>
          <p className="pane__eyebrow">Markdown note</p>
          <h2 className="pane__title" id="editor-title">
            Editor
          </h2>
        </div>
        <div className="editor-mode-toggle" role="group" aria-label="Markdown mode">
          <button
            className="editor-mode-toggle__button"
            type="button"
            aria-pressed={!previewMode}
            onClick={() => onTogglePreview(false)}
          >
            Edit
          </button>
          <button
            className="editor-mode-toggle__button"
            type="button"
            aria-pressed={previewMode}
            onClick={() => onTogglePreview(true)}
          >
            <MarkdownIcon className="editor-mode-toggle__icon" />
            <span>Markdown</span>
          </button>
        </div>
      </div>

      {!note ? (
        <div className="empty-state empty-state--editor">
          <p className="empty-state__title">Pick a note or create a new one.</p>
          <p className="empty-state__copy">This is a notes app first, with Markdown sitting quietly underneath.</p>
          <button className="pane-icon-button pane-icon-button--wide" type="button" onClick={onCreateNote}>
            <span>Create first note</span>
          </button>
        </div>
      ) : (
        <div className="editor-document">
          {previewMode ? (
            <>
              <div className="editor-document__header">
                <p className="editor-document__stamp">{formatStamp(note.updatedAt)}</p>
                <p className="pane__subtitle">Previewing Markdown</p>
              </div>
              <article className="editor-preview">
                <h3>{note.title.trim() || "Untitled note"}</h3>
                <p>{note.body || "Start writing to preview this note."}</p>
              </article>
            </>
          ) : (
            <>
              <div className="editor-document__header">
                <input
                  className="editor-title-input"
                  type="text"
                  aria-label="Note title"
                  placeholder="Untitled note"
                  value={note.title}
                  onChange={(event) => onChangeTitle(event.target.value)}
                />
                <p className="editor-document__stamp">{formatStamp(note.updatedAt)}</p>
                <p className="pane__subtitle">Editing Markdown</p>
              </div>
              <textarea
                className="editor-input"
                value={note.body}
                aria-label="Note body"
                placeholder="Write with Markdown, but keep the surface as calm as Notes."
                onChange={(event) => {
                  onChangeBody(event.target.value);
                }}
              />
            </>
          )}
        </div>
      )}
    </section>
  );
}

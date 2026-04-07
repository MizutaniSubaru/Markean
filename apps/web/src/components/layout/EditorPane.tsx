type Note = {
  id: string;
  folderId: string;
  title: string;
  summary: string;
  body: string;
};

type EditorPaneProps = {
  note: Note;
  previewMode: boolean;
};

export function EditorPane({ note, previewMode }: EditorPaneProps) {
  return (
    <section className="pane pane--editor" aria-labelledby="editor-title">
      <div className="pane__header pane__header--editor">
        <div>
          <h2 className="pane__title" id="editor-title">
            Editor
          </h2>
          <p className="pane__subtitle">
            {previewMode ? "Previewing note" : "Editing note"}
          </p>
        </div>
        <p className="editor-note-title">{note.title}</p>
      </div>
      <div className="editor-surface">
        {previewMode ? (
          <article className="editor-preview">
            <h3>{note.title}</h3>
            <p>{note.body}</p>
          </article>
        ) : (
          <textarea className="editor-input" defaultValue={note.body} aria-label={note.title} />
        )}
      </div>
    </section>
  );
}

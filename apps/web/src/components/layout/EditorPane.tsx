import { useEffect, useState } from "react";
import { getDraft, saveDraft } from "../../lib/storage";

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
  const [body, setBody] = useState(() => getDraft(note.id, note.body));

  useEffect(() => {
    setBody(getDraft(note.id, note.body));
  }, [note.body, note.id]);

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
            <p>{body}</p>
          </article>
        ) : (
          <textarea
            className="editor-input"
            value={body}
            aria-label="Note body"
            onChange={(event) => {
              const nextBody = event.target.value;
              setBody(nextBody);
              saveDraft(note.id, nextBody);
            }}
          />
        )}
      </div>
    </section>
  );
}

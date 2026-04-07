type Note = {
  id: string;
  folderId: string;
  title: string;
  summary: string;
  body: string;
};

type NotesPaneProps = {
  notes: Note[];
  activeNoteId: string;
};

export function NotesPane({ notes, activeNoteId }: NotesPaneProps) {
  return (
    <section className="pane pane--notes" aria-labelledby="notes-title">
      <div className="pane__header">
        <h2 className="pane__title" id="notes-title">
          Notes
        </h2>
        <p className="pane__subtitle">Select the passage you want to refine.</p>
      </div>
      <ul className="notes-list">
        {notes.map((note) => (
          <li key={note.id}>
            <article className="note-card" data-active={note.id === activeNoteId ? "true" : undefined}>
              <h3 className="note-card__title">{note.title}</h3>
              <p className="note-card__summary">{note.summary}</p>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}

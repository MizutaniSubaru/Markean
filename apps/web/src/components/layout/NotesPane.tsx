import { ComposeIcon, NoteIcon } from "./icons";

type NoteItem = {
  id: string;
  title: string;
  summary: string;
  timeLabel: string;
  folderName?: string;
};

type NotesSection = {
  label: string;
  items: NoteItem[];
};

type NotesPaneProps = {
  title: string;
  subtitle: string;
  sections: NotesSection[];
  activeNoteId: string;
  onCreateNote: () => void;
  onSelectNote: (noteId: string) => void;
};

export function NotesPane({
  title,
  subtitle,
  sections,
  activeNoteId,
  onCreateNote,
  onSelectNote,
}: NotesPaneProps) {
  return (
    <section className="pane pane--notes" aria-label="Notes">
      <div className="pane__toolbar pane__toolbar--notes">
        <div>
          <p className="pane__eyebrow">Library</p>
          <h2 className="pane__title" id="notes-title">
            {title}
          </h2>
          <p className="pane__subtitle">{subtitle}</p>
        </div>
        <button className="pane-icon-button" type="button" aria-label="New note" onClick={onCreateNote}>
          <ComposeIcon className="pane-icon-button__icon" />
        </button>
      </div>

      <div className="pane__body">
        {sections.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state__title">No matching notes yet.</p>
            <p className="empty-state__copy">Try another search or create a new note in this workspace.</p>
          </div>
        ) : (
          <div className="notes-groups">
            {sections.map((section) => (
              <section className="notes-group" key={section.label} aria-label={section.label}>
                <h3 className="notes-group__title">{section.label}</h3>
                <ul className="note-list">
                  {section.items.map((note) => (
                    <li key={note.id}>
                      <button
                        className="note-row"
                        type="button"
                        data-active={note.id === activeNoteId ? "true" : undefined}
                        onClick={() => onSelectNote(note.id)}
                      >
                        <span className="note-row__time">{note.timeLabel}</span>
                        <span className="note-row__title">{note.title}</span>
                        <span className="note-row__summary">{note.summary}</span>
                        <span className="note-row__meta">
                          <NoteIcon className="note-row__icon" />
                          <span>{note.folderName ?? "Markdown"}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

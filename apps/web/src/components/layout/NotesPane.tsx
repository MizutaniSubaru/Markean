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
    <div className="notes-pane-container">
      <div className="list-header">
        <div>{title}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', fontWeight: 'normal', color: 'var(--text-secondary)' }}>{subtitle}</span>
          <button onClick={onCreateNote} aria-label="New note" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--apple-blue)' }}>
            <ComposeIcon />
          </button>
        </div>
      </div>
      
      {sections.length === 0 ? (
        <div style={{ padding: '20px', color: 'var(--text-secondary)', textAlign: 'center', fontSize: '14px' }}>
          No notes here yet.
        </div>
      ) : (
        sections.map((section) => (
          <div key={section.label}>
            <div style={{ padding: '4px 20px', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', background: '#fcfcfc', borderBottom: '0.5px solid var(--divider-color)', borderTop: '0.5px solid var(--divider-color)' }}>
              {section.label}
            </div>
            {section.items.map((note) => (
              <button 
                key={note.id} 
                className={`note-item ${note.id === activeNoteId ? 'active' : ''}`}
                onClick={() => onSelectNote(note.id)}
                style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '12px 20px', fontFamily: 'inherit' }}
              >
                <div className="note-title">{note.title}</div>
                <div className="note-line2">
                  <span className="note-time">{note.timeLabel}</span>
                  <span className="note-snippet">{note.summary}</span>
                </div>
                <div className="note-folder">
                  📁 {note.folderName ?? "Markdown"}
                </div>
              </button>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

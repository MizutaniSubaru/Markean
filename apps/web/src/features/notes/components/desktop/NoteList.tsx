import type { ReactNode } from "react";
import { useI18n } from "../../../../i18n";
import { ComposeIcon, MoreIcon } from "../shared/Icons";

type NoteItem = {
  id: string;
  title: string;
  preview: string;
  date: string;
  folderName?: string;
};

type NoteSection = {
  label: string;
  items: NoteItem[];
};

type NoteListProps = {
  folderName: string;
  noteCount: number;
  sections: NoteSection[];
  activeNoteId: string;
  searchQuery: string;
  newNoteId: string | null;
  onSelectNote: (noteId: string) => void;
  onCreateNote: () => void;
  onOpenActions?: () => void;
};

function highlightText(text: string, query: string): ReactNode {
  if (!query) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);

  if (idx === -1) return text;

  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export function NoteList({
  folderName,
  noteCount,
  sections,
  activeNoteId,
  searchQuery,
  newNoteId,
  onSelectNote,
  onCreateNote,
  onOpenActions,
}: NoteListProps) {
  const { t } = useI18n();

  return (
    <section className="note-list">
      <div className="note-list-header">
        <div>
          <div className="note-list-title">{folderName}</div>
          <div className="note-list-meta">{t("noteList.count", { n: noteCount })}</div>
        </div>
        <div className="note-list-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label={t("noteList.newNote")}
            title={t("noteList.newNote")}
            onClick={onCreateNote}
          >
            <ComposeIcon />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="More actions"
            title="More actions"
            onClick={onOpenActions}
            disabled={!onOpenActions}
          >
            <MoreIcon />
          </button>
        </div>
      </div>

      <div className="note-list-scroll">
        {sections.length === 0 && (
          <div
            style={{
              padding: "40px 14px",
              textAlign: "center",
              color: "var(--text-tertiary)",
              fontSize: 14,
            }}
          >
            {t("noteList.empty")}
          </div>
        )}

        {sections.map((section) => (
          <div key={section.label}>
            <div className="note-group-label">{section.label}</div>
            {section.items.map((note) => (
              <button
                type="button"
                key={note.id}
                className={`note-card${activeNoteId === note.id ? " active" : ""}${note.id === newNoteId ? " note-card-new" : ""}`}
                aria-pressed={activeNoteId === note.id}
                onClick={() => onSelectNote(note.id)}
              >
                <div className="note-card-text">
                  <div className="note-card-title">
                    {highlightText(note.title, searchQuery)}
                  </div>
                  <div className="note-card-date">{note.date}</div>
                  <div className="note-card-preview">
                    {highlightText(note.preview, searchQuery)}
                  </div>
                  {note.folderName && (
                    <div className="note-card-tag">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <rect
                          x="1"
                          y="2"
                          width="8"
                          height="6"
                          rx="1"
                          stroke="currentColor"
                          strokeWidth="1"
                        />
                      </svg>
                      {note.folderName}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

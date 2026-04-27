import { useI18n } from "../../../../i18n";
import { BackIcon, ComposeIcon, SearchIcon } from "../shared/Icons";
import "../../../../styles/mobile.css";

type MobileNoteItem = {
  id: string;
  title: string;
  preview: string;
  date: string;
};

type MobileNoteSection = {
  label: string;
  items: MobileNoteItem[];
};

type MobileNoteListProps = {
  folderName: string;
  noteCount: number;
  sections: MobileNoteSection[];
  searchQuery: string;
  onBack: () => void;
  onSearchChange: (value: string) => void;
  onSelectNote: (noteId: string) => void;
  onCreateNote: () => void;
};

export function MobileNoteList({
  folderName,
  noteCount,
  sections,
  searchQuery,
  onBack,
  onSearchChange,
  onSelectNote,
  onCreateNote,
}: MobileNoteListProps) {
  const { t } = useI18n();

  return (
    <section className="mobile-app">
      <div className="mobile-nav">
        <button
          type="button"
          className="mobile-nav-back"
          onClick={onBack}
        >
          <BackIcon />
          <span>{t("mobile.folders")}</span>
        </button>
        <div className="mobile-nav-title">{folderName}</div>
        <div className="mobile-nav-actions" />
      </div>

      <div className="mobile-page">
        <div className="mobile-page-title">{folderName}</div>
        <div className="mobile-page-count">{t("noteList.count", { n: noteCount })}</div>

        {sections.map((section) => (
          <div key={section.label} className="mobile-note-group">
            <div className="mobile-note-group-label">{section.label}</div>
            {section.items.map((note) => (
              <button
                key={note.id}
                type="button"
                className="mobile-note-card"
                onClick={() => onSelectNote(note.id)}
              >
                <div className="mobile-note-card-title">{note.title}</div>
                <div className="mobile-note-card-meta">{note.date}</div>
                <div className="mobile-note-card-preview">{note.preview}</div>
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="mobile-bottom-bar">
        <label className="mobile-search-bar">
          <SearchIcon />
          <input
            aria-label={t("sidebar.search")}
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t("sidebar.search")}
          />
        </label>
        <button
          type="button"
          className="mobile-compose-btn"
          aria-label={t("noteList.newNote")}
          onClick={onCreateNote}
        >
          <ComposeIcon color="currentColor" />
        </button>
      </div>
    </section>
  );
}

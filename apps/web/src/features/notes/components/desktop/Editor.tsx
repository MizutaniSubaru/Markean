import type { NoteRecord } from "@markean/domain";
import { useI18n } from "../../../../i18n";
import { MarkeanEditor } from "../editor/MarkeanEditor";
import { EmptyNoteIcon } from "../shared/Icons";
import { SyncStatusBadge } from "../shared/SyncStatusBadge";

type EditorProps = {
  note: NoteRecord | null;
  onChangeBody: (body: string) => void;
};

function formatModifiedDate(isoString: string, locale: string): string {
  return new Intl.DateTimeFormat(locale.startsWith("zh") ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoString));
}

export function Editor({ note, onChangeBody }: EditorProps) {
  const { t, locale } = useI18n();

  if (!note) {
    return (
      <div className="editor-pane">
        <div className="no-note">
          <EmptyNoteIcon />
          <span>{t("editor.noSelection")}</span>
          <span style={{ fontSize: 13, color: "var(--text-tertiary)" }}>
            {t("editor.noSelectionHint")}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-pane">
      <div className="editor-meta">
        <span>{formatModifiedDate(note.updatedAt, locale)}</span>
        <SyncStatusBadge />
      </div>
      <div className="editor-scroll">
        <MarkeanEditor key={note.id} content={note.bodyMd} onChange={onChangeBody} />
      </div>
    </div>
  );
}

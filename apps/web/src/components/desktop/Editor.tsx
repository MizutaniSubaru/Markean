import { useI18n } from "../../i18n";
import type { SyncStatus, WorkspaceNote } from "../../lib/storage";
// @ts-expect-error Task 11 introduces this component.
import { MarkeanEditor } from "../editor/MarkeanEditor";
import { EmptyNoteIcon, SyncIcon } from "../shared/Icons";

type EditorProps = {
  note: WorkspaceNote | null;
  syncStatus: SyncStatus;
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

export function Editor({ note, syncStatus, onChangeBody }: EditorProps) {
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

  const syncLabel =
    syncStatus === "syncing"
      ? t("editor.syncing")
      : syncStatus === "unsynced"
        ? t("editor.unsynced")
        : t("editor.synced");

  return (
    <div className="editor-pane">
      <div className="editor-meta">
        <span>{formatModifiedDate(note.updatedAt, locale)}</span>
        <span className="sync-badge">
          <SyncIcon />
          {syncLabel}
        </span>
      </div>
      <div className="editor-scroll">
        <MarkeanEditor key={note.id} content={note.body} onChange={onChangeBody} />
      </div>
    </div>
  );
}

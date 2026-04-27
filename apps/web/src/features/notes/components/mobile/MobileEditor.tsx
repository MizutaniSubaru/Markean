import type { NoteRecord } from "@markean/domain";
import { useI18n } from "../../../../i18n";
import { MarkeanEditor } from "../editor/MarkeanEditor";
import { BackIcon } from "../shared/Icons";
import "../../../../styles/mobile.css";

type MobileEditorProps = {
  folderName: string;
  note: NoteRecord;
  onBack: () => void;
  onChangeBody: (body: string) => void;
};

export function MobileEditor({
  folderName,
  note,
  onBack,
  onChangeBody,
}: MobileEditorProps) {
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
          <span>{folderName}</span>
        </button>
        <div className="mobile-nav-title">{folderName}</div>
        <div className="mobile-nav-actions">
          <button type="button" onClick={onBack}>
            {t("mobile.done")}
          </button>
        </div>
      </div>

      <div className="mobile-editor">
        <MarkeanEditor key={note.id} content={note.bodyMd} onChange={onChangeBody} />
      </div>
    </section>
  );
}

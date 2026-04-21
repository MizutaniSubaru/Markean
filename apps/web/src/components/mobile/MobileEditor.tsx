import { markdownToPlainText } from "@markean/domain";
import type { WorkspaceNote } from "../../lib/storage";
import { MobileEditor as FeatureMobileEditor } from "../../features/notes/components/mobile/MobileEditor";

type MobileEditorProps = {
  folderName: string;
  note: WorkspaceNote;
  onBack: () => void;
  onChangeBody: (body: string) => void;
};

export function MobileEditor(props: MobileEditorProps) {
  const { note, ...rest } = props;

  return (
    <FeatureMobileEditor
      {...rest}
      note={{
        id: note.id,
        folderId: note.folderId,
        title: note.title,
        bodyMd: note.body,
        bodyPlain: markdownToPlainText(note.body),
        currentRevision: 0,
        updatedAt: note.updatedAt,
        deletedAt: null,
      }}
    />
  );
}

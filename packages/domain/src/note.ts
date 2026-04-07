export type NoteRecord = {
  id: string;
  folderId: string;
  title: string;
  bodyMd: string;
  bodyPlain: string;
  currentRevision: number;
  updatedAt: string;
  deletedAt: string | null;
};

export function markdownToPlainText(markdown: string): string {
  return markdown.replace(/[#*_`>-]/g, "").replace(/\n+/g, " ").trim();
}

export function createNoteRecord(input: {
  id: string;
  folderId: string;
  title: string;
  bodyMd: string;
}): NoteRecord {
  return {
    id: input.id,
    folderId: input.folderId,
    title: input.title,
    bodyMd: input.bodyMd,
    bodyPlain: markdownToPlainText(input.bodyMd),
    currentRevision: 1,
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };
}

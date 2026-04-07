export type FolderRecord = {
  id: string;
  name: string;
  currentRevision: number;
  updatedAt: string;
  deletedAt: string | null;
};

export function createFolderRecord(input: { id: string; name: string }): FolderRecord {
  return {
    id: input.id,
    name: input.name,
    currentRevision: 1,
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };
}

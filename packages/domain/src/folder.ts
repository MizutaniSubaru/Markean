export type FolderRecord = {
  id: string;
  name: string;
  sortOrder: number;
  currentRevision: number;
  updatedAt: string;
  deletedAt: string | null;
};

export function createFolderRecord(input: { id: string; name: string; sortOrder: number }): FolderRecord {
  return {
    id: input.id,
    name: input.name,
    sortOrder: input.sortOrder,
    currentRevision: 1,
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };
}

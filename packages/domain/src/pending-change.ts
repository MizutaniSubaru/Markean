export type PendingChange = {
  clientChangeId: string;
  entityType: "folder" | "note";
  entityId: string;
  operation: "create" | "update" | "delete";
  baseRevision: number;
};

export function createPendingChange(input: Omit<PendingChange, "clientChangeId">): PendingChange {
  return {
    ...input,
    clientChangeId: `chg_${crypto.randomUUID()}`,
  };
}

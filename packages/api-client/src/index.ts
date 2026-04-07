export type BootstrapResponse = {
  user?: { id: string; email?: string };
  folders: unknown[];
  notes: unknown[];
  syncCursor: number;
};

export function createApiClient(baseUrl = "") {
  const prefix = baseUrl.replace(/\/$/, "");

  return {
    async bootstrap(): Promise<BootstrapResponse> {
      const response = await fetch(`${prefix}/api/bootstrap`, {
        credentials: "include",
      });

      return response.json();
    },
  };
}

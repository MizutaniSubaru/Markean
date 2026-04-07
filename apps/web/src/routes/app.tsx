import { useEffect } from "react";
import { AppShell } from "../components/layout/AppShell";
import { getSyncStatus, setSyncStatus } from "../lib/storage";
import { startBackgroundSync } from "../lib/sync";

export function AppRoute() {
  useEffect(() => {
    return startBackgroundSync(async () => {
      if (!navigator.onLine) {
        return;
      }

      if (getSyncStatus() !== "unsynced") {
        return;
      }

      setSyncStatus("syncing");
      await Promise.resolve();
      setSyncStatus("idle");
    });
  }, []);

  return <AppShell />;
}

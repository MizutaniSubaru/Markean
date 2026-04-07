import { useEffect, useState } from "react";
import { getSyncStatus, subscribeToStorageState } from "../../lib/storage";

export function SyncBadge() {
  const [status, setStatus] = useState(getSyncStatus);

  useEffect(() => subscribeToStorageState(() => setStatus(getSyncStatus())), []);

  const label = status === "unsynced" ? "Unsynced" : status === "syncing" ? "Syncing" : "Synced";

  return (
    <div className="sync-badge" data-status={status} role="status" aria-live="polite">
      <span className="sync-badge__dot" />
      <span>{label}</span>
    </div>
  );
}

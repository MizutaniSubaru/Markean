export function SyncBadge() {
  return (
    <div className="sync-badge" role="status" aria-live="polite">
      <span className="sync-badge__dot" />
      <span>Synced locally</span>
    </div>
  );
}

import { useI18n } from "../../../../i18n";
import { useSyncStore } from "../../store/sync.store";
import { SyncIcon } from "./Icons";

export function SyncStatusBadge() {
  const status = useSyncStore((state) => state.status);
  const { t } = useI18n();

  const label =
    status === "syncing"
      ? t("editor.syncing")
      : status === "unsynced" || status === "error"
        ? t("editor.unsynced")
        : t("editor.synced");

  return (
    <span className="sync-badge">
      <SyncIcon />
      {label}
    </span>
  );
}

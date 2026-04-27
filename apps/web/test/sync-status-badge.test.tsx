import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import type { ReactElement } from "react";

import { SyncStatusBadge } from "../src/features/notes/components/shared/SyncStatusBadge";
import { useSyncStore } from "../src/features/notes/store/sync.store";
import { I18nProvider, createI18n } from "../src/i18n";

const i18n = createI18n("en");

function renderWithI18n(ui: ReactElement) {
  return render(<I18nProvider value={i18n}>{ui}</I18nProvider>);
}

describe("SyncStatusBadge", () => {
  afterEach(() => {
    cleanup();
    useSyncStore.setState({
      status: "idle",
      isOnline: true,
      lastSyncedAt: null,
      activeRunId: null,
    });
  });

  it("renders localized sync labels from the sync store status", () => {
    useSyncStore.setState({ status: "syncing" });
    const { rerender } = renderWithI18n(<SyncStatusBadge />);
    expect(screen.getByText("Syncing")).toBeInTheDocument();

    useSyncStore.setState({ status: "unsynced" });
    rerender(
      <I18nProvider value={i18n}>
        <SyncStatusBadge />
      </I18nProvider>,
    );
    expect(screen.getByText("Unsynced")).toBeInTheDocument();

    useSyncStore.setState({ status: "error" });
    rerender(
      <I18nProvider value={i18n}>
        <SyncStatusBadge />
      </I18nProvider>,
    );
    expect(screen.getByText("Unsynced")).toBeInTheDocument();

    useSyncStore.setState({ status: "idle" });
    rerender(
      <I18nProvider value={i18n}>
        <SyncStatusBadge />
      </I18nProvider>,
    );
    expect(screen.getByText("Synced")).toBeInTheDocument();
  });
});

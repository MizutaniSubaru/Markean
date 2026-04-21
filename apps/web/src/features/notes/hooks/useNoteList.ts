import { useMemo } from "react";
import type { NoteRecord } from "@markean/domain";
import { useEditorStore } from "../store/editor.store";
import { useFoldersStore } from "../store/folders.store";
import { useNotesStore } from "../store/notes.store";

export type NoteItem = {
  id: string;
  title: string;
  preview: string;
  date: string;
  folderName?: string;
};

export type NoteSection = {
  label: string;
  items: NoteItem[];
};

function formatNoteTitle(note: NoteRecord): string {
  const trimmed = note.title.trim();
  if (trimmed) {
    return trimmed;
  }

  const firstLine = note.bodyMd
    .split(/\n+/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean);

  return firstLine ?? "Untitled";
}

function summarizeNote(bodyMd: string): string {
  const summary = bodyMd.replace(/^#+\s*/gm, "").replace(/\s+/g, " ").trim();
  if (!summary) {
    return "";
  }

  return summary.length > 120 ? `${summary.slice(0, 120).trimEnd()}...` : summary;
}

function sortNotes(notes: NoteRecord[]): NoteRecord[] {
  return [...notes].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function deriveNoteList(
  locale: string,
  t?: (key: string, params?: Record<string, string | number>) => string,
) {
  const notes = useNotesStore.getState().notes;
  const { activeFolderId, searchQuery } = useEditorStore.getState();
  const folders = useFoldersStore.getState().folders;
  const folderNameById = new Map(folders.map((folder) => [folder.id, folder.name]));

  const query = searchQuery.trim().toLowerCase();
  const activeNotes = notes.filter((note) => !note.deletedAt);

  const filtered = query
    ? activeNotes.filter((note) => {
        const haystack =
          `${formatNoteTitle(note)}\n${note.bodyMd}\n${folderNameById.get(note.folderId) ?? ""}`.toLowerCase();
        return haystack.includes(query);
      })
    : activeNotes.filter((note) => note.folderId === activeFolderId);

  const sorted = sortNotes(filtered);
  const now = Date.now();
  const label7d = t ? t("noteList.group.7d") : "Last 7 Days";
  const label30d = t ? t("noteList.group.30d") : "Last 30 Days";
  const labelOlder = t ? t("noteList.group.older") : "Older";
  const dateLocale = locale.startsWith("zh") ? "zh-CN" : "en-US";

  const grouped = new Map<string, NoteItem[]>();
  for (const note of sorted) {
    const diffDays = Math.floor((now - new Date(note.updatedAt).getTime()) / 86_400_000);
    const label = diffDays <= 7 ? label7d : diffDays <= 30 ? label30d : labelOlder;
    const items = grouped.get(label) ?? [];

    items.push({
      id: note.id,
      title: formatNoteTitle(note),
      preview: summarizeNote(note.bodyMd),
      date: new Intl.DateTimeFormat(dateLocale, {
        month: "short",
        day: "numeric",
      }).format(new Date(note.updatedAt)),
      folderName: query ? folderNameById.get(note.folderId) : undefined,
    });

    grouped.set(label, items);
  }

  const sections: NoteSection[] = Array.from(grouped.entries()).map(([label, items]) => ({
    label,
    items,
  }));

  return { notesInScope: filtered, sections };
}

export function useNoteList(
  locale: string,
  t?: (key: string, params?: Record<string, string | number>) => string,
) {
  const notes = useNotesStore((state) => state.notes);
  const searchQuery = useEditorStore((state) => state.searchQuery);
  const activeFolderId = useEditorStore((state) => state.activeFolderId);
  const folders = useFoldersStore((state) => state.folders);

  return useMemo(
    () => deriveNoteList(locale, t),
    [notes, searchQuery, activeFolderId, folders, locale, t],
  );
}

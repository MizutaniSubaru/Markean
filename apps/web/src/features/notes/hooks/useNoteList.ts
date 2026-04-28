import type { NoteRecord } from "@markean/domain";
import { useEditorStore } from "../store/editor.store";
import { useFoldersStore } from "../store/folders.store";
import { useNotesStore } from "../store/notes.store";

export type NoteListTranslator = (
  key: string,
  params?: Record<string, string | number>,
) => string;

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

export type NoteListResult = {
  notesInScope: NoteRecord[];
  sections: NoteSection[];
};

const FALLBACK_LABELS: Record<string, string> = {
  "noteList.group.7d": "Last 7 Days",
  "noteList.group.30d": "Last 30 Days",
  "noteList.group.older": "Older",
};

function translate(key: string, t?: NoteListTranslator): string {
  return t?.(key) ?? FALLBACK_LABELS[key] ?? key;
}

function stripHeadingMarker(line: string): string {
  return line.replace(/^#+\s*/, "").trim();
}

function deriveTitleFromBody(bodyMd: string): string {
  return bodyMd
    .split(/\n+/)
    .map(stripHeadingMarker)
    .find(Boolean) ?? "Untitled";
}

function formatNoteTitle(note: NoteRecord): string {
  const trimmedTitle = note.title.trim();
  return trimmedTitle || deriveTitleFromBody(note.bodyMd);
}

function summarizeNote(bodyMd: string): string {
  const summary = bodyMd.replace(/^#+\s*/gm, "").replace(/\s+/g, " ").trim();
  return summary.length > 120 ? `${summary.slice(0, 120).trimEnd()}...` : summary;
}

function formatNoteDate(locale: string, updatedAt: string): string {
  return new Intl.DateTimeFormat(locale.startsWith("zh") ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(updatedAt));
}

function groupLabel(updatedAt: string, t?: NoteListTranslator): string {
  const diffDays = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86_400_000);
  if (diffDays <= 7) return translate("noteList.group.7d", t);
  if (diffDays <= 30) return translate("noteList.group.30d", t);
  return translate("noteList.group.older", t);
}

function toNoteItem(
  note: NoteRecord,
  locale: string,
  folderNameById: Map<string, string>,
  includeFolderName: boolean,
): NoteItem {
  const item: NoteItem = {
    id: note.id,
    title: formatNoteTitle(note),
    preview: summarizeNote(note.bodyMd),
    date: formatNoteDate(locale, note.updatedAt),
  };
  if (includeFolderName) item.folderName = folderNameById.get(note.folderId);
  return item;
}

export function deriveNoteList(locale: string, t?: NoteListTranslator): NoteListResult {
  const notes = useNotesStore.getState().notes.filter((note) => note.deletedAt === null);
  const folders = useFoldersStore.getState().folders.filter((folder) => folder.deletedAt === null);
  const { activeFolderId, searchQuery } = useEditorStore.getState();
  const folderNameById = new Map(folders.map((folder) => [folder.id, folder.name]));
  const effectiveActiveFolderId = folders.some((folder) => folder.id === activeFolderId)
    ? activeFolderId
    : folders[0]?.id ?? "";
  const query = searchQuery.trim().toLowerCase();
  const notesInScope = (query
    ? notes.filter((note) => {
        const haystack = [
          formatNoteTitle(note),
          note.bodyMd,
          folderNameById.get(note.folderId) ?? "",
        ]
          .join("\n")
          .toLowerCase();
        return haystack.includes(query);
      })
    : notes.filter((note) => note.folderId === effectiveActiveFolderId)
  ).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  const grouped = new Map<string, NoteItem[]>();
  for (const note of notesInScope) {
    const label = groupLabel(note.updatedAt, t);
    const item = toNoteItem(note, locale, folderNameById, query.length > 0);
    grouped.set(label, [...(grouped.get(label) ?? []), item]);
  }

  return {
    notesInScope,
    sections: Array.from(grouped.entries()).map(([label, items]) => ({ label, items })),
  };
}

export function useNoteList(locale: string, t?: NoteListTranslator): NoteListResult {
  useNotesStore((state) => state.notes);
  useFoldersStore((state) => state.folders);
  useEditorStore((state) => state.activeFolderId);
  useEditorStore((state) => state.searchQuery);

  return deriveNoteList(locale, t);
}

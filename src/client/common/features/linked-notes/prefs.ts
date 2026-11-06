// The Notes list's per-browser choices (FR-NOTES-26, -27; N8): the sort (category fold-outs or
// Recent) and which category fold-outs are open. Session starts open, the others closed. Shared by
// every Notes window in this browser (same-tab listeners + the `storage` event); storage that
// throws or is missing just means the defaults.
import type { NoteCategory } from "@shared/linked-notes/schemas";
import { useCallback, useSyncExternalStore } from "react";

export type NotesSort = "category" | "recent";

export const SORT_KEY = "pp.notes.v1.sort";
export const GROUPS_KEY = "pp.notes.v1.groups";

/** FR-NOTES-26: open when nothing is stored for the group yet. */
export const OPEN_BY_DEFAULT: ReadonlySet<NoteCategory> = new Set(["session"]);

const listeners = new Set<() => void>();
const notify = () => {
  for (const fn of listeners) fn();
};

function get(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function put(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Private mode / blocked storage: the choice lasts for this page only.
  }
  notify();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === SORT_KEY || e.key === GROUPS_KEY) fn();
  };
  globalThis.addEventListener?.("storage", onStorage);
  return () => {
    listeners.delete(fn);
    globalThis.removeEventListener?.("storage", onStorage);
  };
}

// Kept in memory too, so a browser without storage still remembers within the page.
let memorySort: NotesSort | null = null;
let memoryGroups: Record<string, boolean> = {};

export function readSort(): NotesSort {
  const v = get(SORT_KEY) ?? memorySort;
  return v === "recent" ? "recent" : "category";
}

export function writeSort(sort: NotesSort): void {
  memorySort = sort;
  put(SORT_KEY, sort);
}

/** The stored open states, as stored (a JSON object category → boolean). */
export function readGroupsRaw(): string {
  return get(GROUPS_KEY) ?? JSON.stringify(memoryGroups);
}

export function parseGroups(raw: string): Record<string, boolean> {
  try {
    const v = JSON.parse(raw) as unknown;
    if (v === null || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, b] of Object.entries(v)) if (typeof b === "boolean") out[k] = b;
    return out;
  } catch {
    return {};
  }
}

/** FR-NOTES-26: as the person last left it, else Session open and the rest closed. */
export function groupOpen(groups: Readonly<Record<string, boolean>>, c: NoteCategory): boolean {
  return groups[c] ?? OPEN_BY_DEFAULT.has(c);
}

export function writeGroupOpen(c: NoteCategory, open: boolean): void {
  const next = { ...parseGroups(readGroupsRaw()), [c]: open };
  memoryGroups = next;
  put(GROUPS_KEY, JSON.stringify(next));
}

export function useNotesSort(): [NotesSort, (s: NotesSort) => void] {
  const sort = useSyncExternalStore(subscribe, readSort, () => "category" as const);
  return [sort, useCallback((s: NotesSort) => writeSort(s), [])];
}

export function useGroupsOpen(): [(c: NoteCategory) => boolean, typeof writeGroupOpen] {
  const raw = useSyncExternalStore(subscribe, readGroupsRaw, () => "{}");
  const groups = parseGroups(raw);
  return [(c) => groupOpen(groups, c), writeGroupOpen];
}

/** Tests: forget the in-memory fallbacks. */
export function resetNotesPrefsForTests(): void {
  memorySort = null;
  memoryGroups = {};
  notify();
}

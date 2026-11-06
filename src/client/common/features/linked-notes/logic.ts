// Pure parts of the Notes window (NOTES §7): list order, the Recycle bin, names, the status and
// banner texts, who-is-here chips. No React, no CodeMirror (tests import it directly).
import type { NoteHere } from "@shared/linked-notes/collab";
import {
  NOTE_CATEGORIES,
  type NoteActor,
  type NoteCategory,
  type NoteRecord,
} from "@shared/linked-notes/schemas";
import { titleFold } from "@shared/linked-notes/titles";
import { relativeTime } from "../notifications/logic";
import type { NoteBanner, NoteStatus } from "./session";

/** Live notes, last changed first (then title, for a stable order). */
export function liveNotes(rows: readonly NoteRecord[]): NoteRecord[] {
  return rows
    .filter((n) => n.deletedAt === null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
}

/** FR-NOTES-26: A–Z by title (case and accents aside), then id for a stable order. */
export function byTitle(a: Pick<NoteRecord, "id" | "title">, b: Pick<NoteRecord, "id" | "title">) {
  return (
    a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }) ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  );
}

export interface NoteGroup {
  category: NoteCategory;
  notes: NoteRecord[];
}

/**
 * FR-NOTES-26: the category view: live notes by category, in NOTE_CATEGORIES order (Session
 * first), A–Z inside; empty groups left out.
 */
export function groupNotes(rows: readonly NoteRecord[]): NoteGroup[] {
  const by = new Map<NoteCategory, NoteRecord[]>();
  for (const n of rows) {
    if (n.deletedAt !== null) continue;
    const list = by.get(n.category);
    if (list) list.push(n);
    else by.set(n.category, [n]);
  }
  return NOTE_CATEGORIES.flatMap((category) => {
    const notes = by.get(category);
    return notes ? [{ category, notes: notes.sort(byTitle) }] : [];
  });
}

/** FR-NOTES-27: Recent: live notes, last edited first (then A–Z). */
export function recentNotes(rows: readonly NoteRecord[]): NoteRecord[] {
  return rows
    .filter((n) => n.deletedAt === null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || byTitle(a, b));
}

/** The Recycle bin, newest first (FR-NOTES-04, NOTES §7). */
export function binnedNotes(rows: readonly NoteRecord[]): NoteRecord[] {
  return rows
    .filter((n) => n.deletedAt !== null)
    .sort(
      (a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? "") || a.id.localeCompare(b.id),
    );
}

/** "DM" or the player's name ("A player" for one this client doesn't know). */
export function nameOf(
  who: Pick<NoteActor, "role" | "playerId">,
  players: Readonly<Record<string, { name: string }>>,
): string {
  if (who.role === "dm") return "DM";
  return players[who.playerId ?? ""]?.name ?? "A player";
}

/** The status line (r1): "Saving…" only after ~1 s unconfirmed; nothing beside a deleted banner. */
export const STATUS_TEXT: Record<NoteStatus, string> = {
  loading: "Loading…",
  saving: "Saving…",
  saved: "Saved",
  offline: "Offline",
  full: "Note is full",
  none: "",
};

/** A bin row's second line in two parts: who (may truncate) and when (never wraps). */
export function deletedParts(
  n: Pick<NoteRecord, "deletedAt" | "deletedBy">,
  players: Readonly<Record<string, { name: string }>>,
  now: number,
  ago: (iso: string, now: number) => string = relativeTime,
): { who: string; when: string } {
  const name = n.deletedBy ? nameOf(n.deletedBy, players) : "someone";
  return { who: `Deleted by ${name}`, when: ago(n.deletedAt ?? "", now) };
}

/** A bin row's second line (r1): "Deleted by <name> · <when>". */
export function deletedLine(
  n: Pick<NoteRecord, "deletedAt" | "deletedBy">,
  players: Readonly<Record<string, { name: string }>>,
  now: number,
  ago: (iso: string, now: number) => string = relativeTime,
): string {
  const who = n.deletedBy ? nameOf(n.deletedBy, players) : "someone";
  return `Deleted by ${who} · ${ago(n.deletedAt ?? "", now)}`;
}

/** FR-NOTES-20, -21: the banner's line. */
export function bannerText(b: NoteBanner): string {
  switch (b.kind) {
    case "deleted":
      return "This note was deleted";
    case "gone":
      return "This note is no longer available";
    case "full":
      return "Note is full: your last changes didn't fit, so the note was reloaded";
    case "reload":
      return "The note changed a lot while you were away, so it was reloaded";
  }
}

/** N6: how long a renamed note's old title keeps resolving (its links' rewrite is on its way). */
export const RENAME_ALIAS_MS = 5_000;

/**
 * Records the old folded title of every note whose title changed since `previous` (id → title)
 * as an alias of it until `now + RENAME_ALIAS_MS`; drops expired aliases.
 */
export function renamedAliases(
  previous: ReadonlyMap<string, string>,
  titles: readonly { id: string; title: string }[],
  now: number,
  aliases: Map<string, { note: { id: string; title: string }; until: number }>,
): void {
  for (const [fold, a] of aliases) if (a.until <= now) aliases.delete(fold);
  for (const t of titles) {
    const old = previous.get(t.id);
    if (old !== undefined && titleFold(old) !== titleFold(t.title))
      aliases.set(titleFold(old), { note: t, until: now + RENAME_ALIAS_MS });
  }
}

/** Live titles by fold, plus unexpired aliases that no live note holds. */
export function withAliases<T extends { id: string; title: string }>(
  byFold: Map<string, T>,
  aliases: ReadonlyMap<string, { note: T; until: number }>,
  now: number,
): Map<string, T> {
  for (const [fold, a] of aliases) if (a.until > now && !byFold.has(fold)) byFold.set(fold, a.note);
  return byFold;
}

export interface HereChip {
  /** `data-player-id`: the player's id, "dm" for the DM. */
  key: string;
  role: "dm" | "player";
  playerId: string | null;
  you: boolean;
}

/** FR-NOTES-16: one chip per person with the note open (a person's tabs count once), you first. */
export function hereChips(
  here: readonly NoteHere[],
  me: { role: "dm" | "player"; playerId: string | null },
): HereChip[] {
  const out = new Map<string, HereChip>();
  for (const h of here) {
    const key = h.role === "dm" ? "dm" : (h.playerId ?? "");
    if (out.has(key)) continue;
    const you = h.role === me.role && (h.role === "dm" || h.playerId === me.playerId);
    out.set(key, { key, role: h.role, playerId: h.playerId, you });
  }
  return [...out.values()].sort((a, b) => Number(b.you) - Number(a.you));
}

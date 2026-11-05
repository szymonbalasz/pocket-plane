// Pure parts of the Notes window (NOTES §7): list order, the Recycle bin, names, the status and
// banner texts, who-is-here chips. No React, no CodeMirror (tests import it directly).
import type { NoteHere } from "@shared/linked-notes/collab";
import type { NoteActor, NoteRecord } from "@shared/linked-notes/schemas";
import type { NoteBanner, NoteStatus } from "./session";

/** Live notes, last changed first (then title, for a stable order). */
export function liveNotes(rows: readonly NoteRecord[]): NoteRecord[] {
  return rows
    .filter((n) => n.deletedAt === null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
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

export const STATUS_TEXT: Record<NoteStatus, string> = {
  loading: "Loading…",
  saving: "Saving…",
  saved: "Saved",
  offline: "Offline",
};

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

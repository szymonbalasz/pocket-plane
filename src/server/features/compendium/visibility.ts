// FR-CMP-14 (ADR-0024, OQ-CMP-07): who may read a compendium entry. One pure fn for search and
// GET: not visible = absent from search, GET 404 (same as an unknown id).
import type { CompendiumKind } from "@shared/compendium/schemas";

/** A REST reader: the DM (active campaign) or a player (their link's campaign). */
export interface EntryViewer {
  role: "dm" | "player";
  campaignId: string;
  playerId: string | null;
}

export interface VisibilityFields {
  campaignId: string | null;
  kind: CompendiumKind;
  shared: boolean;
}

/**
 * DM: imported + own campaign's homebrew. Player: imported non-monster + own campaign's homebrew
 * with `shared`. Other campaigns' homebrew: never.
 */
export function entryVisibleTo(e: VisibilityFields, v: EntryViewer): boolean {
  if (e.campaignId !== null && e.campaignId !== v.campaignId) return false;
  if (v.role === "dm") return true;
  if (e.kind === "monster") return false;
  return e.campaignId === null || e.shared;
}

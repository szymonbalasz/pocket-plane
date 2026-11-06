// Entry present (CMP §6.2, FR-CMP-78–83; DM #458): a compendium entry open on players' screens
// until each closes it, like a presented handout (FR-PARTY-31–37). The DM sends it after an award
// ("Show on players' screens" in Add to party). Boundary shapes, the record and its visibility
// rule. zod is the source of truth.
import { z } from "zod";

const Id = z.string().min(1).max(64);

export const ENTRY_PRESENT_TYPE = "entry-present";

export const ENTRY_PRESENT_INTENTS = {
  present: "cmp.presentEntry",
  close: "cmp.closeEntryPresent",
} as const;

/** FR-CMP-79: `cmp.presentEntry {entryId}` (DM): every player of the campaign who may read it. */
export const PresentEntryIntent = z.strictObject({ entryId: Id });
export type PresentEntryIntent = z.input<typeof PresentEntryIntent>;

export const PresentEntryResult = z.strictObject({ presentIds: z.array(z.string()) });
export type PresentEntryResult = z.infer<typeof PresentEntryResult>;

/** FR-CMP-81: `cmp.closeEntryPresent {presentId}` (player: own row; DM: any). */
export const CloseEntryPresentIntent = z.strictObject({ presentId: Id });
export type CloseEntryPresentIntent = z.input<typeof CloseEntryPresentIntent>;

/** Record `entry-present` (FR-CMP-78): DM every row, a player only their own. */
export const EntryPresentRecord = z.strictObject({
  id: z.string(),
  campaignId: z.string(),
  entryId: z.string(),
  playerId: z.string(),
  presentedAt: z.string(),
});
export type EntryPresentRecord = z.infer<typeof EntryPresentRecord>;

/** FR-CMP-79: an unshared homebrew entry (players can't read it). */
export const SHARE_ENTRY_FIRST = "Share it to show it on players' screens";
/** FR-CMP-79: monsters never reach players (FR-CMP-14). */
export const MONSTER_NOT_SHOWN = "Monsters can't be shown to players";
/** FR-CMP-79: a campaign without players. */
export const NO_PLAYERS = "No players to show it to";

/** FR-CMP-78: DM full; a player only their own row, else hidden. */
export function entryPresentVisibility(
  r: Pick<EntryPresentRecord, "playerId">,
  v: { role: "dm" | "player"; playerId: string | null },
): "full" | "hidden" {
  if (v.role === "dm") return "full";
  return v.playerId !== null && r.playerId === v.playerId ? "full" : "hidden";
}

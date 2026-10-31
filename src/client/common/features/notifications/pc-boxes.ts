// FR-NOTE-80–82 (BL-175): the PC tokens as the DM's toast stack, the damage-card popup and the roll
// popups keep off them: play-shell's PC rule (a character with an owner, not a pet or a summon) and
// footprints + 4 px, never drawn boxes (BL-115: a pulsing cue ring or a label grows those).
import { type RecordStore, recordsOf } from "@shared/protocol/store";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import type { Rect } from "../play-shell/geometry";
import { pcBoxes } from "../play-shell/placement";
import { isPlacementPc, tokenScreenBoxes } from "../play-shell/token-boxes";

/** The PC tokens' ids in `store`, sorted (a stable key for a memo). */
export function pcTokenIds(store: RecordStore | undefined): string[] {
  if (!store) return [];
  type Tok = { id: string; ownerPlayerId: string | null; characterId: string | null };
  return recordsOf<Tok>(store, TOKEN_TYPE)
    .filter((t) => isPlacementPc(t))
    .map((t) => t.id)
    .sort();
}

/** The drawn PC tokens `ids` on screen, viewport px: each footprint + 4 px. Reads the canvas. */
export function pcScreenBoxes(ids: readonly string[], store: RecordStore | undefined): Rect[] {
  return pcBoxes(tokenScreenBoxes(ids, store).map((b) => ({ ...b, pc: true })));
}

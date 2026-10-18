// Token art (FR-ENT-27, -28): what a token draws without an image, and the DM's Art menu state.
// DOM-free so it runs under `bun test`.
import type { CreatureType, TokenCreatureType } from "@shared/entities/schemas";
import { CREATURE_TYPES } from "@shared/entities/schemas";

/** The token node's `art` attr: image > creature-type art > initials (`"initials"` and null). */
export type TokenArt = "image" | CreatureType | "initials";

export function tokenArtOf(t: {
  imageAssetId: string | null;
  creatureType: TokenCreatureType | null;
}): TokenArt {
  if (t.imageAssetId) return "image";
  return t.creatureType === null || t.creatureType === "initials" ? "initials" : t.creatureType;
}

/** Glyph side as a share of the footprint (FR-ENT-28: ≈ 65 %). */
export const GLYPH_SHARE = 0.65;

/** The glyph's box inside a `side × side` footprint, centred. */
export function glyphRect(side: number): { x: number; y: number; size: number } {
  const size = side * GLYPH_SHARE;
  return { x: (side - size) / 2, y: (side - size) / 2, size };
}

/** "humanoid" → "Humanoid". */
export const creatureTypeLabel = (t: CreatureType): string =>
  t.charAt(0).toUpperCase() + t.slice(1);

export const isCreatureType = (v: unknown): v is CreatureType =>
  (CREATURE_TYPES as readonly unknown[]).includes(v);

/**
 * DM token menu Art (FR-ENT-28): "Creature type" sets the definition's current type (disabled
 * without one); "Initials" sets `"initials"`. Checked = the token's current choice; null (no type
 * known yet) checks neither.
 */
export interface ArtMenuState {
  checked: "type" | "initials" | null;
  /** The definition's type "Creature type" would set; null → that item is disabled. */
  definitionType: CreatureType | null;
}

export function artMenuState(
  token: { creatureType: TokenCreatureType | null },
  definitionType: CreatureType | null,
): ArtMenuState {
  const checked =
    token.creatureType === null ? null : token.creatureType === "initials" ? "initials" : "type";
  return { checked, definitionType };
}

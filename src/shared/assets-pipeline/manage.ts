// Rename and delete an image (ASSET §6.6, FR-ASSET-62–66; decision #386): DM-only WS intents.
// Delete refuses while anything uses the image (OQ-ASSET-05 A); the reject names the uses.
import { z } from "zod";
import { AssetName } from "./schemas";

export const ASSET_MANAGE_INTENTS = {
  rename: "assets.rename",
  delete: "assets.delete",
} as const;

const Id = z.string().min(1).max(64);

/** FR-ASSET-62: the new name, under FR-ASSET-08's rule. */
export const RenameAssetIntent = z.strictObject({ assetId: Id, name: AssetName });
export type RenameAssetIntent = z.input<typeof RenameAssetIntent>;

/** FR-ASSET-63 */
export const DeleteAssetIntent = z.strictObject({ assetId: Id });
export type DeleteAssetIntent = z.input<typeof DeleteAssetIntent>;

/** FR-ASSET-64: what can hold an image, in the order the reject lists them. */
export const ASSET_USE_KINDS = [
  "scene map",
  "prop",
  "token",
  "portrait",
  "combatant",
  "handout",
  "compendium entry",
  "pause card",
] as const;
export type AssetUseKind = (typeof ASSET_USE_KINDS)[number];

export interface AssetUse {
  kind: AssetUseKind;
  /** The holder's name (a prop: its scene's name; the pause card: none). */
  name: string | null;
}

/** FR-ASSET-64: uses named in the reject; the rest are counted. */
export const USES_SHOWN = 5;

const useText = (u: AssetUse) => (u.name === null ? u.kind : `${u.name} (${u.kind})`);

/**
 * FR-ASSET-64: "In use: Goblin Ambush (scene map), Goblin 1 (token) and 3 more. Change those
 * first." Uses as given (the server sorts them).
 */
export function inUseMessage(uses: readonly AssetUse[]): string {
  const shown = uses.slice(0, USES_SHOWN).map(useText);
  const more = uses.length - shown.length;
  const list = more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
  return `In use: ${list}. Change those first.`;
}

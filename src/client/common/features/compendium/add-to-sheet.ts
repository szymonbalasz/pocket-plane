// Add to sheet (FR-CMP-28, CMP §7), pure: which characters the picker lists (DM: every campaign
// character; player: own only) and the Toast copy. The server decides everything else.
import type { AddToSheetResult } from "@shared/compendium/homebrew";
import type { You } from "@shared/protocol/frames";

export interface CharacterOption {
  id: string;
  name: string;
}

interface EntityLike {
  id: string;
  kind: string;
  name?: string;
  ownerPlayerId?: string | null;
}

export function characterOptions(
  entities: readonly EntityLike[],
  you: Pick<You, "role" | "playerId"> | null,
): CharacterOption[] {
  if (!you) return [];
  return entities
    .filter(
      (e) =>
        e.kind === "character" &&
        typeof e.name === "string" &&
        (you.role === "dm" || e.ownerPlayerId === you.playerId),
    )
    .map((e) => ({ id: e.id, name: e.name as string }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

const LIST_LABEL: Record<AddToSheetResult["list"], string> = {
  spells: "Spells",
  items: "Items",
  features: "Features",
};

/** "Added to Mira's Features" (+ " and Triggers" when a preset was added). */
export function addedMessage(name: string, r: Pick<AddToSheetResult, "list" | "triggerId">) {
  return `Added to ${name}'s ${LIST_LABEL[r.list]}${r.triggerId ? " and Triggers" : ""}`;
}

// Preferences "Your colour" section (FR-CAMP-35 (a), FR-SHELL-72 order 10), both clients: the
// picker for the viewer's own colour: a player's `player.color`, the DM's `campaign.dmColor`.
import type { RecordStore } from "@shared/protocol/store";
import { useSync } from "../../sync/store";
import { definePrefSection } from "../play-shell/PreferencesWindow";
import { ColorPicker } from "./ColorPicker";

/** The viewer's own target: the DM colour (`null`) or the player's id; undefined before join. */
export function ownTarget(you: RecordStore["you"]): string | null | undefined {
  if (!you) return undefined;
  return you.role === "dm" ? null : (you.playerId ?? undefined);
}

function ColorSection() {
  const target = ownTarget(useSync((s) => s.store.you));
  return target === undefined ? null : <ColorPicker target={target} />;
}

export const colorSection = definePrefSection({
  id: "camp.color",
  title: "Your colour",
  order: 10,
  available: (store) => ownTarget(store.you) !== undefined,
  Component: ColorSection,
});

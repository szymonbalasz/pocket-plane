// Player `cmp.compendium` (FR-CMP-18, -19): the shared body (no Monsters tab, no import, no drag)
// over a REST client that sends the player's link token as `Authorization: Player <token>`
// (FR-CMP-13; route-local on the compendium routes only).
import { CompendiumBody } from "@ui/features/compendium/CompendiumWindow";
import { compendiumWindowBase } from "@ui/features/compendium/window";
import { defineWindow } from "@ui/features/play-shell/registry";
import { pageApi } from "@ui/session";

/** This page's player REST client (Compendium and Rules windows; the session helper, BL-94). */
export const playerApi = () => pageApi("player");

function PlayerCompendium() {
  return <CompendiumBody api={playerApi()} viewer="player" />;
}

export const playerCompendiumWindow = defineWindow({
  ...compendiumWindowBase,
  clients: ["player"],
  component: PlayerCompendium,
});

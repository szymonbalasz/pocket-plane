// Player `cmp.rules` (FR-CMP-63, -70): the shared Rules body over the player's REST client
// (`Authorization: Player <token>`, compendium routes only). Same pages and pins; House rules
// shared only (server-side); no homebrew form, no Update.
import { RulesBody } from "@ui/features/compendium/rules/RulesWindow";
import { rulesWindowBase } from "@ui/features/compendium/rules/window";
import { defineWindow } from "@ui/features/play-shell/registry";
import { playerApi } from "./compendium-window";

function PlayerRules() {
  return <RulesBody api={playerApi()} viewer="player" />;
}

export const playerRulesWindow = defineWindow({
  ...rulesWindowBase,
  clients: ["player"],
  component: PlayerRules,
});

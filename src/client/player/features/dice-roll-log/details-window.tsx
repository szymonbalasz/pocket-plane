// Player `dice.details` window (FR-DICE-106): the shared details body, no DM facts.
import { RollDetails } from "@ui/features/dice-roll-log/RollDetails";
import { diceDetailsWindowBase } from "@ui/features/dice-roll-log/window";
import { defineWindow } from "@ui/features/play-shell/registry";

function PlayerDetailsBody() {
  return <RollDetails />;
}

export const playerDiceDetailsWindow = defineWindow({
  ...diceDetailsWindowBase,
  clients: ["player"],
  component: PlayerDetailsBody,
});

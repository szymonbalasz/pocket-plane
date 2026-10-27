// Player `dice.log` window: the shared game log (public entries only; no switch or gear).
import { GameLog } from "@ui/features/dice-roll-log/GameLog";
import { diceLogWindowBase, LOG_USEFUL } from "@ui/features/dice-roll-log/window";
import { defineWindow } from "@ui/features/play-shell/registry";

function PlayerLogBody() {
  return <GameLog />;
}

export const playerDiceLogWindow = defineWindow({
  ...diceLogWindowBase,
  clients: ["player"],
  usefulSize: LOG_USEFUL,
  component: PlayerLogBody,
});

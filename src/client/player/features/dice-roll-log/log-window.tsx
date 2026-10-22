// Player `dice.log` window: the shared game log (public entries only; no switch or gear).
import { GameLog } from "@ui/features/dice-roll-log/GameLog";
import { diceLogWindowBase } from "@ui/features/dice-roll-log/window";
import { defineWindow } from "@ui/features/play-shell/registry";

function PlayerLogBody() {
  return <GameLog />;
}

export const playerDiceLogWindow = defineWindow({
  ...diceLogWindowBase,
  clients: ["player"],
  // FR-SHELL-100: 3 one-line entries + the roll bar (play-shell §7 sprint-8 useful sizes).
  usefulSize: { w: 460, h: 160 },
  component: PlayerLogBody,
});

// One live frame's new `roll` entries → the tray's own result and a throw (FR-DICEX-09, -11, -19,
// -22). The 3D chunk is asked for only when this device draws 3D: `flat` / `off` never load it.
import { type DiceThrow, throwDice } from "@shared/dice-extras/throw";
import type { GameLogEntryView } from "@shared/dice-roll-log/schemas";
import type { RecordStore } from "@shared/protocol/store";
import type { DiceSettings, RenderSetting } from "./settings";
import { isOwn } from "./throw-source";

export interface FrameDeps {
  ownRolled(entries: GameLogEntryView[]): void;
  play(t: DiceThrow): void;
  load3d(): void;
}

export function onRollFrame(
  entries: GameLogEntryView[],
  store: RecordStore,
  cfg: { settings: DiceSettings; render: RenderSetting },
  deps: FrameDeps,
): DiceThrow | null {
  const own = entries.filter((e) => isOwn(e, store.you));
  if (own.length > 0) deps.ownRolled(own); // FR-DICEX-09 / -10
  if (cfg.render === "off") return null;
  // FR-DICEX-19: "Show others' rolls" off → own throws only.
  const t = throwDice(cfg.settings.others ? entries : own);
  if (!t) return null;
  if (cfg.render === "3d") deps.load3d(); // FR-DICEX-22: the first 3D throw loads the chunk
  deps.play(t);
  return t;
}

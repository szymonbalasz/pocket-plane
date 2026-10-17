// One live frame's new `roll` entries → the tray's own result and the big throw (FR-DICEX-09,
// -11, -32, -38, -43). The 3D chunk is preloaded at idle (FR-DICEX-37); a throw that draws 3D
// before it is ready waits in the runtime (`whenChunk`).
import type { DiceThrow } from "@shared/dice-extras/throw";
import type { GameLogEntryView } from "@shared/dice-roll-log/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { type PlanInput, planThrow, type ThrowPlan } from "./display";
import { isOwn } from "./throw-source";

export interface FrameDeps {
  ownRolled(entries: GameLogEntryView[]): void;
  play(t: DiceThrow, plan: ThrowPlan): void;
}

export function onRollFrame(
  entries: GameLogEntryView[],
  store: RecordStore,
  input: PlanInput,
  deps: FrameDeps,
): { t: DiceThrow; plan: ThrowPlan } | null {
  const own = entries.filter((e) => isOwn(e, store.you));
  if (own.length > 0) deps.ownRolled(own); // FR-DICEX-09 / -10
  const planned = planThrow(entries, store.you, input);
  if (planned) deps.play(planned.t, planned.plan);
  return planned;
}

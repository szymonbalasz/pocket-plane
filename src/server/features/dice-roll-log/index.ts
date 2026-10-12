// dice-roll-log (DICE): intents `dice.roll`, `dice.setCategoryPublic`; record types
// `game-log-entry`, `game-log-settings`; internal helpers `dice.evaluate`, `gameLog.append`,
// `gameLog.markUndone` (FR-DICE-19, protocol §21) for character-sheet and combat-tracker.
import type { Feature } from "../../services";
import { rollCommand } from "./commands";
import { evaluate, rollPayloadItem } from "./evaluate";
import { append, markUndone } from "./game-log";
import { gameLogEntryType, gameLogSettingsType } from "./records";
import { setCategoryPublic } from "./settings";

export type { EvaluateInput, Roll, RollActorKind, RollSource } from "./evaluate";
export type { AppendInput } from "./game-log";

/** `dice.evaluate(env, …) → Roll`: the `roll` row only; no event. */
export const dice = { evaluate, rollPayloadItem } as const;

/** `gameLog.append(env, …)` / `gameLog.markUndone(env, id)` → `RecordChange`; no event. */
export const gameLog = { append, markUndone } as const;

export const diceRollLog: Feature = {
  name: "dice-roll-log",
  register(r) {
    r.command(rollCommand, { intent: true });
    r.command(setCategoryPublic, { intent: true });
    r.recordType(gameLogEntryType);
    r.recordType(gameLogSettingsType);
  },
};

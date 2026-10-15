// dice-roll-log (DICE): intents `dice.roll`, `dice.setCategoryPublic`; record types
// `game-log-entry`, `game-log-settings`; internal helpers `dice.evaluate`, `gameLog.append`,
// `gameLog.markUndone` (FR-DICE-19, protocol §21) for character-sheet and combat-tracker.
import type { Feature } from "../../services";
import { rollCommand } from "./commands";
import { evaluate, rollDmPayload, rollIdsOf, rollPayloadItem } from "./evaluate";
import { append, markUndone } from "./game-log";
import { gameLogEntryType, gameLogSettingsType } from "./records";
import { setCategoryPublic } from "./settings";

export type {
  EvaluatedRoll,
  EvaluateInput,
  Roll,
  RollActorKind,
  RollMods,
  RollSource,
} from "./evaluate";
export type { AppendInput } from "./game-log";
export type { RollHook, RollPart, RollSubject } from "./roll-hooks";

/**
 * `dice.evaluate(env, …) → Roll`: the `roll` row only; no event. With a `subject` (FR-MOD-13)
 * the roll hooks add `mods`; `rollPayloadItem`, `rollDmPayload` and `rollIdsOf` carry them into
 * the caller's entry.
 */
export const dice = { evaluate, rollPayloadItem, rollDmPayload, rollIdsOf } as const;

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

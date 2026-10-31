// dice-roll-log (DICE): intents `dice.roll`, `dice.setCategoryPublic`, `dice.setEntryHidden`; record types
// `game-log-entry`, `game-log-settings`; internal helpers `dice.evaluate`, `gameLog.append`,
// `gameLog.markUndone` (FR-DICE-19, protocol §21) for character-sheet and combat-tracker;
// sprint 7: `dice.reroll` (FR-DICE-62) and `gameLog.supersede` (FR-DICE-63) for gems.
import type { Feature } from "../../services";
import { rollCommand } from "./commands";
import { evaluate, rollDmPayload, rollIdsOf, rollPayloadItem } from "./evaluate";
import { append, markUndone, markUsed, supersede } from "./game-log";
import { setEntryHidden } from "./hidden";
import { gameLogEntryType, gameLogSettingsType } from "./records";
import { reroll } from "./reroll";
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
export type { RerollInput, RerollResult } from "./reroll";
export type { RollHook, RollPart, RollSubject } from "./roll-hooks";

/**
 * `dice.evaluate(env, …) → Roll`: the `roll` row only; no event. With a `subject` (FR-MOD-13)
 * the roll hooks add `mods`; `rollPayloadItem`, `rollDmPayload` and `rollIdsOf` carry them into
 * the caller's entry. `dice.reroll(env, …)` (FR-DICE-62): a d20 reroll's roll row, entry and
 * supersede, no event.
 */
export const dice = { evaluate, rollPayloadItem, rollDmPayload, rollIdsOf, reroll } as const;

/**
 * `gameLog.append(env, …)` / `gameLog.markUndone(env, id)` / `gameLog.supersede(env, old, new)`
 * / `gameLog.markUsed(env, id, cardId)` (FR-DICE-96) → `RecordChange`; no event.
 */
export const gameLog = { append, markUndone, supersede, markUsed } as const;

export const diceRollLog: Feature = {
  name: "dice-roll-log",
  register(r) {
    r.command(rollCommand, { intent: true });
    r.command(setCategoryPublic, { intent: true });
    r.command(setEntryHidden, { intent: true });
    r.recordType(gameLogEntryType);
    r.recordType(gameLogSettingsType);
  },
};

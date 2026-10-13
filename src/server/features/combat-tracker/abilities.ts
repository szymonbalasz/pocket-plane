// `cbt.rollAbility` (FR-CBT-44, #149): the DM rolls a combatant's ability check or save from the
// Initiative row. One roll + one `roll` entry with the encounter id; a hidden combatant's entry is
// never public.
import { characterRolls } from "@shared/character-sheet/logic";
import {
  CBT_INTENTS,
  RollAbilityInput,
  type RollAbilityResult,
} from "@shared/combat-tracker/schemas";
import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import { CombatantRolled } from "@shared/events/combat-tracker";
import { defineCommand } from "../../commands/commands";
import { conflict } from "../../commands/errors";
import { dice, gameLog } from "../dice-roll-log";
import { activeCombatant, statsOf } from "./guards";

export const rollAbility = defineCommand({
  name: CBT_INTENTS.rollAbility,
  input: RollAbilityInput,
  execute(input, env): RollAbilityResult {
    // Removed combatants too (they may still save against an effect).
    const { c, enc } = activeCombatant(env, input.combatantId, { allowRemoved: true });
    const spec = characterRolls(statsOf(env, c), input.kind, input.ability)?.[0];
    if (!spec) throw conflict("No ability scores");
    const r = dice.evaluate(env, {
      expression: spec.expression,
      mode: input.mode,
      category: spec.category,
      label: spec.label,
      actor: { kind: "entity", id: c.entityId, name: c.name },
      manual: input.manual,
      source: "cbt",
    });
    const entry = gameLog.append(env, {
      kind: ROLL_KIND,
      category: spec.category,
      actorName: c.name,
      payload: [dice.rollPayloadItem(r)],
      rollIds: [r.id],
      encounterId: enc.id,
      public: c.hidden ? false : input.public,
    });
    env.emit({
      type: CombatantRolled.type,
      campaignId: enc.campaignId,
      payload: {
        encounterId: enc.id,
        combatantId: c.id,
        kind: input.kind,
        ability: input.ability,
        rollIds: [r.id],
        entryId: entry.id,
      },
      changes: [entry],
    });
    return { rollIds: [r.id], entryId: entry.id };
  },
});

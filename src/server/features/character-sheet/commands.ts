// `char.roll` (FR-CHAR-05–09, FR-CHAR-17, FR-CHAR-21) and `char.adjustHp` (FR-CHAR-09, FR-CHAR-10).
// One transaction each: rolls + one log entry + `CharacterRolled`; HP row + `CharacterHpAdjusted`.
import { characterRolls, sheetAttack } from "@shared/character-sheet/logic";
import {
  CHAR_ADJUST_HP,
  CHAR_ROLL,
  CharAdjustHpIntent,
  type CharAdjustHpResult,
  type CharRollResult,
  isAbilityRollKind,
  SheetRollIntent,
} from "@shared/character-sheet/schemas";
import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import type { CharacterRecord } from "@shared/entities/schemas";
import { CharacterHpAdjusted, CharacterRolled } from "@shared/events/character-sheet";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, forbidden } from "../../commands/errors";
import { dice, gameLog } from "../dice-roll-log";
import { adjustHp, getCharacter } from "./hp";

/**
 * FR-CHAR-09: DM → any character of `actor.campaignId`; player → own only. Unknown, monster,
 * other campaign → `not_found`; another player's character → `forbidden`.
 */
export function authorizedCharacter(env: CommandEnv, characterId: string): CharacterRecord {
  const c = getCharacter(env, characterId);
  if (env.actor.role === "player" && c.ownerPlayerId !== env.actor.playerId) {
    throw forbidden("Not your character");
  }
  return c;
}

export const charRoll = defineCommand({
  name: CHAR_ROLL,
  input: SheetRollIntent,
  roles: ["dm", "player"],
  authorize(input, env) {
    // FR-CHAR-17: player rolls are always public; a player-sent `public` → forbidden.
    if (env.actor.role === "player" && input.public !== undefined) {
      throw forbidden("Player rolls are always public");
    }
  },
  execute(input, env): CharRollResult {
    const c = authorizedCharacter(env, input.characterId);
    // The schema guarantees `ability` for check / save (FR-CHAR-21); stats are read at commit.
    const ability = isAbilityRollKind(input.kind) ? input.ability : undefined;
    const specs = ability
      ? characterRolls(c.statBlock, input.kind, ability)
      : characterRolls(c.statBlock, input.kind as "initiative" | "attack");
    if (!specs) throw conflict(ability ? "No ability scores" : "No weapon attack");
    const actor = { kind: "entity" as const, id: c.id, name: c.name };
    const rolls = specs.map((s, i) =>
      dice.evaluate(env, {
        expression: s.expression,
        mode: s.d20 ? input.mode : "normal",
        category: s.category,
        label: s.label,
        actor,
        manual: input.manual?.[i],
        source: "char",
      }),
    );
    const rollIds = rolls.map((r) => r.id);
    const change = gameLog.append(env, {
      kind: ROLL_KIND,
      // attack: the to-hit's category (FR-DICE-26); check / save: ability-check / saving-throw.
      category: (specs[0] as (typeof specs)[number]).category,
      actorName: c.name,
      payload: rolls.map((r) => dice.rollPayloadItem(r)),
      rollIds,
      public: input.public,
    });
    const attack = input.kind === "attack" ? sheetAttack(c.statBlock) : null;
    env.emit({
      type: CharacterRolled.type,
      campaignId: c.campaignId,
      payload: {
        characterId: c.id,
        kind: input.kind,
        mode: input.mode,
        manual: input.manual !== undefined,
        ...(ability ? { ability } : {}),
        ...(attack ? { attackName: attack.name } : {}),
        ...(attack?.damageType ? { damageType: attack.damageType } : {}),
        rollIds,
        entryId: change.id,
      },
      changes: [change],
    });
    return { rollIds, entryId: change.id };
  },
});

export const charAdjustHp = defineCommand({
  name: CHAR_ADJUST_HP,
  input: CharAdjustHpIntent,
  roles: ["dm", "player"],
  execute(input, env): CharAdjustHpResult {
    const c = authorizedCharacter(env, input.characterId);
    const { hpBefore, hpAfter, change } = adjustHp(env, c.id, input.delta);
    // FR-CHAR-10: clamp leaves HP unchanged → success, no change, no event.
    if (change) {
      env.emit({
        type: CharacterHpAdjusted.type,
        campaignId: c.campaignId,
        payload: { entityId: c.id, delta: input.delta, hpBefore, hpAfter },
        changes: [change],
      });
    }
    return { hpBefore, hpAfter };
  },
});

// `char.roll` (FR-CHAR-05–09, FR-CHAR-17, FR-CHAR-21, FR-CHARX-20–22) and `char.adjustHp`
// (FR-CHAR-09, FR-CHAR-10). One transaction each: rolls + one log entry + `CharacterRolled`; HP
// row + `CharacterHpAdjusted`.
import { characterRolls, sheetAttack } from "@shared/character-sheet/logic";
import {
  CHAR_ADJUST_HP,
  CHAR_ROLL,
  CharAdjustHpIntent,
  type CharAdjustHpResult,
  type CharRollResult,
  isAbilityRollKind,
  isAttackRowKind,
  SheetRollIntent,
} from "@shared/character-sheet/schemas";
import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import type { RollCategory } from "@shared/dice-roll-log/schemas";
import { ROLL_ROW_MAX, type RollSubject } from "@shared/effect-modifiers/schemas";
import { type CharacterRecord, SKILL_ABILITY } from "@shared/entities/schemas";
import { CharacterHpAdjusted, CharacterRolled } from "@shared/events/character-sheet";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, forbidden, invalid, notFound } from "../../commands/errors";
import { hpRules } from "../combat-extras/hp-rules";
import { startedEncounter } from "../combat-tracker/rows";
import { dice, gameLog } from "../dice-roll-log";
import { rollTarget } from "./access";
import { getCharacter } from "./hp";
import { getSheet } from "./sheet-rows";

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

/**
 * FR-MOD-15: a character's roll subject by the spec's category: attack / damage (`via` spell for
 * spell rows; `row` = the attack / spell row's name for `row` filters, FR-MOD-13), save / check
 * of the ability (a skill → its ability), initiative. Healing and a definition's (NPC sheet)
 * rolls have none.
 */
function subjectOf(
  c: { id: string; kind: string },
  category: RollCategory,
  input: { kind: string; ability?: RollSubject["ability"]; skill?: keyof typeof SKILL_ABILITY },
  row: string | undefined,
): RollSubject | undefined {
  if (c.kind !== "character") return undefined;
  const creature = { characterId: c.id };
  const via = input.kind.startsWith("spell") ? ("spell" as const) : ("weapon" as const);
  if (category === "attack" || category === "damage") {
    return { creature, roll: category, via, ...(row ? { row: row.slice(0, ROLL_ROW_MAX) } : {}) };
  }
  if (category === "saving-throw") return { creature, roll: "save", ability: input.ability };
  if (category === "ability-check") return { creature, roll: "check", ability: input.ability };
  if (category === "skill-check" && input.skill) {
    return { creature, roll: "check", ability: SKILL_ABILITY[input.skill] };
  }
  if (category === "initiative") return { creature, roll: "initiative" };
  return undefined;
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
    // FR-CHARX-22: the DM may roll for any definition (NPC sheet); players for own characters.
    const c = rollTarget(env, input.characterId);
    const definition = c.kind === "monster";
    if (definition && input.public !== undefined) {
      throw invalid("NPC sheet rolls are DM-only", [
        { path: ["public"], message: "Not allowed for definitions" },
      ]);
    }
    // FR-CHARX-21: specs from committed data (stat block + sheet rows), overrides honoured.
    const sheet = c.campaignId === null ? null : getSheet(env.tx, c.id);
    const ref = {
      ability: isAbilityRollKind(input.kind) ? input.ability : undefined,
      skill: input.skill,
      attackId: input.attackId,
      spellId: input.spellId,
    };
    const res = characterRolls(c.statBlock, sheet, input.kind, ref);
    if (!res.ok) throw res.code === "not_found" ? notFound(res.message) : conflict(res.message);
    const specs = res.specs;
    if (input.manual && input.manual.length !== specs.length) {
      throw invalid("Invalid input", [
        { path: ["manual"], message: `Enter ${specs.length} physical rolls for ${input.kind}` },
      ]);
    }
    const ability = ref.ability;
    const actor = { kind: "entity" as const, id: c.id, name: c.name };
    const attack = !isAttackRowKind(input.kind)
      ? null
      : input.attackId === undefined
        ? sheetAttack(c.statBlock)
        : (c.statBlock.attacks.find((a) => a.id === input.attackId) ?? null);
    const row = attack?.name ?? sheet?.spells.find((x) => x.id === input.spellId)?.name;
    const rolls = specs.map((s, i) => {
      // FR-CHARX-55: mods (Rage +2) attach to the base part; an extra part has no subject.
      const subject = s.part?.extra
        ? undefined
        : subjectOf(c, s.category, { ...input, ability }, row);
      return dice.evaluate(env, {
        expression: s.expression,
        mode: s.d20 ? input.mode : "normal",
        category: s.category,
        label: s.label,
        actor,
        manual: input.manual?.[i],
        // FR-MOD-18: the physical part groups of this roll (one list per `manual` entry).
        ...(input.manualParts?.[i] ? { manualParts: input.manualParts[i] } : {}),
        source: "char",
        ...(subject ? { subject } : {}),
      });
    });
    // FR-MOD-14: bonus-die rows follow their base roll (FR-DICE-26).
    const rollIds = rolls.flatMap((r) => dice.rollIdsOf(r));
    const change = gameLog.append(env, {
      kind: ROLL_KIND,
      // attack: the to-hit's category (FR-DICE-26); check / save: ability-check / saving-throw.
      category: (specs[0] as (typeof specs)[number]).category,
      actorName: c.name,
      // FR-CHARX-55: each damage part of a magic weapon row is its own item, typed (`part`).
      payload: rolls.map((r, i) => {
        const part = specs[i]?.part;
        return { ...dice.rollPayloadItem(r), ...(part ? { part } : {}) };
      }),
      dmPayload: dice.rollDmPayload(rolls),
      rollIds,
      // FR-CHARX-22: a definition's name can leak a renamed or hidden creature (ADR-0024).
      public: definition ? false : input.public,
    });
    env.emit({
      type: CharacterRolled.type,
      campaignId: env.actor.campaignId,
      payload: {
        characterId: c.id,
        kind: input.kind,
        mode: input.mode,
        manual: input.manual !== undefined,
        ...(ability ? { ability } : {}),
        ...(input.skill ? { skill: input.skill } : {}),
        ...(input.attackId ? { attackId: input.attackId } : {}),
        ...(input.spellId ? { spellId: input.spellId } : {}),
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
    // FR-CBTX-02 (D/S seam): through combat-extras' `hpRules` — temp HP absorbs, death-save
    // failures at 0 HP, concentration ends at 0 / asks for a save. Not a combat log entry.
    const a = hpRules.apply(
      env,
      { kind: "character", id: c.id },
      { kind: input.delta < 0 ? "damage" : "heal", raw: Math.abs(input.delta), hpChangeId: null },
    );
    const { hpBefore, hpAfter } = a;
    // FR-CHAR-10: nothing changed (HP clamped, no temp HP / counters) → success, no event.
    if (a.changes.length > 0) {
      // The CBTX facts (FR-CBTX-21) only when temp HP, the counters or a card were involved.
      const payload: Record<string, unknown> = {
        entityId: c.id,
        delta: input.delta,
        hpBefore,
        hpAfter,
        ...(a.tempBefore !== a.tempAfter
          ? { tempBefore: a.tempBefore, tempAfter: a.tempAfter }
          : {}),
        ...(a.deathBefore ? { deathBefore: a.deathBefore, deathAfter: a.deathAfter } : {}),
      };
      env.emit({
        type: CharacterHpAdjusted.type,
        campaignId: c.campaignId,
        payload,
        changes: a.changes,
      });
      // Cards follow the owner event (FR-CBTX-17); their ids land in its payload before commit.
      const enc = startedEncounter(env.tx, c.campaignId);
      const noteIds = hpRules.after(env, a, { encounterId: enc?.id ?? null, hpChangeId: null });
      if (noteIds.length > 0) payload.noteIds = noteIds;
    }
    return { hpBefore, hpAfter };
  },
});

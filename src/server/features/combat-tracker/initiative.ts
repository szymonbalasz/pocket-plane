// Initiative (FR-CBT-11, FR-CBT-12, FR-CBT-47) and remove / restore (FR-CBT-15).
import { characterRolls } from "@shared/character-sheet/logic";
import type { CombatantRecord } from "@shared/combat-tracker/schemas";
import {
  CBT_INTENTS,
  RollInitiativeInput,
  SetInitiativeInput,
  SetRemovedInput,
} from "@shared/combat-tracker/schemas";
import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import type { ManualEntry, RollMode } from "@shared/dice-roll-log/schemas";
import {
  CombatantRemoved,
  CombatantRestored,
  InitiativeRolled,
  InitiativeSet,
} from "@shared/events/combat-tracker";
import { eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, forbidden, invalid } from "../../commands/errors";
import { combatant } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { dice, gameLog } from "../dice-roll-log";
import { activeCombatant, statsOf } from "./guards";
import { combatantDiff, encounterDiff, rerank, syncPlayerTurn } from "./ranks";
import { campaignOf, combatantsOf, readEncounter } from "./rows";

export const rollInitiative = defineCommand({
  name: CBT_INTENTS.rollInitiative,
  input: RollInitiativeInput,
  roles: ["dm", "player"],
  authorize(input, env) {
    if (env.actor.role !== "player") return;
    // FR-DICE-13: player rolls are always public; a player rolls once, for their own PC.
    if (input.public !== undefined) throw forbidden("Player rolls are always public");
    if (input.combatantIds.length !== 1) throw forbidden("Roll for your own character only");
    const { c } = activeCombatant(env, input.combatantIds[0] as string, { own: true });
    if (c.initiative !== null) throw alreadySet([c]);
  },
  execute(input, env): { rollIds: string[] } {
    const cid = campaignOf(env.actor);
    const ids = [...new Set(input.combatantIds)];
    if (input.manual && ids.length !== 1) {
      throw invalid("Physical dice: one combatant at a time", [
        { path: ["manual"], message: "Needs exactly one combatant" },
      ]);
    }
    const targets = ids.map((id) => activeCombatant(env, id, { allowRemoved: true }));
    const { enc } = targets[0] as (typeof targets)[number];
    const encounterId = enc.id;
    // FR-CBT-47 (#172): from round 1 nobody re-rolls; the whole intent fails.
    if (enc.round >= 1) {
      const set = targets.map((t) => t.c).filter((c) => c.initiative !== null);
      if (set.length > 0) throw alreadySet(set);
    }
    const before = combatantsOf(env.tx, encounterId);
    const { rollIds, entries } = rollInitiativeFor(
      env,
      targets.map((t) => t.c),
      encounterId,
      { ...input, effects: true },
    );
    rerank(env.tx, encounterId);
    env.emit({
      type: InitiativeRolled.type,
      campaignId: cid,
      payload: {
        encounterId,
        combatantIds: targets.map((t) => t.c.id),
        rollIds,
        entryIds: entries.map((e) => e.id),
      },
      changes: [...combatantDiff(env.tx, before), ...entries],
    });
    return { rollIds };
  },
});

/**
 * FR-CBT-11: one d20 + init bonus roll and one `roll` entry per combatant; writes `initiative`
 * and `initRollId` (the caller reranks). `public`: a hidden combatant → false (FR-CBT-24); a
 * monster → false unless `public: true` (FR-CBT-69); a PC → the sent value, else the category
 * setting. Also Start's and add's monster rolls (FR-CBT-64, FR-CBTX-44: mode normal, no public).
 * `effects`: `cbt.rollInitiative` only (FR-MOD-15): the roll hooks add the creature's parts to
 * the value; combatant-creation rolls pass none (new combatants carry no effects).
 */
export function rollInitiativeFor(
  env: CommandEnv,
  combatants: readonly CombatantRecord[],
  encounterId: string,
  opts: { mode: RollMode; manual?: ManualEntry; public?: boolean; effects?: boolean },
): { rollIds: string[]; entries: RecordChange[] } {
  const rollIds: string[] = [];
  const entries: RecordChange[] = [];
  for (const c of combatants) {
    const spec = characterRolls(statsOf(env, c), "initiative")?.[0];
    if (!spec) throw new Error("characterRolls: no initiative roll");
    const r = dice.evaluate(env, {
      expression: spec.expression,
      mode: opts.mode,
      category: spec.category,
      label: spec.label,
      actor: { kind: "entity", id: c.entityId, name: c.name },
      manual: opts.manual,
      source: "cbt",
      ...(opts.effects
        ? {
            subject: {
              creature: c.kind === "pc" ? { characterId: c.entityId } : { combatantId: c.id },
              roll: "initiative" as const,
            },
          }
        : {}),
    });
    // FR-MOD-16: the initiative value includes the parts.
    env.tx
      .update(combatant)
      .set({ initiative: r.total + (r.mods?.modTotal ?? 0), initRollId: r.id })
      .where(eq(combatant.id, c.id))
      .run();
    rollIds.push(...dice.rollIdsOf(r));
    entries.push(
      gameLog.append(env, {
        kind: ROLL_KIND,
        category: "initiative",
        actorName: c.name,
        payload: [dice.rollPayloadItem(r)],
        dmPayload: dice.rollDmPayload([r]),
        rollIds: dice.rollIdsOf(r),
        encounterId,
        public: c.hidden ? false : c.kind === "monster" ? opts.public === true : opts.public,
      }),
    );
  }
  return { rollIds, entries };
}

const alreadySet = (cs: { name: string }[]) =>
  conflict(`Initiative already set: ${cs.map((c) => c.name).join(", ")}`);

export const setInitiative = defineCommand({
  name: CBT_INTENTS.setInitiative,
  input: SetInitiativeInput,
  execute({ combatantId, value }, env): void {
    const { c, enc } = activeCombatant(env, combatantId, { allowRemoved: true });
    const before = combatantsOf(env.tx, enc.id);
    env.tx
      .update(combatant)
      .set({ initiative: value, initRollId: null })
      .where(eq(combatant.id, c.id))
      .run();
    rerank(env.tx, enc.id);
    env.emit({
      type: InitiativeSet.type,
      campaignId: enc.campaignId,
      payload: { encounterId: enc.id, combatantId: c.id, value },
      changes: combatantDiff(env.tx, before),
    });
  },
});

export const setRemoved = defineCommand({
  name: CBT_INTENTS.setRemoved,
  input: SetRemovedInput,
  execute({ combatantId, removed }, env): void {
    const { c, enc } = activeCombatant(env, combatantId, { allowRemoved: true });
    if (c.removed === removed) return;
    const before = combatantsOf(env.tx, enc.id);
    const encBefore = readEncounter(env.tx, enc.id);
    env.tx.update(combatant).set({ removed }).where(eq(combatant.id, c.id)).run();
    rerank(env.tx, enc.id);
    const encAfter = syncPlayerTurn(env, enc.id);
    env.emit({
      type: removed ? CombatantRemoved.type : CombatantRestored.type,
      campaignId: enc.campaignId,
      payload: { encounterId: enc.id, combatantId: c.id },
      changes: [...combatantDiff(env.tx, before), ...encounterDiff(encBefore, encAfter)],
    });
  },
});

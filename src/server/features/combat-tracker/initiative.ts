// Initiative (FR-CBT-11, FR-CBT-12) and remove / restore (FR-CBT-15).
import { characterRolls } from "@shared/character-sheet/logic";
import {
  CBT_INTENTS,
  RollInitiativeInput,
  SetInitiativeInput,
  SetRemovedInput,
} from "@shared/combat-tracker/schemas";
import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import {
  CombatantRemoved,
  CombatantRestored,
  InitiativeRolled,
  InitiativeSet,
} from "@shared/events/combat-tracker";
import { eq } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
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
    if (c.initiative !== null) throw conflict("Initiative is already set");
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
    const encounterId = (targets[0] as (typeof targets)[number]).enc.id;
    const before = combatantsOf(env.tx, encounterId);
    const rollIds: string[] = [];
    const entries: RecordChange[] = [];
    for (const { c } of targets) {
      const spec = characterRolls(statsOf(env, c), "initiative")?.[0];
      if (!spec) throw new Error("characterRolls: no initiative roll");
      const r = dice.evaluate(env, {
        expression: spec.expression,
        mode: input.mode,
        category: spec.category,
        label: spec.label,
        actor: { kind: "entity", id: c.entityId, name: c.name },
        manual: input.manual,
        source: "cbt",
      });
      env.tx
        .update(combatant)
        .set({ initiative: r.total, initRollId: r.id })
        .where(eq(combatant.id, c.id))
        .run();
      rollIds.push(r.id);
      entries.push(
        gameLog.append(env, {
          kind: ROLL_KIND,
          category: "initiative",
          actorName: c.name,
          payload: [dice.rollPayloadItem(r)],
          rollIds: [r.id],
          encounterId,
          // FR-CBT-24: a hidden combatant's roll is never public.
          public: c.hidden ? false : input.public,
        }),
      );
    }
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

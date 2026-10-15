// Temp HP and death saves (FR-CBTX-14, FR-CBTX-19–24): `cbtx.setTempHp` (DM; owner: own PC),
// `cbtx.rollDeathSave` (DM; owner), `cbtx.setDeathSaves` (DM). Not combat log entries, not
// undoable (OQ-CBTX-20): corrected by the inverse command.
import {
  CBTX_INTENTS,
  RollDeathSaveInput,
  type RollIdsEntryResult,
  SetDeathSavesInput,
  SetTempHpInput,
} from "@shared/combat-extras/intents";
import { deathSave, deathStateOf } from "@shared/combat-extras/rules";
import type { DeathCounters } from "@shared/combat-extras/schemas";
import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import { DeathSaveRolled, DeathSavesSet, TempHpSet } from "@shared/events/combat-extras";
import { eq } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
import { conflict, forbidden } from "../../commands/errors";
import { combatant, entity } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { authorizedCharacter } from "../character-sheet/commands";
import { getCharacter } from "../character-sheet/hp";
import { combatantChange, readCombatant } from "../combat-tracker/rows";
import { dice, gameLog } from "../dice-roll-log";
import { hpRules } from "./hp-rules";
import { characterChange, pcCombatant, readCharacter, resolveTarget } from "./rows";

const countersOf = (c: { deathSuccesses: number; deathFailures: number }): DeathCounters => ({
  successes: c.deathSuccesses,
  failures: c.deathFailures,
});

export const setTempHp = defineCommand({
  name: CBTX_INTENTS.setTempHp,
  input: SetTempHpInput,
  roles: ["dm", "player"],
  execute({ target: ref, value }, env): void {
    const t = resolveTarget(env, ref);
    // OQ-CBTX-07: a player sets their own PC's temp HP only; monsters are DM only.
    if (
      env.actor.role === "player" &&
      (t.kind !== "character" || t.character.ownerPlayerId !== env.actor.playerId)
    ) {
      throw forbidden("Not your character");
    }
    let before: number;
    let change: RecordChange;
    let targetId: string;
    if (t.kind === "monster") {
      const b = readCombatant(env.tx, t.combatant.id);
      before = b.tempHp;
      if (before === value) return;
      env.tx.update(combatant).set({ tempHp: value }).where(eq(combatant.id, b.id)).run();
      change = combatantChange(b, readCombatant(env.tx, b.id));
      targetId = b.id;
    } else {
      const b = readCharacter(env.tx, t.character.id);
      before = b.tempHp;
      // FR-CBTX-14: the same value is a no-op, no event.
      if (before === value) return;
      env.tx
        .update(entity)
        .set({ tempHp: value, updatedAt: env.ctx.clock.iso() })
        .where(eq(entity.id, b.id))
        .run();
      change = characterChange(b, readCharacter(env.tx, b.id));
      targetId = b.id;
    }
    env.emit({
      type: TempHpSet.type,
      campaignId: env.actor.campaignId,
      payload: {
        targetKind: t.kind === "monster" ? "combatant" : "character",
        targetId,
        before,
        after: value,
      },
      changes: [change],
    });
  },
});

/**
 * FR-CBTX-47 (G7) line note, no counters (#178 G6: they are the owner's and the DM's): "success",
 * "failure"; a state change adds it: "success — stable", "failure — dead", "natural 20, conscious".
 */
export function deathSaveNote(s: ReturnType<typeof deathSave>): string {
  if (s.outcome === "revive") return "natural 20, conscious";
  const state = deathStateOf(0, s.after.successes, s.after.failures);
  if (s.outcome === "success" && state === "stable") return "success — stable";
  if (s.outcome === "failure" && state === "dead") return "failure — dead";
  return s.outcome;
}

export const rollDeathSave = defineCommand({
  name: CBTX_INTENTS.rollDeathSave,
  input: RollDeathSaveInput,
  roles: ["dm", "player"],
  authorize(input, env) {
    if (env.actor.role === "player" && input.public !== undefined) {
      throw forbidden("Player rolls are always public");
    }
  },
  execute(input, env): RollIdsEntryResult {
    const c = authorizedCharacter(env, input.characterId);
    if (deathStateOf(c.hpCurrent, c.deathSuccesses, c.deathFailures) !== "dying") {
      throw conflict("Not dying");
    }
    const r = dice.evaluate(env, {
      expression: "1d20",
      mode: input.mode,
      category: "saving-throw",
      label: "Death save",
      actor: { kind: "entity", id: c.id, name: c.name },
      manual: input.manual,
      source: "char",
    });
    const pc = pcCombatant(env.tx, c.campaignId, c.id);
    // FR-CBTX-23: a PC hidden from players (#141) rolls DM-only, whoever rolls.
    const hidden = pc?.hidden ?? false;
    const natural = r.natural ?? r.total;
    const before = countersOf(c);
    const save = deathSave(before, natural);
    const entry = gameLog.append(env, {
      kind: ROLL_KIND,
      category: "saving-throw",
      actorName: c.name,
      // FR-CBTX-47: "Mira — Death save: 14 — success", no counters.
      // A natural 20 is named by the note ("— natural 20, conscious"), not twice.
      payload: [
        {
          ...dice.rollPayloadItem(r),
          ...(save.outcome === "revive" ? { natural: null } : {}),
          note: deathSaveNote(save),
        },
      ],
      rollIds: [r.id],
      encounterId: pc?.encounterId ?? null,
      public: input.public,
      forcePrivate: hidden,
    });
    const changes: RecordChange[] = [];
    if (save.outcome === "revive") {
      // Natural 20: 1 HP through the HP rules (counters reset, FR-CBTX-20).
      changes.push(
        ...hpRules.apply(
          env,
          { kind: "character", id: c.id },
          { kind: "heal", raw: 1, hpChangeId: null },
        ).changes,
      );
    } else {
      env.tx
        .update(entity)
        .set({
          deathSuccesses: save.after.successes,
          deathFailures: save.after.failures,
          updatedAt: env.ctx.clock.iso(),
        })
        .where(eq(entity.id, c.id))
        .run();
      changes.push(characterChange(c, readCharacter(env.tx, c.id)));
    }
    env.emit({
      type: DeathSaveRolled.type,
      campaignId: c.campaignId,
      payload: {
        characterId: c.id,
        rollIds: [r.id],
        entryId: entry.id,
        natural,
        before,
        after: save.after,
      },
      changes: [...changes, entry],
    });
    return { rollIds: [r.id], entryId: entry.id };
  },
});

export const setDeathSaves = defineCommand({
  name: CBTX_INTENTS.setDeathSaves,
  input: SetDeathSavesInput,
  execute({ characterId, successes, failures }, env): void {
    const c = getCharacter(env, characterId);
    if (c.hpCurrent > 0) throw conflict("Death saves need 0 HP");
    if (c.deathSuccesses === successes && c.deathFailures === failures) return;
    env.tx
      .update(entity)
      .set({ deathSuccesses: successes, deathFailures: failures, updatedAt: env.ctx.clock.iso() })
      .where(eq(entity.id, c.id))
      .run();
    env.emit({
      type: DeathSavesSet.type,
      campaignId: c.campaignId,
      payload: { characterId: c.id, successes, failures },
      changes: [characterChange(c, readCharacter(env.tx, c.id))],
    });
  },
});

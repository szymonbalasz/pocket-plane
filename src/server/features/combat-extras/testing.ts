// Test support for combat-extras: combat's ambush started on Goblin Ambush with CBT §13's order
// (Wolf 18, Mira 15, Goblin 12, Goblin 2 12, Thorn 10, Elite 8), round 1, Wolf's turn — like
// the `combat-1` fixture — plus effect / card / attack helpers.
import type { AddEffectInput } from "@shared/combat-extras/intents";
import type { EffectRecord } from "@shared/combat-extras/schemas";
import {
  type AttackResult,
  type HpChangeRecord,
  parseFullCard,
  partRollIdsOf,
  type UndoResult,
} from "@shared/combat-tracker/schemas";
import type { CharacterRecord } from "@shared/entities/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { asc, eq } from "drizzle-orm";
import { effect, entity, hpChange, notification } from "../../db/schema";
import type { Actor } from "../../events/types";
import { attackCommand } from "../combat-tracker/attack";
import { applyCard, applyHp, undoCommand } from "../combat-tracker/hp";
import { setInitiative } from "../combat-tracker/initiative";
import { endCommand, startCommand } from "../combat-tracker/lifecycle";
import { readEncounter } from "../combat-tracker/rows";
import { combatSetup } from "../combat-tracker/testing";
import { nextTurn, prevTurn } from "../combat-tracker/turns";
import { toEntityRecord } from "../entities/rows";
import { addEffect, endEffect, setConcentration } from "./effect-commands";
import { toEffectRecord } from "./rows";

export const ORDER = {
  Wolf: 18,
  Mira: 15,
  Goblin: 12,
  "Goblin 2": 12,
  Thorn: 10,
  "Elite Goblin Warrior": 8,
};

export function cbtxSetup(opts: { round1?: boolean } = {}) {
  const t = combatSetup();
  const enc = t.createAmbush();
  t.run(startCommand.name, { encounterId: enc.id, sceneId: t.sceneId });
  const id = (name: string) => {
    const c = t.byName(enc.id)[name];
    if (!c) throw new Error(`no combatant ${name}`);
    return c.id;
  };
  for (const [name, value] of Object.entries(ORDER)) {
    t.run(setInitiative.name, { combatantId: id(name), value });
  }
  const encNow = () => readEncounter(t.s.db, enc.id);
  const step = (dir: "next" | "prev", actor: Actor = t.h.dm) => {
    const e = encNow();
    return t.run<{ notRestored: string[] }>(
      dir === "next" ? nextTurn.name : prevTurn.name,
      { encounterId: enc.id, expectedRound: e.round, expectedTurnId: e.turnCombatantId },
      actor,
    );
  };
  if (opts.round1 !== false) step("next");
  const turnName = () => {
    const e = encNow();
    return Object.values(t.byName(enc.id)).find((c) => c.id === e.turnCombatantId)?.name;
  };
  /** Steps Next until `name` has the turn in `round`. */
  const nextTo = (name: string, round: number) => {
    for (let i = 0; i < 200; i++) {
      if (encNow().round === round && turnName() === name) return;
      step("next");
    }
    throw new Error(`never reached ${name} in round ${round}`);
  };
  const effects = () =>
    t.s.db.select().from(effect).orderBy(asc(effect.seq)).all().map(toEffectRecord);
  const active = () => effects().filter((e) => e.endedAt === null);
  const character = (cid: string) =>
    toEntityRecord(
      t.s.db.select().from(entity).where(eq(entity.id, cid)).get() as Parameters<
        typeof toEntityRecord
      >[0],
    ) as CharacterRecord;
  const cards = (kind = "cbtx-concentration") =>
    t.s.db
      .select()
      .from(notification)
      .where(eq(notification.kind, kind))
      .orderBy(asc(notification.seq))
      .all() as NotificationRecord[];
  const note = (nid: string) =>
    t.s.db.select().from(notification).where(eq(notification.id, nid)).get() as
      | NotificationRecord
      | undefined;
  const add = (input: AddEffectInput, actor: Actor = t.h.dm) =>
    t.run<{ effectIds: string[] }>(addEffect.name, input, actor);
  const concentrate = (
    target: { characterId: string } | { combatantId: string },
    label: string,
    durationRounds?: number,
    actor: Actor = t.h.dm,
  ) =>
    t.run<{ effectId: string }>(
      setConcentration.name,
      { target, label, ...(durationRounds ? { durationRounds } : {}) },
      actor,
    ).effectId;
  const end = (effectId: string, actor: Actor = t.h.dm) =>
    t.run(endEffect.name, { effectId }, actor);
  const fx = (effectId: string) => effects().find((e) => e.id === effectId) as EffectRecord;
  /** DM attack with manual dice, then apply to the named targets (hit, normal). */
  const attackApply = (
    attacker: string,
    targets: string[],
    damage: number,
    o: { toHit?: number; actor?: Actor } = {},
  ) => {
    const r = t.run<AttackResult>(
      attackCommand.name,
      { attackerId: id(attacker), manual: [{ diceTotal: o.toHit ?? 15 }, { diceTotal: damage }] },
      o.actor ?? t.h.dm,
    );
    const card = note(r.cardId) as NotificationRecord;
    const p = parseFullCard(card.payload);
    t.run(applyCard.name, {
      cardId: r.cardId,
      toHitTotal: p.toHit.total,
      damageTotal: p.damage.total,
      damageRollId: p.damage.rollId,
      partRollIds: partRollIdsOf(p),
      targets: targets.map((n) => ({ targetId: id(n), hit: true, multiplier: "normal" })),
    });
    return { cardId: r.cardId, damage: p.damage.total };
  };
  const hp = (name: string, kind: "damage" | "heal", amount: number) =>
    t.run<{ hpChangeId: string }>(applyHp.name, { combatantId: id(name), kind, amount });
  const hpRows = () =>
    t.s.db.select().from(hpChange).orderBy(asc(hpChange.seq)).all() as HpChangeRecord[];
  const undo = () => {
    const last = hpRows()
      .filter((r) => !r.undone)
      .sort((a, b) => b.seq - a.seq)[0];
    return t.run<UndoResult>(undoCommand.name, { expectedHpChangeId: last?.id ?? "x" });
  };
  const endEncounter = () => t.run(endCommand.name, { encounterId: enc.id });
  const typesSince = (n: number) => t.events.slice(n).map((e) => e.event.type);
  return {
    ...t,
    enc,
    id,
    encNow,
    step,
    turnName,
    nextTo,
    effects,
    active,
    character,
    cards,
    note,
    add,
    concentrate,
    end,
    fx,
    attackApply,
    hp,
    hpRows,
    undo,
    endEncounter,
    typesSince,
  };
}

export type CbtxSetup = ReturnType<typeof cbtxSetup>;

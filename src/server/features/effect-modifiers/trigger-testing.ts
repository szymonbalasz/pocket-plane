// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// Test support for rule triggers (MOD §13, like fixtures `char-brakka` + `trg-brakka` +
// `trg-combat`): CBTX's ambush plus Brakka (Barbarian 5, player-1, Greataxe +7 / 1d12+4
// slashing, features "Rage" 3 uses and "Divine Fury"), her "Rage" preset from `rage` and the
// Divine Fury trigger as data, in combat at initiative 17 (Wolf 18, Brakka 17, Mira 15, …).

import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import type {
  AttackResult,
  DamageCardPayload,
  HpChangesResult,
  RollDamageResult,
} from "@shared/combat-tracker/schemas";
import type { RollMode } from "@shared/dice-roll-log/schemas";
import { TRIGGER_INTENTS, type TriggerInput } from "@shared/effect-modifiers/trigger-intents";
import type { TriggerRule } from "@shared/effect-modifiers/triggers";
import { asc, eq } from "drizzle-orm";
import { triggerUse } from "../../db/schema";
import type { Actor } from "../../events/types";
import { attackCommand } from "../combat-tracker/attack";
import { rollDamageCommand } from "../combat-tracker/damage";
import { applyCard } from "../combat-tracker/hp";
import { setInitiative } from "../combat-tracker/initiative";
import { createEntity } from "../entities/commands";
import { modSetup } from "./testing";

export const brakkaBlock = {
  size: "medium",
  ac: 14,
  hpMax: 55,
  initBonus: 1,
  speed: 30,
  abilities: { str: 18, dex: 12, con: 16, int: 8, wis: 12, cha: 10 },
  saveProficiencies: ["str", "con"],
  attacks: [{ name: "Greataxe", toHit: 7, damage: "1d12+4", damageType: "slashing" }],
  level: 5,
  className: "Barbarian",
  classes: [{ name: "Barbarian", level: 5, hitDie: "d12" }],
} as const;

/** MOD §6.2: Divine Fury as data (#209), requiring `requires`. */
export const divineFury = (requires: string): TriggerRule => ({
  on: "hit",
  requires: { preset: requires },
  when: [{ if: "via", via: "weapon" }, { if: "ownTurn" }],
  every: "turn",
  then: { do: "damage", formula: "1d6 + floor(level(barbarian) / 2)", type: "radiant" },
});

export function rtSetup(opts: { round1?: boolean; inCombat?: boolean } = {}) {
  const t = modSetup(opts);
  const brakkaId = t.run<{ id: string }>(createEntity.name, {
    kind: "character",
    name: "Brakka",
    ownerPlayerId: t.h.p1.id,
    statBlock: brakkaBlock,
  }).id;
  const feature = (name: string, usesMax?: number) =>
    t.run<{ rowId: string }>("char.putRow", {
      creatureId: brakkaId,
      list: "features",
      row: { name, ...(usesMax ? { usesMax, reset: "long" } : {}) },
    }).rowId;
  const rageRowId = feature("Rage", 3);
  feature("Divine Fury");
  const ragePresetId = t.put(t.from("rage", { characterId: brakkaId, originKey: "rage" }));
  const trig = (trigger: TriggerInput, actor: Actor = t.h.dm) =>
    t.run<{ triggerId: string }>(TRIGGER_INTENTS.putTrigger, { trigger }, actor).triggerId;
  const furyId = trig({
    characterId: brakkaId,
    name: "Divine Fury",
    rule: divineFury(ragePresetId),
  });
  if (opts.inCombat !== false) {
    t.run(CBTX_INTENTS.addCombatants, {
      encounterId: t.enc.id,
      items: [{ characterId: brakkaId }],
    });
    t.run(setInitiative.name, { combatantId: t.id("Brakka"), value: 17 });
  }
  const rage = (on: boolean, actor: Actor = t.p1) => t.toggle(brakkaId, ragePresetId, on, actor);
  const card = (cardId: string) => t.note(cardId)?.payload as DamageCardPayload;
  /** An attack + damage (physical d20 and weapon dice; offered dice server-rolled, seeded). */
  const attack = (
    name: string,
    o: {
      toHit?: number;
      damage?: number;
      mode?: RollMode;
      rolls?: "toHit";
      actor?: Actor;
      attackId?: string;
    } = {},
  ) =>
    t.seeded<AttackResult>(
      attackCommand.name,
      {
        attackerId: t.id(name),
        mode: o.mode ?? "normal",
        ...(o.rolls ? { rolls: o.rolls } : {}),
        ...(o.attackId ? { attackId: o.attackId } : {}),
        manual: [{ diceTotal: o.toHit ?? 15 }, ...(o.rolls ? [] : [{ diceTotal: o.damage ?? 8 }])],
      },
      o.actor ?? t.h.dm,
    );
  const rollDamage = (name: string, damage: number, actor: Actor = t.h.dm) =>
    t.seeded<RollDamageResult>(
      rollDamageCommand.name,
      { attackerId: t.id(name), manual: { diceTotal: damage } },
      actor,
    );
  /** Applies a card: `targets` = [name, hit, multiplier?, triggers?]. */
  const applyCard_ = (
    cardId: string,
    targets: {
      name: string;
      hit?: boolean;
      multiplier?: "none" | "half" | "normal" | "double";
      triggers?: { triggerId: string; value?: number; multiplier?: string; force?: boolean }[];
    }[],
  ) => {
    const p = card(cardId);
    return t.run<HpChangesResult>(applyCard.name, {
      cardId,
      ...(p.toHit ? { toHitTotal: p.toHit.total } : {}),
      damageTotal: p.damage?.total ?? 0,
      damageRollId: p.damage?.rollId ?? null,
      targets: targets.map((x) => ({
        targetId: t.id(x.name),
        hit: x.hit ?? true,
        multiplier: x.multiplier ?? "normal",
        ...(x.triggers ? { triggers: x.triggers } : {}),
      })),
    });
  };
  const uses = () => t.s.db.select().from(triggerUse).orderBy(asc(triggerUse.seq)).all();
  const usesOf = (triggerId: string) =>
    t.s.db
      .select()
      .from(triggerUse)
      .where(eq(triggerUse.triggerId, triggerId))
      .orderBy(asc(triggerUse.seq))
      .all();
  /** The offered trigger ids on a card's damage. */
  const offers = (cardId: string) => (card(cardId).damage?.triggers ?? []).map((x) => x.triggerId);
  return {
    ...t,
    brakkaId,
    rageRowId,
    ragePresetId,
    furyId,
    trig,
    rage,
    card,
    attack,
    rollDamage,
    applyTo: applyCard_,
    uses,
    usesOf,
    offers,
  };
}

export type RtSetup = ReturnType<typeof rtSetup>;

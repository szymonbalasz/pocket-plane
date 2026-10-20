// Sprint 6 CP3 test support (CBT §13.3): CP0's `cpSetup` (Mira + her Owlbear pet after her, Thorn
// + his in-turn Drake pet, round 1, the Wolf's turn) plus a custom "Fire Elemental" with the SRD
// numbers, and helpers for `cbt.summon` / `cbt.dismiss` and Thorn's concentration.
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import type { DismissInput, SummonInput, SummonResult } from "@shared/combat-tracker/schemas";
import { SUMMON_CARD_KIND } from "@shared/combat-tracker/summon-card-kind";
import type { MonsterStatBlock } from "@shared/entities/schemas";
import { asc, eq } from "drizzle-orm";
import { notification } from "../../db/schema";
import type { Actor } from "../../events/types";
import { createEntity } from "../entities/commands";
import { toNotificationRecord } from "../notifications/helpers";
import { cpSetup } from "./cp-testing";
import { dismissCommand } from "./dismiss";
import { summonCommand } from "./summon";

/** The SRD Fire Elemental's numbers (CBT §13.3 `cp-srd`), as a custom monster. */
export const fireElementalBlock = {
  size: "large",
  ac: 13,
  hpMax: 102,
  hpFormula: "12d10+36",
  initBonus: 3,
  speed: 50,
  abilities: { str: 10, dex: 17, con: 16, int: 6, wis: 10, cha: 7 },
  attacks: [{ name: "Touch", toHit: 6, damage: "2d6+3", damageType: "fire" }],
  cr: "5",
  type: "elemental",
} satisfies MonsterStatBlock;

export function summonSetup(opts: Parameters<typeof cpSetup>[0] = {}) {
  const t = cpSetup(opts);
  const fe = t.run<{ id: string }>(createEntity.name, {
    kind: "monster",
    name: "Fire Elemental",
    statBlock: fireElementalBlock,
  }).id;
  const summon = (input: Partial<SummonInput> = {}, actor: Actor = t.h.dm) =>
    t.run<SummonResult>(
      summonCommand.name,
      {
        encounterId: t.enc.id,
        definitionId: fe,
        count: 1,
        ownerCharacterId: t.miraId,
        ...input,
      },
      actor,
    ).combatantIds;
  const dismiss = (input: DismissInput, actor: Actor = t.h.dm) =>
    t.run(dismissCommand.name, input, actor);
  /** Thorn concentrates on "Conjure Elemental" (as player-2, FR-CBTX-09). */
  const concentrate = (characterId = t.thornId, label = "Conjure Elemental", actor?: Actor) =>
    t.run<{ effectId: string }>(
      CBTX_INTENTS.setConcentration,
      { target: { characterId }, label },
      actor ?? (characterId === t.thornId ? t.p2 : t.p1),
    ).effectId;
  const endEffect = (effectId: string) => t.run(CBTX_INTENTS.endEffect, { effectId });
  const cards = () =>
    t.s.db
      .select()
      .from(notification)
      .where(eq(notification.kind, SUMMON_CARD_KIND))
      .orderBy(asc(notification.seq))
      .all()
      .map(toNotificationRecord);
  return { ...t, fe, summon, dismiss, concentrate, endEffect, cards };
}

export type SummonSetup = ReturnType<typeof summonSetup>;

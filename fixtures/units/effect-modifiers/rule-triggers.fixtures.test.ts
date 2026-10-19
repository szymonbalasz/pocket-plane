// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// MOD §13 trigger units R4 needs (`char-brakka`, `trg-brakka`, `trg-combat`; R5 adds the
// `rule-triggers` bundle): load from empty on a test-local bundle, deterministic, and Divine Fury
// as fixture **data** works end to end (Rage on → attack → offered → apply → used).
import { afterAll, describe, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import {
  combatant,
  creatureSheet,
  effectPreset,
  encounter,
  entity,
  notification,
  ruleTrigger,
  triggerUse,
} from "@server/db/schema";
import type { Actor } from "@server/events/types";
import { loadInProcess } from "@server/features/fixtures-adapters/loader";
import { servicesFromBundle } from "@server/ws/testing/snapshot-size";
import { CBT_INTENTS, type DamageCardPayload } from "@shared/combat-tracker/schemas";
import { MOD_INTENTS } from "@shared/effect-modifiers/intents";
import { asc, eq } from "drizzle-orm";
import { library } from "../../index";

const BUNDLE = {
  name: "rt-engine-test",
  includes: ["combat"],
  fixtures: ["combat-1", "char-brakka", "trg-brakka", "trg-combat"],
};
const lib = { fixtures: library.fixtures, bundles: [...library.bundles, BUNDLE] };

const cleanups: (() => void)[] = [];
afterAll(() => {
  Bun.gc(true);
  for (const c of cleanups) c();
});

async function loaded() {
  const r = await loadInProcess(lib, BUNDLE.name, { testMode: true });
  cleanups.push(r.cleanup);
  const db = r.openDb();
  cleanups.unshift(() => closeDb(db));
  return { r, db };
}

describe("rule-trigger fixtures (MOD §13, R4 units)", () => {
  test("FR-MOD-31 char-brakka + trg-brakka + trg-combat load from empty: Brakka, Rage preset (originKey rage, uses → her Rage row), Divine Fury data, initiative 17", async () => {
    const { r, db } = await loaded();
    expect(r.manifest.fixtures.slice(-3)).toEqual(["char-brakka", "trg-brakka", "trg-combat"]);
    const brakka = db.select().from(entity).where(eq(entity.name, "Brakka")).get();
    expect(brakka?.statBlock).toMatchObject({ level: 5, className: "Barbarian", ac: 14 });
    const [rage] = db
      .select()
      .from(effectPreset)
      .where(eq(effectPreset.characterId, brakka?.id as string))
      .all();
    expect(rage).toMatchObject({ name: "Rage", originKey: "rage", key: null });
    // Tier 3 (R3, walkthrough steps 1-2 "Rage 3 / 3"): linked to her "Rage" feature row.
    const sheet = db
      .select()
      .from(creatureSheet)
      .where(eq(creatureSheet.entityId, brakka?.id as string))
      .get();
    const features = (sheet?.features ?? []) as { id: string; name: string; usesMax?: number }[];
    const rageRow = features.find((f) => f.name === "Rage");
    expect([rageRow?.usesMax, rage?.usesFeatureId]).toEqual([3, rageRow?.id]);
    const [fury] = db.select().from(ruleTrigger).all();
    expect(fury).toMatchObject({
      characterId: brakka?.id,
      ownerPlayerId: brakka?.ownerPlayerId,
      name: "Divine Fury",
      enabled: true,
      public: true,
    });
    expect(fury?.rule as unknown).toEqual({
      on: "hit",
      requires: { preset: rage?.id },
      when: [{ if: "via", via: "weapon" }, { if: "ownTurn" }],
      every: "turn",
      then: { do: "damage", formula: "1d6 + floor(level(barbarian) / 2)", type: "radiant" },
    });
    // No built-in key in the data (#209; the subclass-name guard is trigger-presets.test.ts).
    expect(JSON.stringify(db.select().from(ruleTrigger).all())).not.toContain("divine-fury");
    const ks = db.select().from(combatant).orderBy(asc(combatant.position)).all();
    expect(ks.map((c) => [c.name, c.initiative])).toEqual([
      ["Wolf", 18],
      ["Brakka", 17],
      ["Mira", 15],
      ["Goblin", 12],
      ["Goblin 2", 12],
      ["Thorn", 10],
      ["Elite Goblin Warrior", 8],
    ]);
    const enc = db.select().from(encounter).get();
    expect([enc?.round, ks.find((c) => c.id === enc?.turnCombatantId)?.name]).toEqual([1, "Wolf"]);
    expect(ks.find((c) => c.name === "Brakka")?.tokenId).not.toBeNull();
  }, 30_000);

  test("FR-MOD-52 deterministic: two loads give identical rows", async () => {
    const a = await loaded();
    const b = await loaded();
    expect(b.db.select().from(ruleTrigger).all()).toEqual(a.db.select().from(ruleTrigger).all());
    expect(b.db.select().from(effectPreset).all()).toEqual(a.db.select().from(effectPreset).all());
  }, 30_000);

  test("FR-MOD-37 Divine Fury from fixture data end to end: Next, Rage on (player-1), Greataxe → offered; DM apply → used", async () => {
    const b = await servicesFromBundle(await loadInProcess(lib, BUNDLE.name, { testMode: true }));
    cleanups.push(b.cleanup);
    const db = b.s.db;
    const enc = db.select().from(encounter).get();
    const cid = enc?.campaignId as string;
    const dm: Actor = { role: "dm", playerId: null, campaignId: cid };
    const brakka = db.select().from(entity).where(eq(entity.name, "Brakka")).get();
    const p1: Actor = {
      role: "player",
      playerId: brakka?.ownerPlayerId as string,
      campaignId: cid,
    };
    const run = <R>(name: string, input: unknown, actor = dm) =>
      b.s.commands.run(name, input, { actor }) as R;
    run(CBT_INTENTS.nextTurn, {
      encounterId: enc?.id,
      expectedRound: 1,
      expectedTurnId: enc?.turnCombatantId,
    });
    const rage = db
      .select()
      .from(effectPreset)
      .where(eq(effectPreset.characterId, brakka?.id as string))
      .get();
    run(MOD_INTENTS.toggle, { characterId: brakka?.id, presetId: rage?.id, on: true }, p1);
    const me = db.select().from(combatant).where(eq(combatant.name, "Brakka")).get();
    const { cardId } = run<{ cardId: string }>(
      CBT_INTENTS.attack,
      { attackerId: me?.id, manual: [{ diceTotal: 15 }, { diceTotal: 8 }] },
      p1,
    );
    const p = db.select().from(notification).where(eq(notification.id, cardId)).get()
      ?.payload as DamageCardPayload;
    expect(p.damage?.total).toBe(14);
    expect(p.damage?.triggers?.map((x) => [x.label, x.expression, x.type])).toEqual([
      ["Divine Fury", "1d6+2", "radiant"],
    ]);
    const goblin = db.select().from(combatant).where(eq(combatant.name, "Goblin")).get();
    const fury = p.damage?.triggers?.[0];
    run(CBT_INTENTS.applyCard, {
      cardId,
      toHitTotal: p.toHit?.total,
      damageTotal: p.damage?.total,
      damageRollId: p.damage?.rollId ?? null,
      targets: [
        {
          targetId: goblin?.id,
          hit: true,
          multiplier: "normal",
          triggers: [{ triggerId: fury?.triggerId }],
        },
      ],
    });
    expect(
      db
        .select()
        .from(triggerUse)
        .all()
        .map((u) => [u.state, u.targetId]) as unknown,
    ).toEqual([["used", goblin?.id]]);
  }, 30_000);
});

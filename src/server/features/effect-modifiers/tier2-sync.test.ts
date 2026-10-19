// MOD tier 2 fixture and visibility (FR-MOD-31, FR-MOD-23, -24; MOD §13 `mod-tier2`): the unit
// loads from empty on `effect-modifiers` and is deterministic; "Frost Ward" and the hidden Elite's
// Shield of Faith reach the DM only; an apply on the Elite logs the effective AC and its parts in
// `dmPayload` only; no player snapshot or live change carries AC facts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { library } from "@fixtures/index";
import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";
import { loadInProcess } from "@server/features/fixtures-adapters/loader";
import { EFFECT_TYPE } from "@shared/combat-extras/schemas";
import { AttackLogDmPayload } from "@shared/combat-tracker/log-kinds";
import { COMBATANT_TYPE, type DamageCardPayload } from "@shared/combat-tracker/schemas";
import { EFFECT_PRESET_TYPE, type EffectPresetRecord } from "@shared/effect-modifiers/schemas";
import { eq } from "drizzle-orm";
import { gameLogEntry, hpChange, notification } from "../../db/schema";
import type { Actor, DispatchedEvent } from "../../events/types";
import { servicesFromBundle, snapshotFrames } from "../../ws/testing/snapshot-size";

/** `effect-modifiers` + `mod-tier2`, as R5's `rule-triggers` bundle will stack it. */
const lib = {
  ...library,
  bundles: [
    ...library.bundles,
    defineBundle({
      name: "mod-tier2-test",
      includes: ["effect-modifiers"],
      fixtures: ["mod-tier2"],
    }),
  ],
};
const LEAKS = ["Frost Ward", "Shield of Faith", "shield-of-faith", "acMods"];

let b: Awaited<ReturnType<typeof servicesFromBundle>>;
beforeAll(async () => {
  b = await servicesFromBundle(await loadInProcess(lib, "mod-tier2-test", { testMode: true }));
}, 30_000);
afterAll(() => b.cleanup());

const frames = () => snapshotFrames(b.s);
const dmRecords = <T>(type: string) => (frames()[0]?.records[type] ?? []) as T[];
type Fx = { id: string; label: string; targetCombatantId: string | null; modifiers?: unknown };
type Comb = { id: string; name: string; hidden: boolean };

describe("FR-MOD-31 mod-tier2 fixture", () => {
  test("FR-MOD-31 Frost Ward (resist cold) campaign preset; Shield of Faith +2 AC on the hidden Elite", () => {
    const ward = dmRecords<EffectPresetRecord>(EFFECT_PRESET_TYPE).find(
      (p) => p.name === "Frost Ward",
    );
    expect(ward).toMatchObject({
      characterId: null,
      key: null,
      modifiers: [{ kind: "defense", types: ["cold"], level: "resistance" }],
    });
    const elite = dmRecords<Comb>(COMBATANT_TYPE).find((c) => c.name === "Elite Goblin Warrior");
    expect(elite?.hidden).toBe(true);
    const sof = dmRecords<Fx>(EFFECT_TYPE).filter((e) => e.label === "Shield of Faith");
    expect(sof.map((e) => [e.targetCombatantId, e.modifiers])).toEqual([
      [elite?.id, [{ kind: "flat", on: { roll: "ac" }, value: 2 }]],
    ]);
  });

  test("FR-MOD-31 deterministic: a second load gives the same effect and preset rows", async () => {
    const again = await servicesFromBundle(
      await loadInProcess(lib, "mod-tier2-test", { testMode: true }),
    );
    try {
      const strip = (r: Record<string, unknown[]>) =>
        JSON.stringify([r[EFFECT_TYPE], r[EFFECT_PRESET_TYPE]]);
      expect(strip(snapshotFrames(again.s)[0]?.records ?? {})).toBe(
        strip(frames()[0]?.records ?? {}),
      );
    } finally {
      again.cleanup();
    }
  });

  test("FR-MOD-23/24 players: no Frost Ward, no Elite effects, no AC facts; before and after an apply on the Elite", () => {
    const scan = () => {
      for (const f of frames().filter((x) => x.viewer.role === "player")) {
        const json = JSON.stringify(f.records);
        for (const s of LEAKS) expect(json).not.toContain(s);
      }
    };
    scan();
    const dm = frames()[0]?.viewer;
    const actor: Actor = { role: "dm", playerId: null, campaignId: dm?.campaignId as string };
    const run = <R>(name: string, input: unknown) => b.s.commands.run(name, input, { actor }) as R;
    const events: DispatchedEvent[] = [];
    b.s.bus.subscribe("mod-tier2-leak-scan", (e) => events.push(e));
    const ks = dmRecords<Comb>(COMBATANT_TYPE);
    const elite = ks.find((c) => c.name === "Elite Goblin Warrior") as Comb;
    const mira = ks.find((c) => c.name === "Mira") as Comb;
    const { cardId } = run<{ cardId: string }>("cbt.attack", {
      attackerId: mira.id,
      manual: [{ diceTotal: 10 }, { diceTotal: 3 }],
    });
    const p = b.s.db.select().from(notification).where(eq(notification.id, cardId)).get()
      ?.payload as DamageCardPayload;
    run("cbt.applyCard", {
      cardId,
      toHitTotal: 20,
      damageTotal: p.damage?.total,
      damageRollId: p.damage?.rollId ?? null,
      targets: [{ targetId: elite.id, hit: true, multiplier: "normal" }],
      public: true,
    });
    const row = b.s.db.select().from(hpChange).all().at(-1);
    const line = b.s.db
      .select()
      .from(gameLogEntry)
      .where(eq(gameLogEntry.id, row?.entryId as string))
      .get();
    const dmPayload = AttackLogDmPayload.parse(line?.dmPayload);
    expect(dmPayload.acMods?.map((m) => [m.label, m.value])).toEqual([["Shield of Faith", 2]]);
    expect(row?.targetAc).toBe(dmPayload.targetAc);
    const changes = events.flatMap((e) => e.event.changes);
    for (const f of frames().filter((x) => x.viewer.role === "player")) {
      const wire = JSON.stringify(changes.map((c) => b.s.records.filterChange(c, f.viewer)));
      for (const s of LEAKS) expect(wire).not.toContain(s);
      expect(wire).not.toContain('"targetAc"');
    }
    scan();
  });
});

// MOD §12 / §13.1 CON-44 (S4-0, review B16 / B29): the `rules-effects` fixtures measured end to
// end against `rule-triggers`, every name track R adds or copies made 40 3-byte (CJK) chars
// through the commands (the Flame Tongue row, the Divine Fury and Searing Strike triggers, the
// Fire Ward preset), plus the `trigger-state` rows MOD writes for the started encounter (one per
// enabled trigger and owner combatant, names copied). The baseline's own `trigger-state` bytes
// are left out, so every state row counts in the delta. Ceilings (#208) and MOD's sprint-4
// bounds; per-role rows (FR-MOD-55).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { loadRulesEffects } from "@fixtures/units/effect-modifiers/rules-effects";
import { CHARX_INTENTS } from "@shared/character-sheet/sheet";
import { MOD_INTENTS } from "@shared/effect-modifiers/intents";
import { TRIGGER_INTENTS } from "@shared/effect-modifiers/trigger-intents";
import {
  TRIGGER_STATE_TYPE,
  type TriggerStateRecord,
} from "@shared/effect-modifiers/trigger-state";
import type { Attack } from "@shared/entities/schemas";
import { eq } from "drizzle-orm";
import { campaign, effectPreset, entity, ruleTrigger, triggerState } from "../../db/schema";
import type { Actor } from "../../events/types";
import { SNAPSHOT_CEILING } from "../../ws/hub";
import {
  servicesFromBundle,
  snapshotFrames,
  snapshotSizes,
  type ViewerSize,
} from "../../ws/testing/snapshot-size";

/** MOD §12 sprint-4 bounds as measured in `con44.test.ts` (`R4_DM_MAX`, `R4_PLAYER_MAX`). */
const R4_DM_MAX = 192 * 1024;
const R4_PLAYER_MAX = 60 * 1024;
const cjk = (n: number) => "火".repeat(n);

describe("CON-44 rules-effects end to end, multi-byte names (MOD §12 sprint 4)", () => {
  let before: ViewerSize[];
  let after: ViewerSize[];
  let b: Awaited<ReturnType<typeof servicesFromBundle>>;
  let stateRows = 0;
  beforeAll(async () => {
    const base = await servicesFromBundle(await loadBundle("rule-triggers", { testMode: true }));
    before = snapshotSizes(base.s);
    base.cleanup();

    b = await servicesFromBundle(await loadRulesEffects({ testMode: true }));
    const db = b.s.db;
    const cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
    const dm: Actor = { role: "dm", playerId: null, campaignId: cid };
    const run = (name: string, input: unknown) => b.s.commands.run(name, input, { actor: dm });
    const ent = (name: string) => db.select().from(entity).where(eq(entity.name, name)).get();

    // The Flame Tongue row renamed (its bonus and extra part stay).
    const brakka = ent("Brakka");
    if (!brakka) throw new Error("no Brakka");
    const flame = (brakka.statBlock as { attacks: Attack[] }).attacks.find(
      (a) => a.name === "Flame Tongue greatsword",
    ) as Attack;
    run(CHARX_INTENTS.putRow, {
      creatureId: brakka.id,
      list: "attacks",
      row: { ...flame, name: cjk(40) },
    });
    // The character triggers renamed (Divine Fury, Searing Strike).
    for (const t of db.select().from(ruleTrigger).all()) {
      if (t.characterId === null || t.name === "Sneak Attack") continue;
      run(TRIGGER_INTENTS.putTrigger, {
        trigger: {
          id: t.id,
          characterId: t.characterId,
          name: cjk(40),
          enabled: t.enabled,
          public: t.public,
          rule: t.rule,
        },
      });
    }
    // The Fire Ward preset renamed (DM only).
    const ward = db.select().from(effectPreset).where(eq(effectPreset.name, "Fire Ward")).get();
    run(MOD_INTENTS.putPreset, {
      preset: {
        id: ward?.id,
        characterId: null,
        name: cjk(40),
        modifiers: ward?.modifiers,
        durationRounds: null,
        concentration: false,
        note: "",
      },
    });

    // `trigger-state` as MOD writes it (S4-3): one row per (enabled trigger, owner combatant) of
    // the started encounter, names copied from the renamed triggers.
    stateRows = db.select().from(triggerState).all().length;
    after = snapshotSizes(b.s);
  }, 120_000);
  afterAll(() => b.cleanup());

  test("CON-44 rules-effects end to end with CJK names: ceilings; track R rows within MOD's sprint-4 bounds", () => {
    const base = (i: number) =>
      (before[i]?.bytes ?? 0) - (before[i]?.types[TRIGGER_STATE_TYPE]?.bytes ?? 0);
    const deltas = after.map((s, i) => s.bytes - base(i));
    const typeDelta = (i: number) =>
      Object.entries(after[i]?.types ?? {})
        .map(([k, v]) => {
          const was = k === TRIGGER_STATE_TYPE ? 0 : (before[i]?.types[k]?.bytes ?? 0);
          return [k, v.bytes - was] as const;
        })
        .filter(([, d]) => d !== 0)
        .map(([k, d]) => `${k} ${d > 0 ? "+" : ""}${d}`)
        .join(", ");
    console.log(
      `MOD CON-44 (S4-3) rules-effects vs rule-triggers, CJK names: ${stateRows} trigger-state rows; ${after.map((s, i) => `${s.label} ${s.bytes} B (${(deltas[i] ?? 0) >= 0 ? "+" : ""}${deltas[i]})`).join("; ")}`,
    );
    for (const i of after.keys())
      console.log(`MOD CON-44 (S4-3)   ${after[i]?.label}: ${typeDelta(i)}`);
    expect(stateRows).toBeGreaterThan(0);
    const [dm, ...players] = after;
    expect(dm?.bytes ?? Infinity).toBeLessThan(SNAPSHOT_CEILING.dm);
    for (const p of players) expect(p.bytes).toBeLessThan(SNAPSHOT_CEILING.player);
    expect(deltas[0] ?? Infinity).toBeLessThanOrEqual(R4_DM_MAX);
    for (const d of deltas.slice(1)) expect(d).toBeLessThanOrEqual(R4_PLAYER_MAX);
  });

  test("FR-MOD-55 rules-effects frames: player-1 Brakka's and Mira's rows, player-2 Thorn's; nobody else a monster row", () => {
    const frames = snapshotFrames(b.s);
    const rows = (i: number) =>
      (frames[i]?.records[TRIGGER_STATE_TYPE] ?? []) as TriggerStateRecord[];
    const owners = (i: number) =>
      rows(i)
        .map(
          (r) =>
            b.s.db
              .select()
              .from(entity)
              .where(eq(entity.id, r.characterId ?? ""))
              .get()?.name ?? "monster",
        )
        .sort();
    expect(owners(0)).toEqual(["Brakka", "Mira", "Thorn", "monster", "monster"]);
    expect(owners(1)).toEqual(["Brakka", "Mira"]);
    expect(owners(2)).toEqual(["Thorn"]);
    // Mira's `feature` trigger carries its row id for the owner (uses left from the sheet).
    expect(rows(1).find((r) => r.featureId !== null)?.featureId).toBeTruthy();
  });
});

import { afterAll, describe, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import { combatant, effect, effectPreset, encounter, entity } from "@server/db/schema";
import { builtinPreset } from "@shared/effect-modifiers/presets";
import { asc } from "drizzle-orm";
import { loadBundle } from "../../index";

const cleanups: (() => void)[] = [];
afterAll(() => {
  Bun.gc(true);
  for (const c of cleanups) c();
});

async function loaded() {
  const r = await loadBundle("effect-modifiers", { testMode: true });
  cleanups.push(r.cleanup);
  const db = r.openDb();
  cleanups.unshift(() => closeDb(db));
  const effects = db.select().from(effect).orderBy(asc(effect.seq)).all();
  const presets = db.select().from(effectPreset).orderBy(asc(effectPreset.seq)).all();
  return { r, db, effects, presets };
}

const BLESS = [
  { kind: "dice", on: { roll: "attack" }, dice: "1d4", sign: 1 },
  { kind: "dice", on: { roll: "save" }, dice: "1d4", sign: 1 },
];
const BANE = BLESS.map((m) => ({ ...m, sign: -1 }));

describe("effect-modifiers fixtures (MOD §13)", () => {
  test("FR-MOD-31 effect-modifiers bundle loads from empty: presets, Bless, Bane, Cursed, Rage", async () => {
    const { r, db, effects, presets } = await loaded();
    expect(r.manifest.fixtures.slice(-5)).toEqual([
      "combat-1",
      "mod-presets",
      "mod-bless",
      "mod-bane",
      "mod-rage",
    ]);
    const ks = db.select().from(combatant).all();
    const chars = db.select().from(entity).all();
    const on = (e: (typeof effects)[number]) =>
      ks.find((c) => c.id === e.targetCombatantId)?.name ??
      chars.find((c) => c.id === e.targetCharacterId)?.name;
    const anchor = (id: string | null) => ks.find((c) => c.id === id)?.name ?? null;
    const cursedId = presets[1]?.id;
    expect(
      effects.map((e) => ({
        kind: e.kind,
        label: e.label,
        on: on(e),
        endsRound: e.endsRound,
        anchor: anchor(e.anchorCombatantId),
        linked: e.concentrationId !== null,
        secret: e.secret,
        hidden: e.hidden,
        modifiers: e.modifiers,
        presetKey: e.presetKey,
      })) as unknown,
    ).toEqual([
      // mod-bless: Mira concentrates, Bless on Mira and Thorn (linked, 10 rounds from round 1).
      { ...fx("concentration", "Bless", "Mira", "Mira"), modifiers: [], presetKey: null },
      ...["Mira", "Thorn"].map((who) => ({
        ...fx("custom", "Bless", who, "Mira"),
        linked: true,
        modifiers: BLESS,
        presetKey: "bless",
      })),
      // mod-bane: Elite (hidden) concentrates; Goblin's Bane linked.
      {
        ...fx("concentration", "Bane", "Elite Goblin Warrior", "Elite Goblin Warrior"),
        hidden: true,
        modifiers: [],
        presetKey: null,
      },
      {
        ...fx("custom", "Bane", "Goblin", "Elite Goblin Warrior"),
        linked: true,
        modifiers: BANE,
        presetKey: "bane",
      },
      // "Cursed": no duration, secret, keyed by the campaign preset's id.
      {
        ...fx("custom", "Cursed", "Goblin 2", null),
        endsRound: null,
        secret: true,
        modifiers: [{ kind: "dice", on: { roll: "save" }, dice: "1d4", sign: -1 }],
        presetKey: cursedId,
      },
    ]);
    const thorn = chars.find((c) => c.name === "Thorn");
    expect(
      presets.map((p) => [
        p.key,
        p.name,
        p.characterId,
        p.ownerPlayerId,
        p.note,
        p.activeEffectId,
      ]) as unknown,
    ).toEqual([
      ["bless", "Bless", null, null, "House: Bless (test)", null],
      [null, "Cursed", null, null, "", null],
      [
        null,
        "Rage",
        thorn?.id,
        thorn?.ownerPlayerId,
        "Weapon damage includes ranged attacks.",
        null,
      ],
    ]);
    // Built tiers decide fixture contents (FR-MOD-05): tier 2 adds Rage's adv STR and resistances.
    expect(presets[2]?.modifiers).toEqual(builtinPreset("rage")?.modifiers);
    expect(presets[2]?.modifiers).toHaveLength(4);
    const enc = db.select().from(encounter).get();
    expect({ round: enc?.round, turn: anchor(enc?.turnCombatantId ?? null) }).toEqual({
      round: 1,
      turn: "Wolf",
    });
  }, 30_000);

  test("FR-MOD-31 deterministic: two loads give identical IDs and rows", async () => {
    const a = await loaded();
    const b = await loaded();
    expect(b.effects).toEqual(a.effects);
    expect(b.presets).toEqual(a.presets);
  }, 30_000);
});

function fx(kind: string, label: string, on: string, anchor: string | null) {
  return {
    kind,
    label,
    on,
    endsRound: 11,
    anchor,
    linked: false,
    secret: false,
    hidden: false,
  };
}

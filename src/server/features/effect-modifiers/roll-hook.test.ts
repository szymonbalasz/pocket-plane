// MOD's roll hook through `dice.evaluate` (FR-MOD-13/14/18/19/23): a stand-in caller passes a
// subject; parts come from the creature's active effects at commit, bonus dice are their own
// rows, labels public iff the effect is player-visible. Real callers are wired in slice 3.
import { describe, expect, test } from "bun:test";
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import { eq } from "drizzle-orm";
import { gameLogEntry, roll } from "../../db/schema";
import { rollHooks } from "../dice-roll-log/roll-hooks";
import { modRollHook } from "./roll-hook";
import { type ModSetup, modSetup } from "./testing";

const rollRow = (t: ModSetup, id: string) =>
  t.s.db.select().from(roll).where(eq(roll.id, id)).get();
const entry = (t: ModSetup, id: string) =>
  t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, id)).get();

describe("FR-MOD-13 registry line", () => {
  test("FR-MOD-13 MOD registers one roll hook", () => {
    expect(rollHooks.filter((h) => h === modRollHook)).toHaveLength(1);
  });
});

describe("FR-MOD-14 parts from active effects", () => {
  test("FR-MOD-14 Bless: attack and save get +1d4 (own roll row, label Bless); damage gets none", () => {
    const t = modSetup();
    t.bless();
    const blessId = t.active().find((e) => e.targetCharacterId === t.miraId && e.kind === "custom")
      ?.id as string;
    const a = t.roll({ creature: { characterId: t.miraId }, roll: "attack", via: "weapon" });
    const [p] = a.roll.mods?.parts ?? [];
    const die = rollRow(t, p?.rollId as string);
    expect(p).toMatchObject({ effectId: blessId, label: "Bless", public: true, expression: "1d4" });
    expect(die).toMatchObject({
      expression: "1d4",
      label: "Bless",
      category: "attack",
      manual: false,
    });
    expect(p?.value).toBe(die?.total as number);
    expect(a.roll.mods?.modTotal).toBe(die?.total as number);
    const e = entry(t, a.entryId);
    expect(e?.rollIds).toEqual([a.roll.id, die?.id]);
    expect((e?.payload as { total: number }[] | undefined)?.[0]?.total).toBe(
      a.roll.total + (die?.total ?? 0),
    );
    expect(
      t.roll({ creature: { characterId: t.miraId }, roll: "save", ability: "wis" }).roll.mods
        ?.parts,
    ).toHaveLength(1);
    // A death save is a save with no ability: Bless (no ability filter) applies.
    expect(
      t.roll({ creature: { characterId: t.thornId }, roll: "save" }).roll.mods?.parts,
    ).toHaveLength(1);
    const dmg = t.roll(
      { creature: { characterId: t.miraId }, roll: "damage", via: "weapon" },
      { expression: "1d6+2" },
    );
    expect(dmg.roll.mods).toEqual({ parts: [], modTotal: 0, modes: [] });
    expect(dmg.roll.id).toBeDefined();
    expect(entry(t, dmg.entryId)?.payload).not.toHaveProperty("0.mods");
  });

  test("FR-MOD-15 a PC combatant's subject reads its character's effects", () => {
    const t = modSetup();
    t.bless();
    const r = t.roll({ creature: { combatantId: t.id("Mira") }, roll: "attack", via: "weapon" });
    expect(r.roll.mods?.parts.map((p) => p.label)).toEqual(["Bless"]);
  });

  test("FR-MOD-14 Bane subtracts on a monster; flat Rage adds on weapon damage only; parts in seq order", () => {
    const t = modSetup();
    t.apply({ targets: [{ combatantId: t.id("Goblin") }], preset: { key: "bane" } });
    const g = t.roll({ creature: { combatantId: t.id("Goblin") }, roll: "attack", via: "weapon" });
    const [bane] = g.roll.mods?.parts ?? [];
    expect(bane?.label).toBe("Bane");
    expect(bane?.value).toBe(-(rollRow(t, bane?.rollId as string)?.total ?? 0));
    expect(bane?.value).toBeLessThan(0);
    const rage = t.put(t.from("rage", { characterId: t.thornId }), t.p2);
    t.toggle(t.thornId, rage, true, t.p2);
    t.bless();
    const dmg = (via: "weapon" | "spell") =>
      t.roll({ creature: { characterId: t.thornId }, roll: "damage", via }, { expression: "1d4+3" })
        .roll.mods?.parts;
    expect(dmg("weapon")).toEqual([
      { effectId: expect.any(String), label: "Rage", public: true, value: 2 },
    ]);
    expect(dmg("spell")).toEqual([]);
    t.d6OnThorn();
    expect(dmg("weapon")?.map((p) => p.label)).toEqual(["Rage", "Hunter's Mark"]);
  });

  test("FR-MOD-14 crit: bonus damage dice double, flat bonuses don't", () => {
    const t = modSetup();
    t.d6OnThorn();
    const rage = t.put(t.from("rage", { characterId: t.thornId }), t.p2);
    t.toggle(t.thornId, rage, true, t.p2);
    const r = t.roll(
      { creature: { characterId: t.thornId }, roll: "damage", via: "weapon", crit: true },
      { expression: "2d4+3" },
    );
    expect(r.roll.mods?.parts.map((p) => [p.label, p.expression ?? null, p.value > 0])).toEqual([
      ["Hunter's Mark", "2d6", true],
      ["Rage", null, true],
    ]);
    expect(r.roll.mods?.parts[1]?.value).toBe(2);
  });

  test("FR-MOD-18 physical base roll: the server rolls the bonus die, tagged auto", () => {
    const t = modSetup();
    t.bless();
    const r = t.roll(
      { creature: { characterId: t.miraId }, roll: "save", ability: "con" },
      { expression: "1d20+4", manual: { diceTotal: 10 } },
    );
    expect(r.roll.manual).toBe(true);
    expect(r.roll.mods?.parts[0]).toMatchObject({ label: "Bless", auto: true });
    expect(rollRow(t, r.roll.mods?.parts[0]?.rollId as string)?.manual).toBe(false);
  });

  test("FR-MOD-16 an ended effect adds nothing: Mira loses concentration → next roll has no part", () => {
    const t = modSetup();
    t.bless();
    t.end(t.active()[0]?.id as string);
    const r = t.roll({ creature: { characterId: t.thornId }, roll: "attack", via: "weapon" });
    expect(r.roll.mods?.parts).toEqual([]);
  });
});

describe("FR-MOD-19/23 labels and visibility", () => {
  const view = (t: ModSetup, entryId: string, who: "dm" | "p1") => {
    const row = entry(t, entryId);
    const v =
      who === "dm"
        ? { connId: "dm", campaignId: t.h.campaignId, role: "dm" as const, playerId: null }
        : {
            connId: "p1",
            campaignId: t.h.campaignId,
            role: "player" as const,
            playerId: t.h.p1.id,
          };
    return t.s.records.view(GAME_LOG_ENTRY_TYPE, { ...row }, v);
  };

  test("FR-MOD-19/23 'Cursed' (secret) public save: players' label null, DM's dmPayload names it", () => {
    const t = modSetup();
    const cursed = t.put({
      characterId: null,
      name: "Cursed",
      modifiers: [{ kind: "dice", on: { roll: "save" }, dice: "1d4", sign: -1 }],
      durationRounds: null,
      concentration: false,
    });
    t.apply({
      targets: [{ combatantId: t.id("Goblin 2") }],
      preset: { presetId: cursed },
      secret: true,
    });
    const r = t.roll(
      { creature: { combatantId: t.id("Goblin 2") }, roll: "save", ability: "wis" },
      { actorName: "Goblin 2", expression: "1d20" },
    );
    expect(r.roll.mods?.parts[0]).toMatchObject({ label: "Cursed", public: false });
    const p = JSON.stringify(view(t, r.entryId, "p1"));
    expect(p).not.toContain("Cursed");
    expect(p).not.toContain(cursed);
    expect(p).toContain('"label":null');
    const dm = JSON.stringify(view(t, r.entryId, "dm"));
    expect(dm).toContain('"label":"Cursed"');
    // Attacks aren't saves: no part.
    expect(
      t.roll({ creature: { combatantId: t.id("Goblin 2") }, roll: "attack", via: "weapon" }).roll
        .mods?.parts,
    ).toEqual([]);
  });

  test("FR-MOD-23 a hidden creature's effect part is not public", () => {
    const t = modSetup();
    t.apply({
      targets: [{ combatantId: t.id("Goblin") }],
      preset: { key: "bane" },
      sourceCombatantId: t.id("Elite Goblin Warrior"),
      startConcentration: true,
    });
    t.apply({ targets: [{ combatantId: t.id("Elite Goblin Warrior") }], preset: { key: "bless" } });
    const r = t.roll({ creature: { combatantId: t.id("Elite Goblin Warrior") }, roll: "attack" });
    expect(r.roll.mods?.parts.map((p) => [p.label, p.public])).toEqual([["Bless", false]]);
    // The visible Goblin's Bane is public ("− 2 Bane", accepted leak).
    const g = t.roll({ creature: { combatantId: t.id("Goblin") }, roll: "save", ability: "dex" });
    expect(g.roll.mods?.parts.map((p) => [p.label, p.public])).toEqual([["Bane", true]]);
  });
});

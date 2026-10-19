import { describe, expect, test } from "bun:test";
import { actionsOf } from "./creature-actions";
import { creatureRows, matchCreatureRows } from "./list";

const t = { createdAt: "t", updatedAt: "t", portraitAssetId: null, tokenShape: null };
const monster = (cr: string) => ({
  size: "small",
  ac: 15,
  hpMax: 7,
  initBonus: 2,
  attacks: [],
  cr,
});
const pc = {
  size: "medium",
  ac: 16,
  hpMax: 12,
  initBonus: 2,
  attacks: [],
  level: 1,
  className: "",
};
const prov = { source: "fixture", sourceKey: "k", licence: "l", attribution: "a", importedAt: "t" };

const goblin = {
  ...t,
  ...prov,
  id: "g",
  kind: "monster",
  campaignId: null,
  name: "Goblin",
  statBlock: monster("1/4"),
  ownerPlayerId: null,
  hpCurrent: null,
  derivedFromId: null,
};
const wolf = { ...goblin, id: "w", name: "Wolf", sourceKey: "wolf" };
const elite = {
  ...t,
  id: "e",
  kind: "monster",
  campaignId: "c",
  name: "Elite Goblin Warrior",
  statBlock: monster("1/2"),
  ownerPlayerId: null,
  hpCurrent: null,
  derivedFromId: "g",
};
const orphan = { ...elite, id: "o", name: "Orphan", derivedFromId: "gone" };
const mira = {
  ...t,
  id: "m",
  kind: "character",
  campaignId: "c",
  name: "Mira",
  statBlock: pc,
  ownerPlayerId: "p1",
  hpCurrent: 12,
  derivedFromId: null,
};
const customGoblin = { ...elite, id: "cg", name: "goblin", derivedFromId: null };
const players = [{ id: "p1", campaignId: "c", name: "Player 1", color: "jade" }];

describe("Creatures list model", () => {
  test("FR-ENT-18 sorted by name ci, custom before imported, then source rank, then id; badges, CR + XP", () => {
    const rows = creatureRows([elite, mira, customGoblin], [wolf, goblin], players);
    expect(rows.map((r) => [r.name, r.badge, r.readOnly])).toEqual([
      ["Elite Goblin Warrior", "Custom", false],
      ["goblin", "Custom", false],
      ["Goblin", "Fixture", true],
      ["Mira", "Player 1", false],
      ["Wolf", "Fixture", true],
    ]);
    // Imported rows are badged by source (FR-CMP-19's label): SRD 5.1 → "SRD", fixture → "Fixture".
    const srd = { ...goblin, id: "srd-gob", source: "srd-5.1" };
    expect(creatureRows([], [srd], players)[0]?.badge).toBe("SRD");
    expect(rows.map((r) => r.xp)).toEqual([100, 100, 50, null, 50]);
    expect(rows[0]?.derivedFrom).toBe("Goblin");
  });

  test("FR-ENT-18 order: equal names → custom, then srd-5.1, then fixture, then id (FR-CMP-38)", () => {
    // "a-fx" sorts before "z-srd" by id; source rank decides first.
    const fx = { ...goblin, id: "a-fx" };
    const srd = { ...goblin, id: "z-srd", source: "srd-5.1", sourceKey: "monster/goblin" };
    const rows = creatureRows([customGoblin], [fx, srd], players);
    expect(rows.map((r) => [r.id, r.badge])).toEqual([
      ["cg", "Custom"],
      ["z-srd", "SRD"],
      ["a-fx", "Fixture"],
    ]);
  });

  test("FR-ENT-18 FR-CMP-37 search: every word matches the name by the shared tier, by tier, then FR-ENT-18 order", () => {
    const srd = { ...goblin, id: "z-srd", source: "srd-5.1", sourceKey: "monster/goblin" };
    const hob = { ...goblin, id: "h", name: "Hobgoblin", sourceKey: "hob", source: "srd-5.1" };
    const rows = creatureRows([elite, mira, customGoblin], [goblin, srd, hob, wolf], players);
    const names = (q: string) => matchCreatureRows(rows, q).map((r) => `${r.name}/${r.badge}`);
    // SRD Goblin above the fixture Goblin (FR-CMP-38); tier 1 before 2 before 3.
    expect(names("gob")).toEqual([
      "goblin/Custom",
      "Goblin/SRD",
      "Goblin/Fixture",
      "Elite Goblin Warrior/Custom",
      "Hobgoblin/SRD",
    ]);
    expect(names("goblin")).toEqual([
      "goblin/Custom",
      "Goblin/SRD",
      "Goblin/Fixture",
      "Elite Goblin Warrior/Custom",
      "Hobgoblin/SRD",
    ]);
    expect(names("warrior gob")).toEqual(["Elite Goblin Warrior/Custom"]);
    expect(names("MIRA")).toEqual(["Mira/Player 1"]);
    expect(names("gob zzz")).toEqual([]);
    expect(matchCreatureRows(rows, "  ")).toEqual(rows);
  });

  test("FR-ENT-18 tabs filter by kind", () => {
    const all = [elite, mira];
    expect(creatureRows(all, [goblin], players, "character").map((r) => r.id)).toEqual(["m"]);
    expect(creatureRows(all, [goblin], players, "monster").map((r) => r.id)).toEqual(["e", "g"]);
  });

  test("ENT §7 derived from an unresolvable base → (unknown)", () => {
    expect(creatureRows([orphan], [], players)[0]?.derivedFrom).toBe("(unknown)");
  });

  test("FR-ENT-01 rows failing their schema are omitted", () => {
    const bad = { ...elite, id: "bad", statBlock: { ...monster("1/4"), ac: 99 } };
    expect(creatureRows([bad, elite, { junk: true }], [], players).map((r) => r.id)).toEqual(["e"]);
  });

  test("FR-ENT-20 creatureActions: split by placement, duplicate ids throw", () => {
    const C = () => null;
    const a = actionsOf([
      { placement: "toolbar", id: "x.new", component: C },
      { placement: "row", id: "x.edit", component: C },
    ]);
    expect([a.toolbar.map((x) => x.id), a.row.map((x) => x.id)]).toEqual([["x.new"], ["x.edit"]]);
    expect(() =>
      actionsOf([
        { placement: "row", id: "x", component: C },
        { placement: "toolbar", id: "x", component: C },
      ]),
    ).toThrow();
  });
});

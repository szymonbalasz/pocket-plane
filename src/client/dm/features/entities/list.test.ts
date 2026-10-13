import { describe, expect, test } from "bun:test";
import { actionsOf } from "./creature-actions";
import { creatureRows } from "./list";

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
const players = [{ id: "p1", campaignId: "c", name: "Player 1" }];

describe("Creatures list model", () => {
  test("FR-ENT-18 sorted by name ci, custom before imported, then id; badges, CR + XP", () => {
    const rows = creatureRows([elite, mira, customGoblin], [wolf, goblin], players);
    expect(rows.map((r) => [r.name, r.badge, r.readOnly])).toEqual([
      ["Elite Goblin Warrior", "Custom", false],
      ["goblin", "Custom", false],
      ["Goblin", "SRD", true],
      ["Mira", "Player 1", false],
      ["Wolf", "SRD", true],
    ]);
    expect(rows.map((r) => r.xp)).toEqual([100, 100, 50, null, 50]);
    expect(rows[0]?.derivedFrom).toBe("Goblin");
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

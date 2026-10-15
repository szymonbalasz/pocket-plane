// Sprint 2, N5 DM client logic (pure): Start / Add preview (FR-CBT-64, FR-CBTX-44), "Not on this
// map" + Start body (FR-CBT-66), Add options (OQ-CBTX-22, FR-CBT-65), `at` from the free area
// (FR-CBT-65), creature form HP formula (FR-CBT-62).
import { describe, expect, test } from "bun:test";
import { MonsterStatBlock } from "@shared/entities/schemas";
import { type Fields, formStatBlock, formulaAverage } from "./creature-form";
import {
  addOptionsState,
  defaultJoiningIds,
  hpLabel,
  type JoinSlot,
  notOnMap,
  previewJoin,
  startBody,
} from "./join-preview";
import { cellAtScreen, rectCentre } from "./place-at";

const monster = (entityId: string, name: string, o: Partial<JoinSlot> = {}): JoinSlot => ({
  kind: "monster",
  entityId,
  name,
  portraitAssetId: null,
  hpMode: "average",
  hasFormula: true,
  ...o,
});
const pc = (entityId: string, name: string): JoinSlot => ({
  kind: "pc",
  entityId,
  name,
  portraitAssetId: null,
  hpMode: "average",
  hasFormula: false,
});
const tok = (id: string, seq: number, definitionId: string, name: string, hidden = false) => ({
  id,
  seq,
  definitionId,
  name,
  imageAssetId: null,
  hidden,
});

describe("FR-CBT-64 FR-CBTX-44 join preview", () => {
  const tokens = [tok("t-mira", 1, "mira", "Mira"), tok("t-gob", 2, "gob", "Goblin", true)];
  const slots = [
    pc("mira", "Mira"),
    pc("thorn", "Thorn"),
    monster("gob", "Goblin", { hpMode: "rolled" }),
    monster("gob", "Goblin", { hpMode: "rolled" }),
    monster("elite", "Elite", { hpMode: "rolled", hasFormula: false }),
  ];
  const names = ["Mira", "Goblin"];

  test("FR-CBT-64 placed token → token; else createTokens → new token (numbered, hidden = Add hidden); PCs never new", () => {
    const rows = previewJoin(slots, tokens, {
      createTokens: true,
      hidden: true,
      sceneTokenNames: names,
    });
    expect(rows.map((r) => [r.name, r.binding, r.hidden, hpLabel(r)])).toEqual([
      ["Mira", "token", false, ""],
      ["Thorn", "none", false, ""],
      ["Goblin", "token", true, "Rolled"],
      ["Goblin 2", "new", true, "Rolled"],
      ["Elite", "new", true, "Average (no formula)"],
    ]);
  });

  test("FR-CBT-64 createTokens off → no token, visible, numbered over the encounter's names", () => {
    const rows = previewJoin(slots, tokens, {
      createTokens: false,
      hidden: true,
      sceneTokenNames: names,
    });
    expect(rows.map((r) => [r.name, r.binding, r.hidden])).toEqual([
      ["Mira", "token", false],
      ["Thorn", "none", false],
      ["Goblin", "token", true],
      ["Goblin 2", "none", false],
      ["Elite", "none", false],
    ]);
  });

  test("FR-CBTX-44 options: Add hidden disabled while Create tokens off or no scene", () => {
    expect(addOptionsState({ createTokens: true, hasScene: true })).toEqual({
      createDisabled: false,
      hiddenDisabled: false,
      creating: true,
    });
    expect(addOptionsState({ createTokens: false, hasScene: true }).hiddenDisabled).toBe(true);
    expect(addOptionsState({ createTokens: true, hasScene: false })).toEqual({
      createDisabled: true,
      hiddenDisabled: true,
      creating: false,
    });
  });
});

describe("FR-CBT-66 not on this map", () => {
  test("FR-CBT-66 PCs without a token on the scene; unticked → excludeCharacterIds; at only when measured", () => {
    const party = [{ id: "mira" }, { id: "thorn" }, { id: "bram" }];
    const off = notOnMap(party, [{ definitionId: "mira" }, { definitionId: "gob" }]);
    expect(off.map((c) => c.id)).toEqual(["thorn", "bram"]);
    expect(startBody("e", "s", off, new Set(["bram"]), { col: 3, row: 4 })).toEqual({
      encounterId: "e",
      sceneId: "s",
      at: { col: 3, row: 4 },
      excludeCharacterIds: ["thorn"],
    });
    expect(startBody("e", "s", [], new Set(), null)).toEqual({ encounterId: "e", sceneId: "s" });
  });

  test("FR-CBT-66 P3 glitch 7: the builder rates the PCs Start adds by default (token on the scene)", () => {
    const tokens = [{ definitionId: "mira" }, { definitionId: "thorn" }, { definitionId: "gob" }];
    expect(defaultJoiningIds(["mira", "sela", "thorn"], tokens)).toEqual(["mira", "thorn"]);
    expect(defaultJoiningIds(["sela"], tokens)).toEqual([]);
    expect(defaultJoiningIds([], tokens)).toEqual([]);
  });
});

describe("FR-CBT-65 at from the free area", () => {
  test("FR-CBT-65 the cell under the free area's centre: screen → stage (pan, zoom) → grid", () => {
    const grid = { gridCellSize: 70, gridOffsetX: 10, gridOffsetY: 0 };
    const area = { x: 100, y: 50, w: 800, h: 600 };
    expect(rectCentre(area)).toEqual({ x: 500, y: 350 });
    // Container at (0, 40), panned by (−100, 20), zoom 0.5: map px = ((500 − 0 + 100) / 0.5, …).
    const stage = { left: 0, top: 40, x: -100, y: 20, scale: 0.5 };
    expect(cellAtScreen(rectCentre(area), stage, grid)).toEqual({
      col: Math.floor((1200 - 10) / 70),
      row: Math.floor(580 / 70),
    });
    expect(cellAtScreen({ x: 0, y: 0 }, { ...stage, x: 1e9, scale: 1 }, grid).col).toBe(-100_000);
  });
});

describe("FR-CBT-62 creature form HP formula", () => {
  const fields = (o: Partial<Fields> = {}): Fields => ({
    name: "Goblin Boss",
    size: "small",
    ac: "17",
    hpMax: "21",
    initBonus: "2",
    cr: "1",
    portraitAssetId: null,
    attackName: "",
    toHit: "",
    damage: "",
    damageType: "__none__",
    speed: "",
    tokenShape: "default",
    abilities: { str: "", dex: "", con: "", int: "", wis: "", cha: "" },
    saves: [],
    ...o,
  });

  test("FR-CBT-62 Average hint; formula sent, cleared, or kept when the form doesn't show it", () => {
    expect(formulaAverage("6d6")).toBe(21);
    expect(formulaAverage("2d8+2")).toBe(11);
    expect(formulaAverage("")).toBeNull();
    expect(formulaAverage("2x8")).toBeNull();
    const sent = formStatBlock(fields({ hpFormula: " 6d6 " }), null);
    expect(MonsterStatBlock.parse(sent.ok ? sent.value : null).hpFormula).toBe("6d6");
    const source = { ...MonsterStatBlock.parse({ ...base(), hpFormula: "2d6" }) };
    const cleared = formStatBlock(fields({ hpFormula: "" }), source);
    expect("hpFormula" in MonsterStatBlock.parse(cleared.ok ? cleared.value : null)).toBe(false);
    const kept = formStatBlock(fields(), source);
    expect(MonsterStatBlock.parse(kept.ok ? kept.value : null).hpFormula).toBe("2d6");
  });
});

function base() {
  return {
    size: "small",
    ac: 15,
    hpMax: 7,
    initBonus: 2,
    attacks: [],
    cr: "1/4",
  };
}

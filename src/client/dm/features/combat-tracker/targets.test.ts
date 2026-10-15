// FR-CBT-33 attack popup target list, FR-CBT-35 Undo label, FR-CBT-43 creature form stat block.
import { describe, expect, test } from "bun:test";
import type { HpChangeRecord } from "@shared/combat-tracker/schemas";
import { MonsterStatBlock } from "@shared/entities/schemas";
import { type Fields, formStatBlock } from "./creature-form";
import {
  addAction,
  applyReady,
  cardShape,
  hpAfter,
  hpDialogText,
  naturalContradiction,
  presetHit,
  previewText,
  rowPreset,
  shownTotal,
  targetList,
  totalOf,
  undoLabel,
} from "./targets";

const k = (id: string, tokenId: string | null, o: object = {}) => ({
  id,
  encounterId: "e1",
  tokenId,
  name: id,
  active: true,
  removed: false,
  ...o,
});
const combatants = [
  k("Elite", "t-elite", { hidden: true }),
  k("Goblin", "t-gob"),
  k("Goblin 2", "t-gob2"),
  k("Mira", "t-mira"),
  k("Thorn", "t-thorn", { removed: true }),
  k("Wolf", "t-wolf", { hidden: true }),
  k("Ghost", null),
  k("Old", "t-old", { encounterId: "e0" }),
];
const list = (selectedTokenIds: string[], added: string[] = []) =>
  targetList({ combatants, encounterId: "e1", attackerId: "Elite", selectedTokenIds, added });
const names = (l: ReturnType<typeof list>) => l.rows.map((r) => [r.c.id, r.source]);

describe("FR-CBT-33 target list", () => {
  test("FR-CBT-33 selection rows: eligible only, selection order, attacker excluded, others counted", () => {
    const l = list(["t-gob2", "t-gob", "t-elite", "t-thorn", "t-tree", "t-old"]);
    expect(names(l)).toEqual([
      ["Goblin 2", "selection"],
      ["Goblin", "selection"],
    ]);
    // Thorn (removed), a non-combat token and another encounter's: "3 selected not in combat".
    expect(l.notInCombat).toBe(3);
    expect(l.tooMany).toBe(false);
  });

  test("FR-CBT-33 added rows after selection rows; duplicates once; ineligible dropped", () => {
    const l = list(["t-gob"], ["Ghost", "Goblin", "Thorn", "Wolf", "Elite"]);
    expect(names(l)).toEqual([
      ["Goblin", "selection"],
      ["Ghost", "added"],
      ["Wolf", "added"],
    ]);
  });

  test("FR-CBT-33 a viewed-scene switch (selection cleared) keeps added rows", () => {
    expect(names(list([], ["Wolf"]))).toEqual([["Wolf", "added"]]);
  });

  test("FR-CBT-33 > 20 rows → tooMany (Apply disabled, Max 20 targets)", () => {
    const many = Array.from({ length: 21 }, (_, i) => k(`m${i}`, `t${i}`));
    const pick = (n: number) =>
      targetList({
        combatants: many,
        encounterId: "e1",
        attackerId: "x",
        selectedTokenIds: many.slice(0, n).map((c) => c.tokenId as string),
        added: [],
      });
    expect(pick(20).tooMany).toBe(false);
    expect(pick(21).tooMany).toBe(true);
  });

  test("FR-CBT-33 adding: token on the viewed scene → select it; else an added row", () => {
    const scene = (t: string) => (t === "t-gob" ? "s1" : t === "t-wolf" ? "s2" : null);
    expect(addAction(k("Goblin", "t-gob"), scene, "s1")).toEqual({ select: "t-gob" });
    expect(addAction(k("Wolf", "t-wolf"), scene, "s1")).toEqual({ add: "Wolf" });
    expect(addAction(k("Ghost", null), scene, "s1")).toEqual({ add: "Ghost" });
  });

  test("FR-CBT-33 per-target hit preset: nat 20 hit, nat 1 miss, else total ≥ AC", () => {
    expect([15, 13, 16].map((ac) => presetHit(10, 15, ac))).toEqual([true, true, false]);
    expect(presetHit(20, 5, 30)).toBe(true);
    expect(presetHit(1, 40, 10)).toBe(false);
    expect(presetHit(10, 1, null)).toBe(true);
  });
});

describe("FR-CBT-35 Undo label", () => {
  const row = (id: string, seq: number, o: Partial<HpChangeRecord> = {}) =>
    ({
      id,
      seq,
      cardId: null,
      undone: false,
      attackerName: "Goblin",
      targetName: "Mira",
      kind: "damage",
      hit: true,
      raw: 6,
      applied: 6,
      ...o,
    }) as HpChangeRecord;

  test("FR-CBT-80 undo label: one row 'N damage' from raw, miss, heal; direct = DM", () => {
    expect(undoLabel([])).toBeNull();
    expect(undoLabel([row("a", 1)])).toEqual({
      text: "Undo: Goblin → Mira, 6 damage",
      expectedHpChangeId: "a",
    });
    // 99 to a PC at 4 HP: the label says what was dealt, not the HP lost.
    expect(undoLabel([row("a", 1, { raw: 99, applied: 4 })])?.text).toBe(
      "Undo: Goblin → Mira, 99 damage",
    );
    expect(undoLabel([row("a", 1, { hit: false, raw: 0, applied: 0 })])?.text).toBe(
      "Undo: Goblin → Mira, miss",
    );
    expect(
      undoLabel([row("a", 1, { attackerName: null, hit: null, kind: "heal", raw: 5, applied: 4 })])
        ?.text,
    ).toBe("Undo: DM → Mira, heal 5");
    expect(undoLabel([row("a", 1, { attackerName: null, hit: null, raw: 99 })])?.text).toBe(
      "Undo: DM → Mira, 99 damage",
    );
  });

  test("FR-CBT-80 multi-target apply unchanged: names in apply order, count, expected = latest", () => {
    const rows = [
      row("x", 1, { cardId: "c0" }),
      row("a", 2, { cardId: "c1", targetName: "Goblin" }),
      row("b", 3, { cardId: "c1", targetName: "Goblin 2" }),
    ];
    expect(undoLabel(rows)).toEqual({
      text: "Undo: Goblin → Goblin, Goblin 2 (2 targets)",
      expectedHpChangeId: "b",
    });
  });
});

describe("FR-CBT-78 temp HP in previews", () => {
  const thorn = { cur: 10, max: 10, temp: 5 };
  test("FR-CBT-78 preview: temp ≥ raw, temp < raw, no temp; heal ignores temp", () => {
    expect(previewText("Thorn", thorn, 3)).toBe("Thorn 10 (+5) → 10 (+2)");
    expect(previewText("Thorn", thorn, 5)).toBe("Thorn 10 (+5) → 10");
    expect(previewText("Thorn", thorn, 8)).toBe("Thorn 10 (+5) → 7");
    expect(previewText("Goblin", { cur: 7, max: 7, temp: 0 }, 6)).toBe("Goblin 7 → 1");
    expect(previewText("Goblin", { cur: 7, max: 7, temp: 0 }, 99)).toBe("Goblin 7 → 0");
    expect(hpAfter({ cur: 4, max: 10, temp: 5 }, "heal", 3)).toEqual({ cur: 7, max: 10, temp: 5 });
    expect(hpAfter({ cur: 4, max: 10, temp: 5 }, "heal", 30).cur).toBe(10);
  });

  test("FR-CBT-78 dialog header: 'HP 10 / 10 · Temp 5', no temp → 'HP 10 / 10'", () => {
    expect(hpDialogText(thorn)).toBe("HP 10 / 10 · Temp 5");
    expect(hpDialogText(hpAfter(thorn, "damage", 3))).toBe("HP 10 / 10 · Temp 2");
    expect(hpDialogText({ ...thorn, temp: 0 })).toBe("HP 10 / 10");
  });
});

describe("FR-CBT-43 creature form stat block", () => {
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

  test("FR-CBT-43 speed, all six scores, saves; blank speed / scores omitted", () => {
    const r = formStatBlock(
      fields({
        speed: "30",
        abilities: { str: "10", dex: "14", con: "10", int: "10", wis: "8", cha: "8" },
        saves: ["wis", "dex"],
      }),
      null,
    );
    expect(r.ok).toBe(true);
    const sb = MonsterStatBlock.parse(r.ok ? r.value : null);
    expect(sb).toMatchObject({
      speed: 30,
      abilities: { dex: 14 },
      saveProficiencies: ["dex", "wis"],
    });
    const bare = formStatBlock(fields({ saves: ["dex"] }), null);
    const b = MonsterStatBlock.parse(bare.ok ? bare.value : null);
    expect("speed" in b || "abilities" in b || "saveProficiencies" in b).toBe(false);
  });

  test("FR-CBT-43 partial scores → error; Edit keeps source fields the form doesn't show", () => {
    expect(
      formStatBlock(fields({ abilities: { ...fields().abilities, str: "10" } }), null),
    ).toEqual({
      ok: false,
      message: "Ability scores: fill all six or none",
    });
    const r = formStatBlock(fields({ speed: "" }), { speed: 40, legendary: 3, ac: 12 });
    expect(r.ok && r.value).toMatchObject({ legendary: 3, ac: 17 });
    expect(r.ok && "speed" in (r.value as object)).toBe(false);
  });
});

describe("FR-CBT-57 popup natural", () => {
  test("FR-CBT-57 popup natural: contradiction note on Hit at nat 1 and Miss at nat 20 only", () => {
    expect(naturalContradiction(1, true)).toEqual({
      natural: 1,
      hint: "Players see: DM ruled hit",
    });
    expect(naturalContradiction(20, false)).toEqual({
      natural: 20,
      hint: "Players see: DM ruled miss",
    });
    // Agreeing with the natural roll, or any other roll: no note.
    expect(naturalContradiction(1, false)).toBeNull();
    expect(naturalContradiction(20, true)).toBeNull();
    expect(naturalContradiction(9, true)).toBeNull();
    expect(naturalContradiction(9, false)).toBeNull();
    expect(naturalContradiction(null, true)).toBeNull();
  });

  test("FR-CBT-57 popup natural: hit preset unchanged (nat 1 miss, nat 20 hit)", () => {
    expect(presetHit(1, 30, 15)).toBe(false);
    expect(presetHit(20, 5, 15)).toBe(true);
  });
});

describe("FR-CBT-72 popup", () => {
  const roll = { rollId: "r", dice: [], constant: 0, total: 5, manual: false };
  test("FR-CBT-72 card shape: full, to-hit-only, damage-only", () => {
    expect(cardShape({ toHit: roll, damage: roll })).toBe("full");
    expect(cardShape({ toHit: roll, damage: null })).toBe("toHit");
    expect(cardShape({ toHit: null, damage: roll })).toBe("damage");
  });

  test("FR-CBT-72 Apply enabled: to-hit-only + all Miss ✓, a Hit ✗ until a total; no rows / > 20 ✗", () => {
    expect(applyReady([false, false], null, false)).toBe(true);
    expect(applyReady([false, true], null, false)).toBe(false);
    expect(applyReady([false, true], 7, false)).toBe(true);
    expect(applyReady([], 7, false)).toBe(false);
    expect(applyReady([true], 7, true)).toBe(false);
  });

  test("FR-CBT-72 damage-only rows preset Hit whatever the AC; else the to-hit rule", () => {
    expect(rowPreset("damage", null, 0, 30)).toBe(true);
    expect(rowPreset("toHit", 12, 14, 15)).toBe(false);
    expect(rowPreset("full", 12, 16, 15)).toBe(true);
  });

  test("FR-CBT-72 attached damage fills the cell unless the DM typed a total", () => {
    expect(shownTotal(null, undefined)).toBe("");
    expect(shownTotal(null, 7)).toBe("7"); // the Damage attached while open
    expect(shownTotal("9", 7)).toBe("9"); // a typed total stays
    expect(totalOf("")).toBeNull();
    expect(totalOf("x")).toBeNull();
    expect(totalOf(" 12 ")).toBe(12);
  });
});

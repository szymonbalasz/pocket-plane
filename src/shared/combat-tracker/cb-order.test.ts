// Sprint 8 CB0 pure rules: the order with the DM's tie order (FR-CBT-162) and the A′ drop rule
// (FR-CBTX-65 / -66) the server and the DM client's number hint share.
import { describe, expect, test } from "bun:test";
import { compareOrder, type MoveRow, planMove, type RankInput, ranks } from "./rules";

const row = (id: string, o: Partial<RankInput> = {}): RankInput => ({
  id,
  seq: 0,
  kind: "monster",
  initiative: null,
  initBonus: 0,
  active: true,
  removed: false,
  hidden: false,
  ...o,
});
const order = (rows: RankInput[]) => [...rows].sort(compareOrder).map((r) => r.id);

describe("FR-CBT-162 order", () => {
  test("FR-CBT-162 order with tie order", () => {
    // number first
    expect(
      order([row("a", { initiative: 10, tieOrder: 1 }), row("b", { initiative: 12 })]),
    ).toEqual(["b", "a"]);
    // tieOrder inside a tie, before bonus, PC and seq
    expect(
      order([
        row("pc", { kind: "pc", initiative: 12, initBonus: 5, seq: 1, tieOrder: 2 }),
        row("m", { initiative: 12, initBonus: 0, seq: 2, tieOrder: 1 }),
      ]),
    ).toEqual(["m", "pc"]);
    // null after any number
    expect(
      order([
        row("new", { kind: "pc", initiative: 12, initBonus: 9, seq: 0 }),
        row("old", { initiative: 12, seq: 5, tieOrder: 3 }),
      ]),
    ).toEqual(["old", "new"]);
    // both null: today's rules (bonus, PC, seq)
    expect(
      order([
        row("m2", { initiative: 12, seq: 2 }),
        row("m1", { initiative: 12, seq: 1 }),
        row("pc", { kind: "pc", initiative: 12, seq: 3 }),
        row("fast", { initiative: 12, initBonus: 3, seq: 4 }),
      ]),
    ).toEqual(["fast", "pc", "m1", "m2"]);
    // no initiative last, whatever its tieOrder
    expect(order([row("x", { tieOrder: 1 }), row("y", { initiative: -5 })])).toEqual(["y", "x"]);
  });

  test("FR-CBT-162 companions follow the owner", () => {
    const rows = [
      row("wolf", { initiative: 12, seq: 1, tieOrder: 2 }),
      row("mira", { kind: "pc", entityId: "c-mira", initiative: 12, seq: 2, tieOrder: 1 }),
      row("owl", { seq: 3, ownerCharacterId: "c-mira", turnMode: "after-owner" }),
      row("line", { seq: 4, ownerCharacterId: "c-mira", turnMode: "in-owner-turn" }),
      row("fe3", { initiative: 12, seq: 5, ownerCharacterId: "c-mira", turnMode: "own" }),
    ];
    const r = ranks(rows);
    // Mira dragged above Wolf: her after-owner row follows, the in-turn line has no rank,
    // the `own` companion sorts alone (tieOrder null → after the arranged rows).
    expect(r.get("mira")?.position).toBe(1);
    expect(r.get("owl")?.position).toBe(2);
    expect(r.get("line")?.position).toBeNull();
    expect(r.get("wolf")?.position).toBe(3);
    expect(r.get("fe3")?.position).toBe(4);
  });
});

// cb-ties order after `session-sim-11`: Wolf 18 (hidden), Brakka 17, Mira 15, Goblin 12 (fog-hidden),
// Thorn 12, Fire Elemental 3 12, Elite 8 (hidden).
const m = (
  id: string,
  initiative: number | null,
  kind: "pc" | "monster" = "monster",
  hidden = false,
) => ({ id, kind, hidden, initiative }) satisfies MoveRow;
const sim = (): MoveRow[] => [
  m("wolf", 18, "monster", true),
  m("brakka", 17, "pc"),
  m("mira", 15, "pc"),
  m("goblin", 12, "monster", true),
  m("thorn", 12, "pc"),
  m("fe3", 12),
  m("elite", 8, "monster", true),
];
const plan = (rows: MoveRow[], id: string, after: string | null) => {
  const r = planMove(rows, id, after);
  if (!r.ok || !r.plan) throw new Error(`no plan: ${JSON.stringify(r)}`);
  return r.plan;
};

describe("FR-CBTX-65 pure rule", () => {
  test("FR-CBTX-65 numbers after a drop (pure rule shared with the hint)", () => {
    // (a) a private row takes the anchor's number
    let p = plan(sim(), "goblin", "wolf");
    expect([...p.numbers]).toEqual([["goblin", 18]]);
    expect(p.order.slice(0, 2)).toEqual(["wolf", "goblin"]);
    // (a) top: the first other numbered row's
    p = plan(sim(), "elite", null);
    expect([...p.numbers]).toEqual([["elite", 18]]);
    expect(p.tieValue).toBe(18);
    // (b) inside the 12-tie: unchanged number
    p = plan(sim(), "thorn", "mira");
    expect(p.numbers.size).toBe(0);
    expect(p.tieValue).toBe(12);
    // (b) Brakka 17 below Thorn 12 → 12
    p = plan(sim(), "brakka", "thorn");
    expect([...p.numbers]).toEqual([["brakka", 12]]);
    // (b) Thorn to the top above Wolf 18 and Brakka 17 → 17, Wolf rewritten to 17
    p = plan(sim(), "thorn", null);
    expect(new Map(p.numbers)).toEqual(
      new Map([
        ["wolf", 17],
        ["thorn", 17],
      ]),
    );
    expect(p.order.slice(0, 3)).toEqual(["thorn", "wolf", "brakka"]);
  });

  test("FR-CBTX-64 move checks (pure)", () => {
    expect(planMove(sim(), "thorn", "goblin")).toEqual({ ok: true, plan: null });
    expect(planMove(sim(), "goblin", "mira")).toEqual({ ok: true, plan: null });
    const noNumbers = [m("a", null), m("b", null)];
    expect(planMove(noNumbers, "a", null)).toMatchObject({ ok: false, code: "conflict" });
    expect(planMove([...sim(), m("late", null)], "thorn", "late")).toMatchObject({
      ok: false,
      code: "invalid",
    });
  });

  test("FR-CBTX-65 hidden PC dropped under a monster keeps a PC number (pure)", () => {
    const rows = sim().map((r) => (r.id === "thorn" ? { ...r, hidden: true } : r));
    const p = plan(rows, "thorn", "wolf");
    expect(p.numbers.get("thorn")).toBe(17);
    expect(p.numbers.has("wolf")).toBe(false);
  });

  test("FR-CBTX-65 numbers never leak: PC dropped under the hidden Elite (pure)", () => {
    const rows = [m("elite", 18, "monster", true), ...sim().filter((r) => r.id !== "elite")];
    const p = plan(rows, "thorn", "elite");
    // nearest visible PC below is Brakka 17: Thorn 17, Wolf (private, 18 below him) → 17
    expect(p.numbers.get("thorn")).toBe(17);
    expect(p.numbers.get("wolf")).toBe(17);
    expect(p.numbers.has("elite")).toBe(false);
  });
});

// Sprint 11 F3 (BL-110): the DM's skip cue names down companions. `after-owner` ones have a rank
// and were already named (sim-14 replay: "Skipped Goblin 2 (down)"); a down `in-owner-turn`
// companion has none and is named as its owner's turn starts, Next or Prev, round 0 → 1 too.
import { describe, expect, test } from "bun:test";
import { skippedOnStep } from "@shared/combat-tracker/rules";
import type { CombatantView } from "@shared/combat-tracker/schemas";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { skipText, stepSkip } from "./skip";

const store: RecordStore = emptyStore();
let seq = 0;
const row = (name: string, position: number | null, o: Partial<CombatantView> = {}) =>
  ({
    id: name,
    name,
    seq: seq++,
    kind: "monster",
    entityId: `e-${name}`,
    encounterId: "enc",
    active: true,
    removed: false,
    hidden: false,
    position,
    initiative: 10,
    hpCurrent: 7,
    turnMode: null,
    ownerCharacterId: null,
    ...o,
  }) as CombatantView;
const pc = (name: string, position: number) =>
  row(name, position, { kind: "pc", entityId: `char-${name}`, hpCurrent: null });
// Wolf, Brakka (line: Drake), Mira, Goblin 2 (after Mira), Owlbear (after Mira), Goblin.
const rows = (o: { drake?: number; g2?: number; goblin?: number } = {}) => [
  row("Wolf", 1),
  pc("Brakka", 2),
  row("Drake", null, {
    turnMode: "in-owner-turn",
    ownerCharacterId: "char-Brakka",
    hpCurrent: o.drake ?? 22,
  }),
  pc("Mira", 3),
  row("Goblin 2", 4, {
    turnMode: "after-owner",
    ownerCharacterId: "char-Mira",
    hpCurrent: o.g2 ?? 4,
  }),
  row("Owlbear", 5, { turnMode: "after-owner", ownerCharacterId: "char-Mira" }),
  row("Goblin", 6, { hpCurrent: o.goblin ?? 7 }),
];
const at = (turn: string, round = 1) => ({ round, turnCombatantId: turn });
const text = (r: ReturnType<typeof stepSkip>) => (r.skipped ? skipText(r.skipped, r.dead) : null);

describe("FR-CBT-50 BL-110 down companions in the skip cue", () => {
  test("FR-CBT-50 BL-110 after-owner Goblin 2 at 0: Next from Mira names it (as built)", () => {
    expect(text(stepSkip(store, rows({ g2: 0 }), at("Mira"), "next"))).toBe(
      "Skipped Goblin 2 (down)",
    );
  });

  test("FR-CBT-50 BL-110 in-owner-turn Drake at 0: Next onto Brakka names it; Next from Brakka doesn't", () => {
    const r = rows({ drake: 0 });
    expect(text(stepSkip(store, r, at("Wolf"), "next"))).toBe("Skipped Drake (down)");
    expect(stepSkip(store, r, at("Brakka"), "next").skipped).toBeNull();
    // Prev back onto Brakka: her turn again, the drake still can't act.
    expect(text(stepSkip(store, r, at("Mira"), "prev"))).toBe("Skipped Drake (down)");
    // Round 0 → 1 starts on the Wolf: nothing; up → nothing.
    expect(stepSkip(store, r, { round: 0, turnCombatantId: null }, "next").skipped).toBeNull();
    expect(stepSkip(store, rows(), at("Wolf"), "next").skipped).toBeNull();
  });

  test("FR-CBT-50 BL-110 passed-over rows first, then the target's line; the round still shows", () => {
    const r = rows({ drake: 0, goblin: 0 });
    // Goblin → wraps to round 2: passes nobody down before the Wolf; Wolf → Brakka: the drake.
    expect(text(stepSkip(store, r, at("Owlbear"), "next"))).toBe("Skipped Goblin (down) · Round 2");
    const g = rows({ drake: 0, g2: 0 }).map((c) =>
      c.name === "Wolf" ? { ...c, hpCurrent: 0 } : c,
    );
    expect(text(stepSkip(store, g, at("Goblin"), "next"))).toBe(
      "Skipped Wolf, Drake (down) · Round 2",
    );
  });

  test("FR-CBT-50 BL-110 a removed or inactive in-turn companion is not named", () => {
    const removed = rows({ drake: 0 }).map((c) =>
      c.name === "Drake" ? { ...c, removed: true } : c,
    );
    expect(stepSkip(store, removed, at("Wolf"), "next").skipped).toBeNull();
    const gone = rows({ drake: 0 }).map((c) => (c.name === "Drake" ? { ...c, active: false } : c));
    expect(stepSkip(store, gone, at("Wolf"), "next").skipped).toBeNull();
  });

  test("FR-CBT-50 skippedOnStep without inTurnOf is unchanged (server-free default)", () => {
    const turnRows = rows({ drake: 0 })
      .filter((c) => c.position != null)
      .map((c) => ({
        id: c.id,
        name: c.name,
        position: c.position ?? 0,
        kind: c.kind,
        removed: false,
        hpCurrent: c.hpCurrent ?? null,
        initiative: 10,
      }));
    expect(skippedOnStep(turnRows, 1, "Wolf", "next")).toBeNull();
  });
});

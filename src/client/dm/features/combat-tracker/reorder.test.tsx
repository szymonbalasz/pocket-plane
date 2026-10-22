// Sprint 8 CB1 (CBTX §13.1 unit rows): the DM Initiative's drag reorder (FR-CBTX-62), Move up /
// down (FR-CBTX-63) and the crossing hint (FR-CBT-165), over the companions fight
// (`companions-fixture.tsx`: Worg 18, Brakka 17 + two in-turn lines, Mira 15 + the after-owner
// Owlbear, Goblin 12, Thorn 10, Fire Elemental 3 9 (`own`)). No DOM here: the geometry is the pure
// `nearestSlot` / `autoscrollStep`, the grips a static render.
import { describe, expect, test } from "bun:test";
import type { CombatantView } from "@shared/combat-tracker/schemas";
import { companionLayout } from "@ui/features/combat-tracker/companions";
import {
  companionStore,
  DM_ROWS,
  renderWith,
} from "@ui/features/combat-tracker/companions-fixture";
import { dmInitiativeWindow } from "./initiative-window";
import {
  AUTOSCROLL_EDGE,
  AUTOSCROLL_MAX,
  autoscrollStep,
  blocksOf,
  crossingHint,
  DRAG_THRESHOLD,
  dropHint,
  dropSlots,
  nearestSlot,
  noInitiative,
  planOf,
  stepAnchor,
} from "./reorder";
import { Grip, type Reorder, ReorderContext } from "./reorder-drag";

const ROWS = DM_ROWS as unknown as CombatantView[];
const listedOf = (rows: CombatantView[]) => companionLayout(rows, "position").map((l) => l.c);
const blocks = (rows: CombatantView[] = ROWS) => blocksOf(listedOf(rows), rows);
const with_ = (patch: Record<string, Record<string, unknown>>) =>
  ROWS.map((r) => (patch[r.id] ? ({ ...r, ...patch[r.id] } as CombatantView) : r));
const Body = dmInitiativeWindow.component;
const dmHtml = (store = companionStore("dm")) =>
  renderWith(store, <Body kind="cbt.initiative" instance="" />);
const grips = (html: string) =>
  [...html.matchAll(/data-testid="cbtx-init-row-grip" data-record-id="([^"]+)"/g)].map((m) => m[1]);

describe("FR-CBTX-62 drag and drop", () => {
  test("FR-CBTX-62 drag and drop: blocks are a row and the rows riding it; lines stay inside", () => {
    const b = blocks();
    expect(b.map((x) => x.rows.map((r) => r.id))).toEqual([
      ["wolf"],
      ["brakka"],
      ["mira", "owlbear"],
      ["goblin"],
      ["thorn"],
      ["fe3"],
    ]);
    expect(b.every((x) => x.movable)).toBe(true);
  });

  test("FR-CBTX-62 drag and drop: the drop line sits between blocks only, never at the start spot or below the last numbered row", () => {
    // Goblin (block 3): its own boundaries (3, 4) are the start spot.
    expect(dropSlots(blocks(), "goblin").map((s) => [s.index, s.afterId])).toEqual([
      [0, null],
      [1, "wolf"],
      [2, "brakka"],
      [5, "thorn"],
      [6, "fe3"],
    ]);
    // Never inside Mira's block (between Mira and the Owlbear): no spot names the Owlbear.
    expect(dropSlots(blocks(), "wolf").some((s) => s.afterId === "owlbear")).toBe(false);
    // Thorn and Fire Elemental 3 without a number: nothing below Goblin, the last numbered row.
    const unrolled = blocks(with_({ thorn: { initiative: null }, fe3: { initiative: null } }));
    expect(dropSlots(unrolled, "wolf").map((s) => s.afterId)).toEqual(["brakka", "mira", "goblin"]);
  });

  test("FR-CBTX-62 drag and drop: 4 px threshold, the nearest spot follows the pointer, near the start → nothing sent", () => {
    expect(DRAG_THRESHOLD).toBe(4);
    const b = blocks();
    const slots = dropSlots(b, "goblin");
    // Boundaries every 30 px: before block i at 30 i.
    const at = (i: number) => i * 30;
    expect(nearestSlot(slots, at, 3, 100)).toBeNull(); // between its own boundaries 90 / 120
    expect(nearestSlot(slots, at, 3, 2)?.afterId).toBeNull(); // top
    expect(nearestSlot(slots, at, 3, 31)?.afterId).toBe("wolf");
    expect(nearestSlot(slots, at, 3, 170)?.afterId).toBe("fe3");
  });

  test("FR-CBTX-62 drag and drop: number hint '→ 18' and rewritten rows listed; none inside a tie", () => {
    const b = blocks();
    // (a) Goblin 12 dropped after the Worg → 18.
    const s = dropSlots(b, "goblin").find((x) => x.afterId === "wolf");
    expect(s && dropHint(b, s, "goblin")).toEqual({ number: 18, others: [] });
    // (b) Thorn 10 to the top: no public row above, Brakka 17 below → 17; the Worg rewritten.
    const top = dropSlots(b, "thorn").find((x) => x.afterId === null);
    expect(top && dropHint(b, top, "thorn")).toEqual({ number: 17, others: ["Worg → 17"] });
    // Inside a tie (Goblin 12, Thorn 12): Thorn above Goblin keeps its number, no "→".
    const tie = blocks(with_({ thorn: { initiative: 12 } }));
    const inTie = dropSlots(tie, "thorn").find((x) => x.afterId === "mira");
    expect(inTie && dropHint(tie, inTie, "thorn")).toEqual({ number: null, others: [] });
  });

  test("FR-CBTX-62 drag and drop: autoscroll within 24 px of the list's top or bottom edge", () => {
    expect(AUTOSCROLL_EDGE).toBe(24);
    expect(autoscrollStep(110, 100, 400)).toBeLessThan(0);
    expect(autoscrollStep(250, 100, 400)).toBe(0);
    expect(autoscrollStep(124, 100, 400)).toBe(0);
    expect(autoscrollStep(376, 100, 400)).toBe(0);
    expect(autoscrollStep(390, 100, 400)).toBeGreaterThan(0);
  });

  test("FR-CBTX-62 drag and drop: autoscroll is gradual and the same at both edges (walkthrough CB4 / CB8)", () => {
    const up = (d: number) => -autoscrollStep(100 + d, 100, 400);
    const down = (d: number) => autoscrollStep(400 - d, 100, 400);
    let last = Number.POSITIVE_INFINITY;
    for (let d = 0; d < AUTOSCROLL_EDGE; d++) {
      // Symmetric, a few px a frame, faster closer to the edge.
      expect(down(d)).toBe(up(d));
      expect(down(d)).toBeGreaterThanOrEqual(1);
      expect(down(d)).toBeLessThanOrEqual(AUTOSCROLL_MAX);
      expect(down(d)).toBeLessThanOrEqual(last);
      last = down(d);
    }
    expect(AUTOSCROLL_MAX).toBeLessThanOrEqual(4);
    expect(down(23)).toBe(1);
    expect(down(0)).toBe(AUTOSCROLL_MAX);
    // Past the edge (over the footer or the header): the edge's speed, never a jump.
    expect(down(-80)).toBe(AUTOSCROLL_MAX);
    expect(up(-80)).toBe(AUTOSCROLL_MAX);
    // 120 px of rows past the bottom take dozens of frames, not one.
    let frames = 0;
    for (let scrolled = 0; scrolled < 120; frames++) scrolled += down(12);
    expect(frames).toBeGreaterThanOrEqual(30);
  });

  test("FR-CBTX-62 drag and drop: a grip on every movable row (hidden too), none on attached companions, never a tab stop", () => {
    const html = dmHtml();
    expect(grips(html)).toEqual(["wolf", "brakka", "mira", "goblin", "thorn", "fe3"]);
    expect(html).not.toMatch(/cbtx-init-row-grip" data-record-id="(owlbear|drake|fe2|wolfpet)"/);
    for (const g of html.matchAll(/<button[^>]*data-testid="cbtx-init-row-grip"[^>]*>/g)) {
      expect(g[0]).toContain('tabindex="-1"');
      expect(g[0]).not.toContain('disabled=""');
    }
    // A hidden row keeps its grip (the DM drags it; players get nothing, FR-CBTX-67).
    expect(blocks(with_({ goblin: { hidden: true } }))[3]?.movable).toBe(true);
  });

  test("FR-CBTX-62 drag and drop: grips disabled while a move is in flight or not live, and with no initiative ('Roll initiative first')", () => {
    const c = ROWS.find((r) => r.id === "goblin") as CombatantView;
    const b = blocks();
    const ctx = (o: Partial<Reorder>): Reorder => ({
      blocks: b,
      drag: null,
      held: null,
      disabled: false,
      unranked: false,
      movable: () => true,
      start: () => {},
      step: () => null,
      ...o,
    });
    const grip = (o: Partial<Reorder>) =>
      renderWith(
        companionStore("dm"),
        <ReorderContext.Provider value={ctx(o)}>
          <Grip c={c} />
        </ReorderContext.Provider>,
      );
    expect(grip({})).not.toContain('disabled=""');
    expect(grip({ disabled: true })).toContain('disabled=""');
    expect(grip({ unranked: true })).toContain('disabled=""');
    // Walkthrough fix: the pressed grip's tooltip stays shut ("overlay open" on its trigger).
    expect(grip({})).not.toContain('data-overlay-open="true"');
    expect(grip({ held: "goblin" })).toContain('data-overlay-open="true"');
    expect(grip({ held: "thorn" })).not.toContain('data-overlay-open="true"');
    expect(
      noInitiative(blocks(ROWS.map((r) => ({ ...r, initiative: null }) as CombatantView))),
    ).toBe(true);
    expect(noInitiative(b)).toBe(false);
  });
});

describe("FR-CBTX-63 keyboard move", () => {
  test("FR-CBTX-63 keyboard move: up → the block two above (top when one above), down → the block below", () => {
    const b = blocks();
    expect(stepAnchor(b, "goblin", "up")).toEqual({ afterId: "brakka" });
    expect(stepAnchor(b, "goblin", "down")).toEqual({ afterId: "thorn" });
    expect(stepAnchor(b, "brakka", "up")).toEqual({ afterId: null });
    // Mira's block moves past the Owlbear's row as one: down → after Goblin.
    expect(stepAnchor(b, "mira", "down")).toEqual({ afterId: "goblin" });
  });

  test("FR-CBTX-63 keyboard move: disabled at the ends, on attached companions and below the last numbered row", () => {
    const b = blocks();
    expect(stepAnchor(b, "wolf", "up")).toBeNull();
    expect(stepAnchor(b, "fe3", "down")).toBeNull();
    expect(stepAnchor(b, "owlbear", "up")).toBeNull();
    expect(stepAnchor(b, "owlbear", "down")).toBeNull();
    expect(stepAnchor(b, "drake", "down")).toBeNull();
    const unrolled = blocks(with_({ fe3: { initiative: null } }));
    expect(stepAnchor(unrolled, "thorn", "down")).toBeNull();
  });

  test("FR-CBTX-63 keyboard move: no tab stop added (the grip is tabIndex -1)", () => {
    const html = dmHtml();
    const grip = html.match(/<button[^>]*data-testid="cbtx-init-row-grip"[^>]*>/g) ?? [];
    expect(grip.length).toBe(6);
    expect(grip.every((g) => g.includes('tabindex="-1"'))).toBe(true);
  });
});

describe("FR-CBT-165 crossing hint", () => {
  const b = blocks();
  const hint = (id: string, afterId: string | null, round = 1, turn: string | null = "mira") => {
    const plan = planOf(b, id, afterId);
    if (!plan) throw new Error("no plan");
    return crossingHint(b, plan, id, round, turn);
  };

  test("FR-CBT-165 crossing hint: three messages", () => {
    // Goblin (below Mira's turn) dropped above it: no turn this round.
    expect(hint("goblin", "wolf")).toBe("Goblin now acts before Mira: no turn for it this round");
    // Brakka (above) dropped below Mira's block: acts again.
    expect(hint("brakka", "goblin")).toBe("Brakka now acts after Mira: it acts again this round");
    // The turn row itself: its turn goes on; Next's row in the new order.
    expect(hint("mira", "goblin")).toBe("Mira's turn goes on; next: Owlbear");
    // The turn on an attached companion: its owner's block moves, the turn goes on.
    expect(hint("mira", null, 1, "owlbear")).toBe("Owlbear's turn goes on; next: Worg");
  });

  test("FR-CBT-165 crossing hint: none in round 0, none when nothing crossed", () => {
    expect(hint("goblin", "wolf", 0)).toBeNull();
    expect(hint("goblin", "wolf", 1, null)).toBeNull();
    // Thorn below Fire Elemental 3: both under Mira's turn.
    expect(hint("thorn", "fe3")).toBeNull();
    // Worg below Brakka: both above it.
    expect(hint("wolf", "brakka")).toBeNull();
  });

  test("FR-CBT-165 crossing hint: Next skips a dead PC / a monster at 0 in 'next'", () => {
    const plan = planOf(b, "goblin", "thorn");
    if (!plan) throw new Error("no plan");
    expect(crossingHint(b, plan, "goblin", 1, "goblin")).toBe(
      "Goblin's turn goes on; next: Fire Elemental 3",
    );
    // Fire Elemental 3 can't act: Next wraps to the Worg.
    const out = (c: CombatantView) => c.id === "fe3";
    expect(crossingHint(b, plan, "goblin", 1, "goblin", out)).toBe(
      "Goblin's turn goes on; next: Worg",
    );
  });
});

// TT1 macros in process (FR-DICEX-64–68): rights (players: own rows on own PCs or "Me"; the DM's
// rows read-only for players; DM any), lists and caps, order, no-op saves, the owner-change hook
// line (macros follow the PC), visibility per viewer, and a macro roll = a plain `dice.roll`.
import { describe, expect, test } from "bun:test";
import {
  MACROS_PER_CAMPAIGN,
  MACROS_PER_LIST,
  ROLL_MACRO_TYPE,
  type RollMacroRecord,
} from "@shared/dice-extras/macros";
import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import type { GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { eq } from "drizzle-orm";
import { gameLogEntry, rollMacro } from "../../db/schema";
import type { Actor } from "../../events/types";
import { scenesSetup } from "../scenes-map/testing";
import { deleteMacro, moveMacro, READ_ONLY, saveMacro } from "./macros";

function setup() {
  const t = scenesSetup();
  const p1 = t.player(t.h.p1);
  const p2 = t.player(t.h.p2);
  const save = (input: object, actor: Actor = t.h.dm) =>
    t.run<{ macroId: string }>(saveMacro.name, input, actor).macroId;
  const macro = (o: Partial<{ name: string; expression: string; creatureId: string | null }>) => ({
    name: o.name ?? "Sneak Attack",
    expression: o.expression ?? "3d6",
    category: "damage",
    creatureId: o.creatureId === undefined ? null : o.creatureId,
  });
  const rows = () =>
    t.s.db
      .select()
      .from(rollMacro)
      .all()
      .sort((a, b) => a.order - b.order);
  const row = (id: string) => rows().find((r) => r.id === id);
  const seen = (v: ReturnType<typeof t.h.viewer>) =>
    ((t.h.snapshot(v)[ROLL_MACRO_TYPE] ?? []) as RollMacroRecord[]).map((m) => m.name).sort();
  return { ...t, p1, p2, save, macro, rows, row, seen };
}

describe("TT1 macros (in process)", () => {
  test("FR-DICEX-66 macro rights: players own rows on own PCs / Me; DM's rows read-only for players; DM any", () => {
    const t = setup();
    // Player 1 on Mira and "Me"; canonical notation; createdBy = them.
    const sneak = t.save(t.macro({ creatureId: t.miraId, expression: "3D6 " }), t.p1);
    const luck = t.save(t.macro({ name: " Luck ", expression: "1d100" }), t.p1);
    expect(t.row(sneak)).toMatchObject({
      playerId: t.h.p1.id,
      creatureId: t.miraId,
      expression: "3d6",
      createdBy: t.h.p1.id,
      order: 0,
    });
    expect(t.row(luck)).toMatchObject({ name: "Luck", creatureId: null, playerId: t.h.p1.id });
    // Another player's PC → forbidden; a monster / unknown → not_found; dmOnly → forbidden.
    expect(t.err(() => t.save(t.macro({ creatureId: t.thornId }), t.p1)).code).toBe("forbidden");
    expect(t.err(() => t.save(t.macro({ creatureId: t.h.goblinId }), t.p1)).code).toBe("not_found");
    expect(t.err(() => t.save({ ...t.macro({}), dmOnly: true }, t.p1)).code).toBe("forbidden");
    // Player 2 can't see or touch Player 1's rows.
    expect(t.err(() => t.save({ ...t.macro({}), id: sneak }, t.p2)).code).toBe("not_found");
    expect(t.err(() => t.run(deleteMacro.name, { id: sneak }, t.p2)).code).toBe("not_found");
    // The DM's macro on Thorn: Player 2's by default, read-only to them.
    const insp = t.save(t.macro({ name: "Inspiration", expression: "1d8", creatureId: t.thornId }));
    expect(t.row(insp)).toMatchObject({ playerId: t.h.p2.id, createdBy: null });
    const ro = t.err(() => t.save({ ...t.macro({ name: "Mine now" }), id: insp }, t.p2));
    expect([ro.code, ro.message]).toEqual(["forbidden", READ_ONLY]);
    expect(t.err(() => t.run(deleteMacro.name, { id: insp }, t.p2)).code).toBe("forbidden");
    expect(t.err(() => t.run(moveMacro.name, { id: insp, index: 0 }, t.p2)).code).toBe("forbidden");
    // DM only on a PC → playerId null; on a monster → null; the DM edits a player's row.
    const hidden = t.save({ ...t.macro({ name: "Ambush", creatureId: t.miraId }), dmOnly: true });
    expect(t.row(hidden)?.playerId).toBeNull();
    t.save({ ...t.macro({ name: "Luck!", expression: "1d100" }), id: luck });
    expect(t.row(luck)).toMatchObject({ name: "Luck!", playerId: t.h.p1.id, createdBy: t.h.p1.id });
    t.run(deleteMacro.name, { id: sneak }, t.p1);
    expect(t.row(sneak)).toBeUndefined();
  });

  test("FR-DICEX-64 caps: ≤ 24 per list, ≤ 200 per campaign → conflict, nothing written", () => {
    const t = setup();
    for (let i = 0; i < MACROS_PER_LIST; i++) t.save(t.macro({ name: `M${i}` }), t.p1);
    const full = t.err(() => t.save(t.macro({ name: "One more" }), t.p1));
    expect(full.code).toBe("conflict");
    // Another list still fits; the campaign cap counts every row.
    t.save(t.macro({ name: "On Mira", creatureId: t.miraId }), t.p1);
    const now = t.rows().length;
    const values = Array.from({ length: MACROS_PER_CAMPAIGN - now }, (_, i) => ({
      id: `fill-${i}`,
      campaignId: t.h.campaignId,
      playerId: null,
      creatureId: `c-${Math.floor(i / 20)}`,
      name: `F${i}`,
      expression: "1d4",
      category: "other" as const,
      order: i % 20,
      createdBy: null,
      updatedAt: "2026-10-22T00:00:00.000Z",
    }));
    t.s.db.insert(rollMacro).values(values).run();
    const cap = t.err(() => t.save(t.macro({ name: "201st" })));
    expect([cap.code, t.rows().length]).toEqual(["conflict", MACROS_PER_CAMPAIGN]);
  });

  test("FR-DICEX-66 order and no-ops: move re-numbers the list; same values → no event", () => {
    const t = setup();
    const ids = ["A", "B", "C"].map((name) =>
      t.save(t.macro({ name, creatureId: t.miraId }), t.p1),
    );
    const before = t.events.length;
    t.save({ ...t.macro({ name: "B", creatureId: t.miraId }), id: ids[1] }, t.p1);
    t.run(moveMacro.name, { id: ids[0], index: 0 }, t.p1);
    expect(t.events.length).toBe(before);
    t.run(moveMacro.name, { id: ids[2], index: 0 }, t.p1);
    const order = () =>
      t
        .rows()
        .filter((r) => r.creatureId === t.miraId)
        .map((r) => r.name);
    expect(order()).toEqual(["C", "A", "B"]);
    expect(t.events.at(-1)?.event.type).toBe("MacroSaved");
    // Index past the end → last; delete closes the gap.
    t.run(moveMacro.name, { id: ids[2], index: 23 }, t.p1);
    expect(order()).toEqual(["A", "B", "C"]);
    t.run(deleteMacro.name, { id: ids[0] }, t.p1);
    expect(t.rows().map((r) => [r.name, r.order])).toEqual([
      ["B", 0],
      ["C", 1],
    ]);
    expect(t.events.at(-1)?.event.type).toBe("MacroDeleted");
  });

  test("FR-DICEX-67 macro visibility: DM all; a player only rows with playerId = them", () => {
    const t = setup();
    t.save(t.macro({ name: "Sneak Attack", creatureId: t.miraId }), t.p1);
    t.save(t.macro({ name: "Bless", expression: "1d4" }));
    t.save(t.macro({ name: "Inspiration", expression: "1d8", creatureId: t.thornId }));
    t.save({ ...t.macro({ name: "Ambush", creatureId: t.thornId }), dmOnly: true });
    expect(t.seen(t.h.viewer("dm"))).toEqual(["Ambush", "Bless", "Inspiration", "Sneak Attack"]);
    expect(t.seen(t.h.viewer("player", t.h.p1.id))).toEqual(["Sneak Attack"]);
    expect(t.seen(t.h.viewer("player", t.h.p2.id))).toEqual(["Inspiration"]);
  });

  test("FR-DICEX-65 macro follows the PC: an owner change moves its macros to the new owner", () => {
    const t = setup();
    const sneak = t.save(t.macro({ creatureId: t.miraId }), t.p1);
    const dmRow = t.save(t.macro({ name: "Guidance", expression: "1d4", creatureId: t.miraId }));
    const hidden = t.save({ ...t.macro({ name: "Secret", creatureId: t.miraId }), dmOnly: true });
    const general = t.save(t.macro({ name: "Luck", expression: "1d100" }), t.p1);
    t.run("char.edit", { creatureId: t.miraId, set: { ownerPlayerId: t.h.p2.id } });
    expect(t.row(sneak)).toMatchObject({ playerId: t.h.p2.id, createdBy: t.h.p2.id });
    expect(t.row(dmRow)).toMatchObject({ playerId: t.h.p2.id, createdBy: null });
    expect(t.row(hidden)?.playerId).toBeNull();
    expect(t.row(general)?.playerId).toBe(t.h.p1.id);
    // The changes ride on EntityUpdated: Player 1 gets deletes, Player 2 upserts.
    const e = t.events.at(-1)?.event;
    const moved = e?.changes.filter((c) => c.type === ROLL_MACRO_TYPE).map((c) => c.id);
    expect(moved?.sort()).toEqual([sneak, dmRow].sort());
    expect(t.seen(t.h.viewer("player", t.h.p1.id))).toEqual(["Luck"]);
    expect(t.seen(t.h.viewer("player", t.h.p2.id))).toEqual(["Guidance", "Sneak Attack"]);
    // The new owner may edit the row they now own; back to Player 1 → theirs again.
    t.save({ ...t.macro({ name: "Sneaky", creatureId: t.miraId }), id: sneak }, t.p2);
    t.run("char.edit", { creatureId: t.miraId, set: { ownerPlayerId: t.h.p1.id } });
    expect(t.row(sneak)).toMatchObject({ name: "Sneaky", playerId: t.h.p1.id });
  });

  test("FR-DICE-81 macro line: a macro roll is a plain dice.roll (label = name, its category and actor)", () => {
    const t = setup();
    const id = t.save(t.macro({ creatureId: t.miraId }), t.p1);
    const m = t.row(id) as RollMacroRecord;
    const r = t.run<{ entryId: string }>(
      "dice.roll",
      {
        expression: m.expression,
        category: m.category,
        label: m.name,
        actor: { entityId: m.creatureId },
        manual: { diceTotal: 12, dice: [3, 4, 5] },
      },
      t.p1,
    );
    const e = t.s.db
      .select()
      .from(gameLogEntry)
      .where(eq(gameLogEntry.id, r.entryId))
      .get() as GameLogEntryRecord;
    expect(e).toMatchObject({
      kind: ROLL_KIND,
      category: "damage",
      actorName: "Mira",
      public: true,
    });
    expect(e.payload).toEqual([
      expect.objectContaining({ label: "Sneak Attack", expression: "3d6", total: 12 }),
    ]);
    expect(JSON.stringify(e.payload)).not.toContain("macro");
  });
});

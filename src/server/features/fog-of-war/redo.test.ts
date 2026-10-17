// FOG §13 sprint-4 integration rows (V6): brush shapes in `fog.edit` (FR-FOG-26) and the server
// redo stack (FR-FOG-07 depth 50, FR-FOG-56): stroke / cells edits (rows, undo entry, one event),
// undo restores the pre-stroke list and joins the redo list, redo re-applies, a new edit clears
// redo, `expectedEditId` races, depth 50, persisted across a restart. `vision` bundle, Goblin
// Ambush active.
import { afterEach, describe, expect, test } from "bun:test";
import { type VisionServices, visionServices } from "@fixtures/units/fog-of-war/vision-harness";
import { FOG_INTENTS as F, FOG_UNDO_MAX, type FogRecord } from "@shared/fog-of-war/schemas";
import { CommandError } from "../../commands/errors";
import { readEventLog } from "../../events/log";
import { createTestServices } from "../../testing/services";
import { fogUndoStack } from "./commands";
import { readFogRecord } from "./rows";

const opened: VisionServices[] = [];
async function setup() {
  const t = await visionServices();
  opened.push(t);
  return t;
}
afterEach(() => {
  for (const t of opened.splice(0)) t.stop();
});

const STROKE = { stroke: [1, 14.5, 2.5, 16.5, 2.5, 18.5, 2.75] };
const CELLS = { cells: { box: [14, 1, 3, 2] as [number, number, number, number], runs: "6" } };

function fail(fn: () => unknown): CommandError {
  try {
    fn();
  } catch (e) {
    if (e instanceof CommandError) return e;
    throw e;
  }
  throw new Error("expected a CommandError");
}

describe("FR-FOG-56 redo and brush edits", () => {
  test("FR-FOG-26 stroke / cells edits: appended (op + shape), one undo entry and one FogEdited each; a cells shape in placeDarkness → invalid", async () => {
    const t = await setup();
    const fog = () => readFogRecord(t.db, t.ambushId) as FogRecord;
    const n = fog().shapes.length;
    const depth = fog().undo?.n ?? 0;
    const a = t.run<{ editId: string }>(F.edit, {
      sceneId: t.ambushId,
      op: "reveal",
      shape: STROKE,
    });
    expect(t.last()).toMatchObject({
      type: "FogEdited",
      payload: { editId: a.editId, kind: "reveal-shape", shape: STROKE },
    });
    const b = t.run<{ editId: string }>(F.edit, { sceneId: t.ambushId, op: "fog", shape: CELLS });
    expect(fog().shapes.slice(n)).toEqual([
      { op: "reveal", ...STROKE },
      { op: "fog", ...CELLS },
    ]);
    expect(fog().undo).toEqual({ n: depth + 2, editId: b.editId, kind: "fog-shape" });
    expect(fail(() => t.run(F.placeDarkness, { sceneId: t.ambushId, shape: CELLS })).code).toBe(
      "invalid",
    );
    expect(fail(() => t.run(F.placeDarkness, { sceneId: t.ambushId, shape: STROKE })).code).toBe(
      "invalid",
    );
  });

  test("FR-FOG-56 undo → redo list; redo re-applies (FogRedone, logged); a new edit clears redo; stale ids → conflict", async () => {
    const t = await setup();
    const fog = () => readFogRecord(t.db, t.ambushId) as FogRecord;
    const before = fog();
    const a = t.run<{ editId: string }>(F.edit, {
      sceneId: t.ambushId,
      op: "reveal",
      shape: STROKE,
    });
    const afterA = fog();
    const b = t.run<{ editId: string }>(F.edit, { sceneId: t.ambushId, op: "fog", shape: CELLS });
    const afterB = fog();
    t.run(F.undo, { sceneId: t.ambushId, expectedEditId: b.editId });
    t.run(F.undo, { sceneId: t.ambushId, expectedEditId: a.editId });
    expect(fog().shapes).toEqual(before.shapes);
    expect(fog().redo).toEqual({ n: 2, editId: a.editId, kind: "reveal-shape" });
    expect(fog().undo).toEqual(before.undo);
    // Redo guards: only the most recently undone entry.
    expect(fail(() => t.run(F.redo, { sceneId: t.ambushId, expectedEditId: b.editId })).code).toBe(
      "conflict",
    );
    const log = readEventLog(t.db).length;
    const r = t.run<{ editId: string }>(F.redo, { sceneId: t.ambushId, expectedEditId: a.editId });
    expect(r).toEqual({ editId: a.editId });
    expect(t.last()).toMatchObject({
      type: "FogRedone",
      payload: { sceneId: t.ambushId, editId: a.editId, kind: "reveal-shape" },
    });
    expect(
      readEventLog(t.db)
        .slice(log)
        .map((l) => l.type),
    ).toEqual(["FogRedone"]);
    expect(fog().shapes).toEqual(afterA.shapes);
    expect(fog().undo).toEqual(afterA.undo);
    expect(fog().redo).toEqual({ n: 1, editId: b.editId, kind: "fog-shape" });
    t.run(F.redo, { sceneId: t.ambushId, expectedEditId: b.editId });
    expect(fog().shapes).toEqual(afterB.shapes);
    expect(fog().redo).toBeUndefined();
    expect(fail(() => t.run(F.redo, { sceneId: t.ambushId, expectedEditId: b.editId })).code).toBe(
      "conflict",
    );
    // Undo, then a new edit: the redo list is cleared.
    t.run(F.undo, { sceneId: t.ambushId, expectedEditId: b.editId });
    expect(fog().redo?.editId).toBe(b.editId);
    t.run(F.setAll, { sceneId: t.ambushId, fogged: false });
    expect(fog().redo).toBeUndefined();
    expect(fogUndoStack(t.db, t.ambushId).some((e) => e.id === b.editId)).toBe(false);
    // A player → forbidden.
    expect(
      fail(() => t.run(F.redo, { sceneId: t.ambushId, expectedEditId: a.editId }, t.actor("p1")))
        .code,
    ).toBe("forbidden");
  });

  test("FR-FOG-07 depth 50: the 51st edit drops the oldest; undone entries persist across a restart and redo there", async () => {
    const t = await setup();
    const ids: string[] = [];
    for (let i = 0; i < FOG_UNDO_MAX + 1; i++) {
      ids.push(
        t.run<{ editId: string }>(F.edit, {
          sceneId: t.ambushId,
          op: i % 2 === 0 ? "reveal" : "fog",
          shape: { rect: [i % 20, 0, (i % 20) + 1, 1] },
        }).editId,
      );
      // Keep under the 100-shape cap: Reveal all every 40 edits (also an undo entry).
      if (i === 40)
        ids.push(
          t.run<{ editId: string }>(F.setAll, { sceneId: t.ambushId, fogged: false }).editId,
        );
    }
    const stack = fogUndoStack(t.db, t.ambushId);
    expect(stack).toHaveLength(FOG_UNDO_MAX);
    expect(stack.map((e) => e.id)).toEqual(ids.slice(-FOG_UNDO_MAX));
    const last = ids.at(-1) as string;
    t.run(F.undo, { sceneId: t.ambushId, expectedEditId: last });
    // A restart: new services on the same DB file read the same stack and redo.
    const s2 = createTestServices({ db: t.db });
    expect(readFogRecord(t.db, t.ambushId)?.redo?.editId).toBe(last);
    s2.commands.run(F.redo, { sceneId: t.ambushId, expectedEditId: last }, { actor: t.dmActor });
    expect(readFogRecord(t.db, t.ambushId)?.undo?.editId).toBe(last);
  });
});

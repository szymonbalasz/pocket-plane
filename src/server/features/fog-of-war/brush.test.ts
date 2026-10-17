// FOG §13 sprint-4 integration rows (V9): the server half of the brush. FR-FOG-57 merge (a
// `cells` stroke of the same op as a last `cells` shape joins it; another op, a stroke shape or a
// union over 128 × 128 appends; at the 100-shape cap a merge still goes through), undo takes back
// exactly that stroke and redo re-applies it; over real sockets a brush stroke reaches each player
// as one event with the `fog` upsert only (no undo / redo info, no geometry beyond the fog row),
// records revealed by it follow the visibility rules, before and after a reconnect.
// `vision` bundle, Goblin Ambush active.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  type VisionHarness,
  type VisionServices,
  visionHarness,
  visionServices,
} from "@fixtures/units/fog-of-war/vision-harness";
import { cellsOf, paintedCells } from "@shared/fog-of-war/brush";
import { FOG_INTENTS as F, FOG_TYPE, type FogRecord } from "@shared/fog-of-war/schemas";
import { FOG_SHAPES_MAX, type FogLayerShape } from "@shared/fog-of-war/shapes";
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

const row = (c0: number, c1: number, r: number) =>
  Array.from({ length: c1 - c0 + 1 }, (_, k) => [c0 + k, r] as [number, number]);
const cells = (list: [number, number][]) => ({
  cells: cellsOf(list) as NonNullable<ReturnType<typeof cellsOf>>,
});

describe("FR-FOG-57 brush merge", () => {
  test("FR-FOG-57 a cells stroke of the same op as the last cells shape merges into it; undo takes back exactly that stroke, redo re-applies it", async () => {
    const t = await setup();
    const fog = () => readFogRecord(t.db, t.ambushId) as FogRecord;
    const before = fog().shapes;
    const a = t.run<{ editId: string }>(F.edit, {
      sceneId: t.ambushId,
      op: "reveal",
      shape: cells(row(14, 16, 2)),
    });
    const afterA = fog().shapes;
    expect(afterA).toHaveLength(before.length + 1);
    const b = t.run<{ editId: string }>(F.edit, {
      sceneId: t.ambushId,
      op: "reveal",
      shape: cells(row(16, 18, 3)),
    });
    const afterB = fog().shapes;
    // One shape: the union.
    expect(afterB).toHaveLength(before.length + 1);
    const last = afterB.at(-1) as Extract<FogLayerShape, { cells: unknown }>;
    expect(last.op).toBe("reveal");
    expect(paintedCells(last.cells)).toEqual([...row(14, 16, 2), ...row(16, 18, 3)]);
    // Two undo steps (one per stroke).
    expect(fog().undo).toMatchObject({ editId: b.editId, kind: "reveal-shape" });
    t.run(F.undo, { sceneId: t.ambushId, expectedEditId: b.editId });
    expect(fog().shapes).toEqual(afterA);
    t.run(F.undo, { sceneId: t.ambushId, expectedEditId: a.editId });
    expect(fog().shapes).toEqual(before);
    t.run(F.redo, { sceneId: t.ambushId, expectedEditId: a.editId });
    expect(fog().shapes).toEqual(afterA);
    t.run(F.redo, { sceneId: t.ambushId, expectedEditId: b.editId });
    expect(fog().shapes).toEqual(afterB);
  });

  test("FR-FOG-57 append instead: another op, a free stroke last, a union over 128 × 128; the 100-shape cap still lets a merge through", async () => {
    const t = await setup();
    const fog = () => readFogRecord(t.db, t.ambushId) as FogRecord;
    const edit = (op: string, shape: object) => t.run(F.edit, { sceneId: t.ambushId, op, shape });
    t.run(F.setAll, { sceneId: t.ambushId, fogged: true });
    edit("reveal", cells(row(0, 2, 0)));
    edit("fog", cells(row(0, 2, 1))); // another op
    expect(fog().shapes).toHaveLength(2);
    edit("fog", { stroke: [1, 4, 4, 6, 4] });
    edit("fog", cells(row(0, 2, 2))); // the last shape is a stroke
    expect(fog().shapes).toHaveLength(4);
    edit("fog", cells(row(120, 127, 2))); // union 0–127: still within 128
    expect(fog().shapes).toHaveLength(4);
    edit("fog", cells(row(128, 129, 2))); // union 0–129: over 128 → append
    expect(fog().shapes).toHaveLength(5);
    expect(fog().shapes.map((s) => s.op)).toEqual(["reveal", "fog", "fog", "fog", "fog"]);
    // Fill to the cap with rects, then a cells shape (appends: 100), then a merge (stays 100).
    while (fog().shapes.length < FOG_SHAPES_MAX - 1) edit("reveal", { rect: [0, 0, 1, 1] });
    edit("explored", cells(row(3, 4, 5)));
    expect(fog().shapes).toHaveLength(FOG_SHAPES_MAX);
    edit("explored", cells(row(3, 4, 6)));
    expect(fog().shapes).toHaveLength(FOG_SHAPES_MAX);
    expect(() => edit("fog", cells(row(3, 4, 7)))).toThrow("Fog too detailed");
  });
});

describe("FR-FOG-55 brush strokes over the wire (player-1, player-2)", () => {
  let v: VisionHarness;
  beforeAll(async () => {
    v = await visionHarness();
  });
  afterAll(async () => {
    await v.stop();
  });

  test("FR-FOG-55 a stroke reaches each player as one event carrying only the fog upsert (no undo / redo, the row as fog shows it); merge, undo and redo converge; nothing leaks after a reconnect", async () => {
    const { dm, c, ambushId, ok } = v;
    const lurker = v.tokens()["Goblin Lurker"];
    expect(lurker).toMatchObject({ col: 17, row: 11 });
    // Neither player sees the Lurker (statically fogged, out of sight).
    expect(v.names(c.p1)).not.toContain("Goblin Lurker");
    expect(v.names(c.p2)).not.toContain("Goblin Lurker");
    const m = v.mark();
    // Stroke 1 next to the Lurker, stroke 2 over it (merged on the server).
    await ok(dm, F.edit, { sceneId: ambushId, op: "reveal", shape: cells(row(14, 16, 11)) });
    await ok(dm, F.edit, { sceneId: ambushId, op: "reveal", shape: cells(row(16, 18, 11)) });
    const want = (lurk: boolean) => ({
      p1: [
        ...v.names(c.p1).filter((n) => n !== "Goblin Lurker"),
        ...(lurk ? ["Goblin Lurker"] : []),
      ],
      p2: [
        ...v.names(c.p2).filter((n) => n !== "Goblin Lurker"),
        ...(lurk ? ["Goblin Lurker"] : []),
      ],
    });
    await v.expectSee(want(true), m);
    for (const w of ["p1", "p2"] as const) {
      const evs = v.events(c[w], m[w], "FogEdited");
      expect(evs).toHaveLength(2);
      for (const e of evs) {
        const fogs = e.changes.filter((ch) => ch.type === FOG_TYPE);
        expect(fogs).toHaveLength(1);
        const data = (fogs[0] as { data: Record<string, unknown> }).data;
        expect(Object.keys(data).sort()).toEqual(
          ["darkness", "explored", "fill", "box", "id", "runs", "shapes"].sort(),
        );
      }
      // No signal or other frame carried a stroke (the draft never leaves the DM client).
      expect(c[w].frames.slice(m[w]).filter((f) => f.type === "signal")).toEqual([]);
      const raw = JSON.stringify(c[w].frames.slice(m[w]));
      for (const key of ['"undo"', '"redo"', '"editId"']) expect(raw).not.toContain(key);
      // The player's shapes = the DM's (the merged stroke is one shape).
      expect((v.fogOf(c[w]) as FogRecord).shapes).toEqual((v.fogOf(dm) as FogRecord).shapes);
    }
    const dmFog = () => v.fogOf(dm) as FogRecord;
    // Undo the merged stroke, then the first: the Lurker goes with the second.
    const m2 = v.mark();
    await ok(dm, F.undo, { sceneId: ambushId, expectedEditId: dmFog().undo?.editId });
    await v.expectSee(want(false), m2);
    await ok(dm, F.undo, { sceneId: ambushId, expectedEditId: dmFog().undo?.editId });
    const m3 = v.mark();
    await ok(dm, F.redo, { sceneId: ambushId, expectedEditId: dmFog().redo?.editId });
    await ok(dm, F.redo, { sceneId: ambushId, expectedEditId: dmFog().redo?.editId });
    await v.expectSee(want(true), m3);
    for (const w of ["p1", "p2"] as const) {
      expect(v.events(c[w], m3[w], "FogRedone")).toHaveLength(2);
      expect(JSON.stringify(c[w].frames.slice(m3[w]))).not.toContain('"redo"');
    }
  });
});

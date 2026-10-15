// FR-SCN-15 undo (DM, client only): inverse per op, the `n` remap after a re-add ("door, open,
// erase, Undo, Undo"), a rejected inverse drops its entry, per scene, cap 50 — against a fake
// server with the structure commands' semantics (acks `{ns}` aligned / `{n}`, not_found).
import { describe, expect, test } from "bun:test";
import { segmentKey } from "@shared/scene-tools/geometry";
import {
  DOOR_CLOSED,
  type Door,
  type DoorState,
  type PlayerSceneStructureRecord,
  SCN_INTENTS as S,
  type SceneStructureRecord,
  type Segment,
  type Wall,
} from "@shared/scene-tools/schemas";
import { IntentRejected } from "../../sync/connection";
import { addDoorEdit, addWallsEdit, removeEdit, setDoorEdit } from "./structure-edits";
import { structureView } from "./structure-view";
import { popUndo, pushUndo, remapOf, remapStep, UNDO_MAX, type UndoEntry } from "./undo";
import { createUndoStore, recordUndo, undoLast } from "./undo-store";

/** One scene's structure with the server's rules (FR-SCN-07, -08, -09). */
function fakeServer(sceneId = "s1") {
  let rec: SceneStructureRecord = {
    id: sceneId,
    campaignId: "c",
    rev: 0,
    nextN: 1,
    walls: [],
    doors: [],
  };
  const sent: string[] = [];
  const keys = () =>
    new Map([...rec.walls, ...rec.doors].map((s) => [segmentKey([s[1], s[2], s[3], s[4]]), s[0]]));
  const bump = (patch: Partial<SceneStructureRecord>) => {
    rec = { ...rec, ...patch, rev: rec.rev + 1 };
  };
  const send = async (name: string, raw: unknown): Promise<unknown> => {
    const input = raw as Record<string, unknown>;
    sent.push(`${name} ${JSON.stringify({ ...input, sceneId: undefined })}`);
    if (name === S.addWalls) {
      const k = keys();
      const walls = [...rec.walls];
      let nextN = rec.nextN;
      const ns = (input.segments as Segment[]).map((seg) => {
        const known = k.get(segmentKey(seg));
        if (known !== undefined) return known;
        const n = nextN++;
        walls.push([n, ...seg] as Wall);
        k.set(segmentKey(seg), n);
        return n;
      });
      bump({ walls, nextN });
      return { ns };
    }
    if (name === S.addDoor) {
      const seg = input.segment as Segment;
      if (keys().has(segmentKey(seg)))
        throw new IntentRejected("conflict", "A wall or door is already there");
      const n = rec.nextN;
      bump({
        doors: [...rec.doors, [n, ...seg, (input.state as DoorState) ?? DOOR_CLOSED, 0] as Door],
        nextN: n + 1,
      });
      return { n };
    }
    if (name === S.setDoor) {
      const d = rec.doors.find((x) => x[0] === input.n);
      if (!d) throw new IntentRejected("not_found", "Door not found");
      bump({
        doors: rec.doors.map((x) =>
          x[0] === input.n ? ([...x.slice(0, 5), input.state, x[6]] as Door) : x,
        ),
      });
      return null;
    }
    if (name === S.removeSegments) {
      const ns = new Set(input.ns as number[]);
      const all = new Set([...rec.walls, ...rec.doors].map((s) => s[0]));
      for (const n of ns)
        if (!all.has(n)) throw new IntentRejected("not_found", "Wall or door not found");
      bump({
        walls: rec.walls.filter((w) => !ns.has(w[0])),
        doors: rec.doors.filter((d) => !ns.has(d[0])),
      });
      return null;
    }
    throw new Error(`unexpected ${name}`);
  };
  return { send, sent, view: () => structureView(rec), rec: () => rec };
}

const SEG: Segment = [8, 5, 8, 6];

describe("FR-SCN-15 undo", () => {
  test("FR-SCN-15 inverse per op: add → remove, remove → re-add (same coordinates, door state), setDoor → previous state", async () => {
    const f = fakeServer();
    const u = createUndoStore();
    await addWallsEdit(
      f.send,
      "s1",
      f.view(),
      [
        [0, 0, 1, 0],
        [1, 0, 1, 1],
      ],
      u,
    );
    await addDoorEdit(f.send, "s1", SEG, DOOR_CLOSED, u);
    await setDoorEdit(f.send, "s1", 3, 1, 2, u);
    await removeEdit(f.send, "s1", f.view(), [1, 3], u);
    expect(u.getState().stacks.s1?.map((e) => e.steps.map((s) => [s.name, s.input]))).toEqual([
      [[S.removeSegments, { sceneId: "s1", ns: [1, 2] }]],
      [[S.removeSegments, { sceneId: "s1", ns: [3] }]],
      [[S.setDoor, { sceneId: "s1", n: 3, state: 1 }]],
      [
        [S.addWalls, { sceneId: "s1", segments: [[0, 0, 1, 0]] }],
        [S.addDoor, { sceneId: "s1", segment: SEG, state: 2 }],
      ],
    ]);
    // Undo everything → empty again.
    const rejects: unknown[] = [];
    for (let i = 0; i < 4; i++)
      expect(await undoLast(f.send, "s1", (e) => rejects.push(e), u)).toBe("undone");
    expect(rejects).toEqual([]);
    expect(f.rec()).toMatchObject({ walls: [], doors: [] });
    expect(await undoLast(f.send, "s1", () => {}, u)).toBe("empty");
  });

  test("FR-SCN-15 remap: door, open, erase, Undo, Undo → the door comes back (new n), then closes again", async () => {
    const f = fakeServer();
    const u = createUndoStore();
    const n = await addDoorEdit(f.send, "s1", SEG, DOOR_CLOSED, u);
    await setDoorEdit(f.send, "s1", n, 1, 0, u);
    await removeEdit(f.send, "s1", f.view(), [n], u);
    expect(f.rec().doors).toEqual([]);
    expect(await undoLast(f.send, "s1", () => {}, u)).toBe("undone");
    // Re-added open, as n 2; the older entries now point at 2.
    expect(f.rec().doors).toEqual([[2, 8, 5, 8, 6, 0, 0]]);
    expect(u.getState().stacks.s1?.map((e) => e.steps[0]?.input)).toEqual([
      { sceneId: "s1", ns: [2] },
      { sceneId: "s1", n: 2, state: 1 },
    ]);
    expect(await undoLast(f.send, "s1", () => {}, u)).toBe("undone");
    expect(f.rec().doors).toEqual([[2, 8, 5, 8, 6, 1, 0]]);
    expect(await undoLast(f.send, "s1", () => {}, u)).toBe("undone");
    expect(f.rec().doors).toEqual([]);
  });

  test("FR-SCN-15 a polyline's undo removes only its new segments (an identical one already there stays)", async () => {
    const f = fakeServer();
    const u = createUndoStore();
    await addWallsEdit(f.send, "s1", f.view(), [[0, 0, 1, 0]], u);
    await addWallsEdit(
      f.send,
      "s1",
      f.view(),
      [
        [1, 0, 0, 0],
        [1, 0, 2, 0],
        [2, 0, 3, 0],
      ],
      u,
    );
    expect(u.getState().stacks.s1?.at(-1)?.steps[0]?.input).toEqual({ sceneId: "s1", ns: [2, 3] });
    await undoLast(f.send, "s1", () => {}, u);
    expect(f.rec().walls).toEqual([[1, 0, 0, 1, 0]]);
  });

  test("FR-SCN-15 a rejected inverse drops its entry and reports it; older entries stay", async () => {
    const f = fakeServer();
    const u = createUndoStore();
    await addWallsEdit(f.send, "s1", f.view(), [[0, 0, 1, 0]], u);
    await addWallsEdit(f.send, "s1", f.view(), [[0, 1, 1, 1]], u);
    // Another tab already removed wall 2.
    await f.send(S.removeSegments, { sceneId: "s1", ns: [2] });
    const rejects: unknown[] = [];
    expect(await undoLast(f.send, "s1", (e) => rejects.push(e), u)).toBe("rejected");
    expect((rejects[0] as IntentRejected).code).toBe("not_found");
    expect(u.getState().stacks.s1).toHaveLength(1);
    expect(u.getState().busy).toBe(false);
    expect(await undoLast(f.send, "s1", () => {}, u)).toBe("undone");
    expect(f.rec().walls).toEqual([]);
  });

  test("FR-SCN-15 per scene, cap 50 (oldest dropped); nothing recorded on a reject", async () => {
    const u = createUndoStore();
    const e = (sceneId: string, i: number): UndoEntry => ({
      sceneId,
      steps: [{ name: S.removeSegments, input: { sceneId, ns: [i] } }],
    });
    for (let i = 1; i <= UNDO_MAX + 5; i++) recordUndo(e("a", i), u);
    recordUndo(e("b", 1), u);
    const a = u.getState().stacks.a ?? [];
    expect(a).toHaveLength(UNDO_MAX);
    expect(a[0]?.steps[0]?.input).toEqual({ sceneId: "a", ns: [6] });
    expect(popUndo(u.getState().stacks, "b")?.entry).toEqual(e("b", 1));
    expect(popUndo(u.getState().stacks, "c")).toBeNull();
    const f = fakeServer();
    await expect(setDoorEdit(f.send, "a", 99, 1, 0, u)).rejects.toBeInstanceOf(IntentRejected);
    expect(u.getState().stacks.a).toHaveLength(UNDO_MAX);
    // pushUndo is pure.
    const s0 = {};
    expect(pushUndo(s0, e("a", 1))).not.toBe(s0);
    expect(s0).toEqual({});
  });

  test("FR-SCN-15 remap rewrites n, ns, propId and recreates refs; unrelated steps are untouched", () => {
    const step = {
      name: S.addDoor,
      input: { sceneId: "s1", segment: SEG, state: 0 },
      recreates: { ns: [4] },
    };
    const r = remapOf(step, { n: 9 });
    expect([...r.ns]).toEqual([[4, 9]]);
    expect(remapStep({ name: S.setDoor, input: { n: 4, state: 1 } }, r).input).toEqual({
      n: 9,
      state: 1,
    });
    expect(remapStep({ name: S.removeSegments, input: { ns: [3, 4] } }, r).input).toEqual({
      ns: [3, 9],
    });
    expect(remapStep(step, r).recreates).toEqual({ ns: [9] });
    const p = remapOf(
      { name: "scn.placeProp", input: {}, recreates: { propId: "a" } },
      { propId: "b" },
    );
    expect(remapStep({ name: "scn.deleteProp", input: { propId: "a" } }, p).input).toEqual({
      propId: "b",
    });
    expect(remapOf(step, "garbage").ns.size).toBe(0);
  });
});

describe("FR-SCN-14 structure view", () => {
  test("FR-SCN-14 player records draw doors open / closed only, no walls", () => {
    const p: PlayerSceneStructureRecord = {
      id: "s",
      doors: [
        [4, 8, 5, 8, 6, 1],
        [5, 8, 11, 8, 12, 0],
      ],
    };
    expect(structureView(p)).toEqual({
      walls: [],
      doors: [
        { n: 4, seg: [8, 5, 8, 6], state: 0 },
        { n: 5, seg: [8, 11, 8, 12], state: 1 },
      ],
      full: null,
    });
  });
});

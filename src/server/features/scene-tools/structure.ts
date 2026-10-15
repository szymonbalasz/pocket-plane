// Structure commands (SCN §9; FR-SCN-07, -08, -09, -33, -36): `scn.addWalls`, `scn.addDoor`,
// `scn.setDoor`, `scn.removeSegments`, DM only, any scene of the campaign. One structure row per
// scene, created lazily; edits go by `n` (never a whole-list replace) and bump `rev`. Each edit is
// one transaction: the row + one event-log entry → `StructureEdited` (one name for every op, so
// players can't tell a lock from a wall edit). A change that changes nothing writes nothing.
import { StructureEdited } from "@shared/events/scene-tools";
import { segmentKey, segmentOf, segmentProblem } from "@shared/scene-tools/geometry";
import {
  AddDoorInput,
  type AddDoorResult,
  AddWallsInput,
  type AddWallsResult,
  DOOR_CLOSED,
  type Door,
  RemoveSegmentsInput,
  SCENE_STRUCTURE_TYPE,
  SCN_INTENTS,
  type SceneStructureRecord,
  SEGMENTS_MAX,
  type Segment,
  SetDoorInput,
  type Wall,
} from "@shared/scene-tools/schemas";
import type { SceneRecord } from "@shared/scenes-map/schemas";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, invalid, notFound } from "../../commands/errors";
import { sceneStructure } from "../../db/schema";
import { campaignOf, getScene } from "../scenes-map/rows";
import { doorFogFlag } from "./copies";
import { readStructure } from "./rows";

export const SEGMENT_CAP_MESSAGE = `A scene holds at most ${SEGMENTS_MAX} walls and doors`;
export const SEGMENT_TAKEN_MESSAGE = "A wall or door is already there";

type Op = "addWalls" | "addDoor" | "removeSegments" | "setDoor";

interface Structure {
  scene: SceneRecord;
  before: SceneStructureRecord | null;
  walls: Wall[];
  doors: Door[];
  nextN: number;
}

/** The scene (in the actor's campaign, else `not_found`) and its structure; no row = empty. */
function load(env: CommandEnv, sceneId: string): Structure {
  const scene = getScene(env.tx, campaignOf(env.actor), sceneId);
  const before = readStructure(env.tx, scene.id);
  return {
    scene,
    before,
    walls: before ? [...before.walls] : [],
    doors: before ? [...before.doors] : [],
    nextN: before?.nextN ?? 1,
  };
}

/** FR-SCN-07: length > 0 and endpoints within the map's vertex range ± 1, else `invalid`. */
function checkSegment(scene: SceneRecord, seg: Segment, path: (string | number)[]): void {
  const problem = segmentProblem(seg, scene);
  if (problem === "length") {
    throw invalid("A wall or door needs two different points", [{ path, message: "Length 0" }]);
  }
  if (problem === "bounds") {
    throw invalid("Outside the map", [{ path, message: "Out of bounds" }]);
  }
}

/** Every segment's dedupe key → its `n` (walls and doors alike). */
function keysOf(st: Structure): Map<string, number> {
  const keys = new Map<string, number>();
  for (const s of [...st.walls, ...st.doors]) keys.set(segmentKey(segmentOf(s)), s[0]);
  return keys;
}

function checkCap(st: Structure): void {
  if (st.walls.length + st.doors.length > SEGMENTS_MAX) throw conflict(SEGMENT_CAP_MESSAGE);
}

/** Writes the row (`rev` + 1) and queues `StructureEdited` with the touched `n`s. */
function commit(env: CommandEnv, st: Structure, op: Op, ns: number[]): void {
  const { scene, before } = st;
  const values = {
    rev: (before?.rev ?? 0) + 1,
    nextN: st.nextN,
    walls: st.walls,
    doors: st.doors,
    updatedAt: env.ctx.clock.iso(),
  };
  env.tx
    .insert(sceneStructure)
    .values({ sceneId: scene.id, campaignId: scene.campaignId, ...values })
    .onConflictDoUpdate({ target: sceneStructure.sceneId, set: values })
    .run();
  env.emit({
    type: StructureEdited.type,
    campaignId: scene.campaignId,
    payload: { sceneId: scene.id, op, ns },
    changes: [
      {
        type: SCENE_STRUCTURE_TYPE,
        id: scene.id,
        before,
        after: readStructure(env.tx, scene.id),
      },
    ],
  });
}

/** FR-SCN-08: one polyline's segments (≤ 200); identical ones dedupe (FR-SCN-07). */
export const addWalls = defineCommand({
  name: SCN_INTENTS.addWalls,
  input: AddWallsInput,
  execute({ sceneId, segments }, env): AddWallsResult {
    const st = load(env, sceneId);
    for (const [i, seg] of segments.entries()) checkSegment(st.scene, seg, ["segments", i]);
    const keys = keysOf(st);
    const ns: number[] = [];
    const added: number[] = [];
    for (const seg of segments) {
      const key = segmentKey(seg);
      const known = keys.get(key);
      if (known !== undefined) {
        ns.push(known);
        continue;
      }
      const n = st.nextN++;
      st.walls.push([n, ...seg]);
      keys.set(key, n);
      ns.push(n);
      added.push(n);
    }
    if (added.length === 0) return { ns };
    checkCap(st);
    commit(env, st, "addWalls", added);
    return { ns };
  },
});

/** FR-SCN-08 / -36: one door (default closed); its fog flag `f` from `derive` before the write. */
export const addDoor = defineCommand({
  name: SCN_INTENTS.addDoor,
  input: AddDoorInput,
  execute({ sceneId, segment, state }, env): AddDoorResult {
    const st = load(env, sceneId);
    checkSegment(st.scene, segment, ["segment"]);
    if (keysOf(st).has(segmentKey(segment))) throw conflict(SEGMENT_TAKEN_MESSAGE);
    const n = st.nextN++;
    const f = doorFogFlag(env.tx, st.scene.id, segment);
    st.doors.push([n, ...segment, state ?? DOOR_CLOSED, f]);
    checkCap(st);
    commit(env, st, "addDoor", [n]);
    return { n };
  },
});

/** FR-SCN-09: open / closed / locked; `f` is kept. Same state → nothing. */
export const setDoor = defineCommand({
  name: SCN_INTENTS.setDoor,
  input: SetDoorInput,
  execute({ sceneId, n, state }, env): void {
    const st = load(env, sceneId);
    const i = st.doors.findIndex((d) => d[0] === n);
    const door = st.doors[i];
    if (!door) throw notFound("Door not found");
    if (door[5] === state) return;
    st.doors[i] = [door[0], door[1], door[2], door[3], door[4], state, door[6]];
    commit(env, st, "setDoor", [n]);
  },
});

/** FR-SCN-08 Erase: walls and doors by `n`; every `n` must exist, else `not_found`. */
export const removeSegments = defineCommand({
  name: SCN_INTENTS.removeSegments,
  input: RemoveSegmentsInput,
  execute({ sceneId, ns }, env): void {
    const st = load(env, sceneId);
    const gone = new Set(ns);
    const known = new Set([...st.walls, ...st.doors].map((s) => s[0]));
    for (const n of gone) if (!known.has(n)) throw notFound("Wall or door not found");
    st.walls = st.walls.filter((w) => !gone.has(w[0]));
    st.doors = st.doors.filter((d) => !gone.has(d[0]));
    commit(env, st, "removeSegments", [...gone]);
  },
});

// fog-of-war's lines in scenes-map's registries (ADR-0039 / ADR-0042, FR-FOG-24; protocol §35):
// - `visibility-hooks.ts` `derive`: a scene object's `{fogged, seenBy}` (FR-FOG-10, `derive.ts`)
//   against the scene's stored fog and every player's sight; no row → clear; a corrupt row →
//   fogged (fail closed, FR-FOG-04). `hides` = fog-hidden for the viewer (FR-FOG-11, pure: record
//   + viewer). `dragAudience`: the players who see the stored token and, on a position frame, the
//   token at the previewed cell (FR-FOG-15, cached polygons). `rederive`: a write's dependants
//   (FR-FOG-35): a vision source placed / moved / resized / hidden / revealed / re-owned /
//   duplicated / deleted re-derives its scene(s); a structure edit (FR-SCN-39) and a scene copy
//   (#216) re-derive that scene; any other token write needs only its own `derive`.
// The `rederive` body and the scene / player / definition lifecycle lines live in `lifecycle.ts`
// (they re-derive, so they import scenes-map's token hooks). Leaf module: it must not import
// scenes-map's commands or registries (they import it).

import type { FogRow } from "@shared/fog-of-war/mask";
import { type FogSubject, fogHidden } from "@shared/fog-of-war/visibility";
import { footprint } from "@shared/scenes-map/geometry";
import { eq } from "drizzle-orm";
import { sceneFog } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import type { SceneHookEnv, SceneRead, SceneVisibilityHook } from "../scenes-map/visibility-hooks";
import {
  cellCentres,
  loadSceneStatic,
  samplePoints,
  seesAny,
  seesInvisibleAny,
  subjectCopies,
} from "./derive";

/** The scene's stored mask row, or null (every cell clear, FR-FOG-01). */
export function readFogRow(read: SceneRead, sceneId: string): FogRow | null {
  const r = read.select().from(sceneFog).where(eq(sceneFog.sceneId, sceneId)).get();
  return r ? { fill: r.fill, box: [r.col0, r.row0, r.cols, r.rows], runs: r.runs } : null;
}

/** Players who see a token as stored: its `seenBy` (+ its owner, FR-FOG-34). */
function seersOf(t: { seenBy?: readonly string[] | null; ownerPlayerId: string | null }) {
  const out = [...(t.seenBy ?? [])];
  if (t.ownerPlayerId !== null && !out.includes(t.ownerPlayerId)) out.push(t.ownerPlayerId);
  return out;
}

type Rederive = (env: SceneHookEnv, change: RecordChange) => RecordChange[];

/** Bound by `lifecycle.ts` at load (it imports scenes-map's token hooks; this module can't). */
let rederiveLine: Rederive = () => [];

export function bindFogRederive(fn: Rederive) {
  rederiveLine = fn;
}

/** FR-FOG-10 / -11 / -15 / -35: the visibility line. */
export const fogVisibilityHook: SceneVisibilityHook = {
  name: "fog-of-war.fogged",
  derive(read, obj) {
    const st = loadSceneStatic(read, obj.sceneId);
    return st ? subjectCopies(st, obj) : {};
  },
  hides: (type, record, viewer) => fogHidden(type, record as FogSubject, viewer.playerId),
  /**
   * FR-FOG-15: the players who see the stored token; on a position frame, of those, the players
   * who would see it at the previewed cell (FR-FOG-34 on the cached polygons; an invisible token
   * through Sees-invisible polygons only, FR-FOG-46). Owned tokens: the party rule (FR-FOG-34).
   */
  dragAudience(read, token, at) {
    const seers = seersOf(token);
    if (at === null || token.ownerPlayerId !== null) return seers;
    const st = loadSceneStatic(read, token.sceneId);
    if (!st) return [];
    const n = footprint(token.size);
    const pts = samplePoints(st, cellCentres({ ...at, w: n, h: n }));
    return seers.filter((p) =>
      token.invisible === true ? seesInvisibleAny(st, p, pts) : seesAny(st, p, pts),
    );
  },
  rederive: (env, change) => rederiveLine(env, change),
};

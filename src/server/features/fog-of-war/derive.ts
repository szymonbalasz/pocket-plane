// FR-FOG-10 / -34 / -36 / -44 / -46 (ADR-0042): per-player server copies of fog subjects. A
// subject's sample points (token / prop / template: cell centres; door: FR-SCN-36's points) are
// tested against the scene's **static state** (base mask + fog shapes, FR-FOG-01) and darkness
// (FR-FOG-28) once per point, then per player against that player's sight polygons (`sight.ts`,
// FR-FOG-33): P sees a point iff P is not blind and the point is statically clear outside
// darkness, or inside one of P's polygons (FR-FOG-34). Owned tokens: the owner + every non-blind
// player (FR-FOG-34 / -36); an unowned invisible token: only through a Sees-invisible polygon
// (FR-FOG-46). A player with no source sees the static state only (sprint 2). FR-FOG-44: a
// darkness shape's `seenBy` = the players whose polygons meet its bounding box, or with a cell
// centre inside the box that is statically clear / explored or in their explored memory.
// FR-FOG-50 (sprint 4): while party vision is on, every player's sight (and blindness) is the
// party's (`partyVision`: every player's polygons; party-blind = every player with sources is
// blind), written into `seenBy` here, so visibility fns still read only record + viewer. Pure
// apart from the reads.
import { exploredMask } from "@shared/fog-of-war/explored";
import { type FogMask as Mask, maskOf } from "@shared/fog-of-war/mask";
import type { FogLayerShape } from "@shared/fog-of-war/shapes";
import { type Box, type DarknessRow, shapeBox } from "@shared/fog-of-war/shapes";
import {
  invisibleSeen,
  type PlayerVision,
  partyVision,
  pointInPolygon,
  pointVisible,
  prepareStaticLayer,
  type SamplePoint,
  type StaticLayer,
  samplePoint,
} from "@shared/fog-of-war/vision";
import { asc, eq, sql } from "drizzle-orm";
import { fogExplored, player, scene, sceneFog } from "../../db/schema";
import type { SceneCells, SceneObject, SceneRead } from "../scenes-map/visibility-hooks";
import { partyVisionOn } from "./settings";
import { type SightEntry, sceneSight, sceneSources } from "./sight";

/** What a re-derive reads once per scene (FR-FOG-35: static state once per point). */
export interface SceneStatic {
  sceneId: string;
  campaignId: string;
  mask: Mask;
  shapes: readonly FogLayerShape[];
  darkness: readonly DarknessRow[];
  /** Base mask + prepared shapes + darkness: static state once per point (FR-FOG-35). */
  layer: StaticLayer;
  /** The campaign's players, oldest first. */
  players: string[];
  /** Each player's sight (players with ≥ 1 source only; none = static only, FR-FOG-32). */
  sight?: ReadonlyMap<string, SightEntry>;
  /** FR-FOG-49: the campaign's party vision switch. */
  party?: boolean;
  /** FR-FOG-50: the party's sight while `party` (null: nobody has a source). */
  partySight?: PlayerVision | null;
}

/** The campaign's player ids, oldest first (the `player` snapshot order). */
export function campaignPlayers(read: SceneRead, campaignId: string): string[] {
  return read
    .select({ id: player.id })
    .from(player)
    .where(eq(player.campaignId, campaignId))
    .orderBy(asc(player.createdAt), asc(sql`rowid`))
    .all()
    .map((p) => p.id);
}

/**
 * The scene's fog state and every player's sight (FR-FOG-33, cached, FR-FOG-38). No row → every
 * point clear (FR-FOG-01); a corrupt row → fully fogged (fail closed, FR-FOG-04). Null when the
 * scene doesn't exist.
 */
export function loadSceneStatic(read: SceneRead, sceneId: string): SceneStatic | null {
  const s = read
    .select({ id: scene.id, campaignId: scene.campaignId })
    .from(scene)
    .where(eq(scene.id, sceneId))
    .get();
  if (!s) return null;
  const r = read.select().from(sceneFog).where(eq(sceneFog.sceneId, sceneId)).get();
  const mask = maskOf(
    r ? { fill: r.fill, box: [r.col0, r.row0, r.cols, r.rows], runs: r.runs } : null,
  ).mask;
  const players = campaignPlayers(read, s.campaignId);
  const darkness = r?.darkness ?? [];
  const party = partyVisionOn(read, s.campaignId);
  const sight = sceneSight(
    read,
    { sceneId: s.id, fogRev: r ? r.rev : -1, darkness, party },
    sceneSources(read, s.id, players, party),
  );
  return sceneStatic({
    sceneId: s.id,
    campaignId: s.campaignId,
    mask,
    shapes: r?.shapes ?? [],
    darkness,
    players,
    sight,
    party,
  });
}

/**
 * FR-FOG-39: every player's sight on a scene without its static layer (`vision` snapshot), and
 * the party switch (the records' `shared` flag, FR-FOG-51).
 */
export function loadSceneSight(
  read: SceneRead,
  sceneId: string,
): { campaignId: string; sight: Map<string, SightEntry>; party: boolean } | null {
  const s = read
    .select({ campaignId: scene.campaignId })
    .from(scene)
    .where(eq(scene.id, sceneId))
    .get();
  if (!s) return null;
  const r = read
    .select({ rev: sceneFog.rev, darkness: sceneFog.darkness })
    .from(sceneFog)
    .where(eq(sceneFog.sceneId, sceneId))
    .get();
  const players = campaignPlayers(read, s.campaignId);
  const party = partyVisionOn(read, s.campaignId);
  const sight = sceneSight(
    read,
    { sceneId, fogRev: r ? r.rev : -1, darkness: r?.darkness ?? [], party },
    sceneSources(read, sceneId, players, party),
  );
  return { campaignId: s.campaignId, sight, party };
}

/** A `SceneStatic` with its prepared layer (and the party's sight while party vision is on). */
export function sceneStatic(st: Omit<SceneStatic, "layer" | "partySight">): SceneStatic {
  const partySight =
    st.party === true ? partyVision([...(st.sight?.values() ?? [])].map((e) => e.vision)) : null;
  return { ...st, partySight, layer: prepareStaticLayer(st.mask, st.shapes, st.darkness) };
}

/** The centres of a footprint's cells (FR-FOG-34 sample points), row-major for a block. */
export function cellCentres(cells: SceneCells): [number, number][] {
  if (Array.isArray(cells)) {
    return (cells as readonly (readonly [number, number])[]).map(([c, r]) => [c + 0.5, r + 0.5]);
  }
  const b = cells as { col: number; row: number; w: number; h: number };
  const out: [number, number][] = [];
  for (let r = b.row; r < b.row + b.h; r++) {
    for (let c = b.col; c < b.col + b.w; c++) out.push([c + 0.5, r + 0.5]);
  }
  return out;
}

/** FR-FOG-34 (static part): the point is statically clear and not in darkness. */
export function pointStaticallyVisible(st: SceneStatic, x: number, y: number): boolean {
  const pt = samplePoint(st.layer, x, y);
  return pt.state === "clear" && !pt.dark;
}

/** Statically visible = some sample point is (FR-FOG-10: else statically hidden). */
export function staticallyVisible(st: SceneStatic, points: readonly (readonly [number, number])[]) {
  return points.some(([x, y]) => pointStaticallyVisible(st, x, y));
}

/** The copies of one subject (FR-FOG-10). */
export interface SubjectCopies {
  fogged: boolean;
  seenBy: string[];
}

/**
 * The sight P's copies are derived from, or null (no source: the static state only). FR-FOG-50:
 * while party vision is on, the party's sight for every player (with or without sources).
 */
export const visionOf = (st: SceneStatic, p: string): PlayerVision | null =>
  st.party === true ? (st.partySight ?? null) : (st.sight?.get(p)?.vision ?? null);

/**
 * FR-FOG-36: P has ≥ 1 source and all are in darkness without see-through; FR-FOG-50: while party
 * vision is on, party-blind instead.
 */
export const isBlind = (st: SceneStatic, p: string) => visionOf(st, p)?.blind === true;

/** FR-FOG-34: P sees one of the points (a player without sources: statically visible). */
export function seesAny(st: SceneStatic, p: string, pts: readonly SamplePoint[]): boolean {
  const v = visionOf(st, p);
  if (!v) return pts.some((pt) => pt.state === "clear" && !pt.dark);
  return pts.some((pt) => pointVisible(v, pt));
}

/** FR-FOG-46: P sees an unowned invisible subject through a Sees-invisible polygon. */
export function seesInvisibleAny(st: SceneStatic, p: string, pts: readonly SamplePoint[]) {
  const v = visionOf(st, p);
  return v !== null && pts.some((pt) => invisibleSeen(v, pt));
}

/** A subject's sample points with their static state (once per point, FR-FOG-35). */
export const samplePoints = (st: SceneStatic, points: readonly (readonly [number, number])[]) =>
  points.map(([x, y]) => samplePoint(st.layer, x, y));

/**
 * FR-FOG-10 / -34 / -36 / -46 for one subject on a scene. Owned token: the owner and every
 * non-blind player; `fogged` = statically hidden (sprint 2's value). Player-placed template: not
 * a fog subject, every player; `fogged` = statically hidden (DM wire only). Unowned invisible
 * token: the players whose Sees-invisible polygon holds a sample point; `fogged` = seen by nobody
 * (also with no players). Anything else: the players who see a sample point; `fogged` = seen by
 * nobody, or statically hidden while there are no players.
 */
export function subjectCopies(st: SceneStatic, obj: SceneObject): SubjectCopies {
  const pts = samplePoints(st, obj.points ?? cellCentres(obj.cells));
  const visible = pts.some((pt) => pt.state === "clear" && !pt.dark);
  if (obj.placedByPlayerId != null) return { fogged: !visible, seenBy: [...st.players] };
  if (obj.ownerPlayerId != null) {
    const owner = obj.ownerPlayerId;
    return { fogged: !visible, seenBy: st.players.filter((p) => p === owner || !isBlind(st, p)) };
  }
  if (obj.invisible === true) {
    const seenBy = st.players.filter((p) => seesInvisibleAny(st, p, pts));
    return { fogged: seenBy.length === 0, seenBy };
  }
  const seenBy = st.players.filter((p) => seesAny(st, p, pts));
  return { fogged: st.players.length > 0 ? seenBy.length === 0 : !visible, seenBy };
}

/** Same set of players (order-insensitive; null = pre-v2 never equals a list). */
export function sameSeenBy(a: readonly string[] | null | undefined, b: readonly string[]) {
  if (a == null || a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((p) => s.has(p));
}

/** Each player's explored memory on a scene (FR-FOG-37; cell 1 = explored). */
export function loadMemory(read: SceneRead, sceneId: string): Map<string, Mask> {
  const rows = read.select().from(fogExplored).where(eq(fogExplored.sceneId, sceneId)).all();
  return new Map(
    rows.map((r) => [
      r.playerId,
      exploredMask({ box: [r.col0, r.row0, r.cols, r.rows], runs: r.runs }),
    ]),
  );
}

const memoryHas = (m: Mask, col: number, row: number) => {
  const [col0, row0, cols, rows] = m.box;
  const c = col - col0;
  const r = row - row0;
  return c >= 0 && r >= 0 && c < cols && r < rows && m.cells[r * cols + c] === 1;
};

/** Does a flat polygon meet a box (boundary-inclusive)? A vertex in it, a corner in the polygon, or an edge across it. */
export function polygonMeetsBox(flat: readonly number[], [x0, y0, x1, y1]: Box): boolean {
  const n = flat.length >> 1;
  let px0 = Number.POSITIVE_INFINITY;
  let py0 = Number.POSITIVE_INFINITY;
  let px1 = Number.NEGATIVE_INFINITY;
  let py1 = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const x = flat[2 * i] as number;
    const y = flat[2 * i + 1] as number;
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return true;
    px0 = Math.min(px0, x);
    py0 = Math.min(py0, y);
    px1 = Math.max(px1, x);
    py1 = Math.max(py1, y);
  }
  if (px1 < x0 || px0 > x1 || py1 < y0 || py0 > y1) return false;
  const corners: [number, number][] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  if (corners.some(([x, y]) => pointInPolygon(flat, x, y))) return true;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a: [number, number] = [flat[2 * j] as number, flat[2 * j + 1] as number];
    const b: [number, number] = [flat[2 * i] as number, flat[2 * i + 1] as number];
    if (segmentMeetsBox(a, b, [x0, y0, x1, y1])) return true;
  }
  return false;
}

/** Liang–Barsky: does the segment touch the box? */
function segmentMeetsBox([ax, ay]: [number, number], [bx, by]: [number, number], box: Box) {
  const [x0, y0, x1, y1] = box;
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const sides: [number, number][] = [
    [-dx, ax - x0],
    [dx, x1 - ax],
    [-dy, ay - y0],
    [dy, y1 - ay],
  ];
  for (const [p, q] of sides) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * FR-FOG-44: the players who get a darkness shape = those whose sight polygons meet its bounding
 * box, or with a cell centre inside the box that is statically clear or explored (every player),
 * or explored in their own memory. Campaign player order.
 */
export function darknessSeenBy(
  st: SceneStatic,
  d: DarknessRow,
  memory: ReadonlyMap<string, Mask>,
): string[] {
  const box = shapeBox(d);
  const [x0, y0, x1, y1] = box;
  const c0 = Math.ceil(x0 - 0.5);
  const c1 = Math.floor(x1 - 0.5);
  const r0 = Math.ceil(y0 - 0.5);
  const r1 = Math.floor(y1 - 0.5);
  const seen = new Set<string>(
    st.players.filter((p) =>
      (visionOf(st, p)?.polys ?? []).some((poly) => polygonMeetsBox(poly.poly, box)),
    ),
  );
  const remembered = st.players.filter((p) => memory.has(p));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (samplePoint(st.layer, c + 0.5, r + 0.5).state !== "fog") return [...st.players];
      for (const p of remembered) {
        if (!seen.has(p) && memoryHas(memory.get(p) as Mask, c, r)) seen.add(p);
      }
    }
  }
  return st.players.filter((p) => seen.has(p));
}

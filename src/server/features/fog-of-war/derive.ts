// FR-FOG-10 / -34 / -40 (ADR-0042): per-player server copies of fog subjects. A subject's sample
// points (token / prop / template: cell centres; door: FR-SCN-36's points) are tested against the
// scene's **static state** (base mask + fog shapes, FR-FOG-01) and darkness (FR-FOG-28), once per
// point. V0 has no vision sources yet (no senses are set before V2's bundle), so a player sees a
// point iff it is statically clear and not in darkness, and `seenBy` is "every player or none"
// (owned tokens: every player, FR-FOG-34; an unowned invisible token: nobody, FR-FOG-46). V2 adds
// the sight polygons here. FR-FOG-44 (static part, V1): a darkness shape's `seenBy` = the players
// with a cell centre inside its bounding box that is statically clear / explored or in their
// explored memory. Pure apart from the reads.
import { exploredMask } from "@shared/fog-of-war/explored";
import { type FogMask as Mask, maskOf } from "@shared/fog-of-war/mask";
import type { FogLayerShape } from "@shared/fog-of-war/shapes";
import { type DarknessRow, shapeBox } from "@shared/fog-of-war/shapes";
import { prepareStaticLayer, type StaticLayer, samplePoint } from "@shared/fog-of-war/vision";
import { asc, eq, sql } from "drizzle-orm";
import { fogExplored, player, scene, sceneFog } from "../../db/schema";
import type { SceneCells, SceneObject, SceneRead } from "../scenes-map/visibility-hooks";

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
 * The scene's fog state. No row → every point clear (FR-FOG-01); a corrupt row → fully fogged
 * (fail closed, FR-FOG-04). Null when the scene doesn't exist.
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
  return sceneStatic({
    sceneId: s.id,
    campaignId: s.campaignId,
    mask,
    shapes: r?.shapes ?? [],
    darkness: r?.darkness ?? [],
    players: campaignPlayers(read, s.campaignId),
  });
}

/** A `SceneStatic` with its prepared layer. */
export function sceneStatic(st: Omit<SceneStatic, "layer">): SceneStatic {
  return { ...st, layer: prepareStaticLayer(st.mask, st.shapes, st.darkness) };
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
 * FR-FOG-10 / -34 / -46 for one subject on a scene. Owned token: every player sees it; `fogged`
 * = statically hidden (sprint 2's value). Unowned invisible token: nobody (no source sees
 * invisible in V0), `fogged`. Player-placed template: not a fog subject, every player sees it;
 * `fogged` = statically hidden (DM wire only). Anything else: every player iff statically
 * visible; `fogged` = seen by nobody, or statically hidden while there are no players.
 */
export function subjectCopies(st: SceneStatic, obj: SceneObject): SubjectCopies {
  const points = obj.points ?? cellCentres(obj.cells);
  const visible = staticallyVisible(st, points);
  if (obj.ownerPlayerId != null || obj.placedByPlayerId != null) {
    return { fogged: !visible, seenBy: [...st.players] };
  }
  if (obj.invisible === true) return { fogged: true, seenBy: [] };
  const seenBy = visible ? [...st.players] : [];
  // Players → seen by nobody; none → statically hidden. Static-only V0: both = `!visible`.
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

/**
 * FR-FOG-44 (static part): the players who get a darkness shape = those with a cell centre
 * inside its bounding box that is statically clear or explored (every player), or explored in
 * their own memory. Sight polygons join in V2. Campaign player order.
 */
export function darknessSeenBy(
  st: SceneStatic,
  d: DarknessRow,
  memory: ReadonlyMap<string, Mask>,
): string[] {
  const [x0, y0, x1, y1] = shapeBox(d);
  const c0 = Math.ceil(x0 - 0.5);
  const c1 = Math.floor(x1 - 0.5);
  const r0 = Math.ceil(y0 - 0.5);
  const r1 = Math.floor(y1 - 0.5);
  const seen = new Set<string>();
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

// FR-FOG-10 / -34 / -40 (ADR-0042): per-player server copies of fog subjects. A subject's sample
// points (token / prop / template: cell centres; door: FR-SCN-36's points) are tested against the
// scene's **static state** (base mask + fog shapes, FR-FOG-01) and darkness (FR-FOG-28), once per
// point. V0 has no vision sources yet (no senses are set before V2's bundle), so a player sees a
// point iff it is statically clear and not in darkness, and `seenBy` is "every player or none"
// (owned tokens: every player, FR-FOG-34; an unowned invisible token: nobody, FR-FOG-46). V2 adds
// the sight polygons here. Pure apart from the reads.
import { maskOf } from "@shared/fog-of-war/mask";
import type { FogLayerShape } from "@shared/fog-of-war/shapes";
import { type DarknessRow, inDarkness, staticState } from "@shared/fog-of-war/shapes";
import { asc, eq, sql } from "drizzle-orm";
import { player, scene, sceneFog } from "../../db/schema";
import type { SceneCells, SceneObject, SceneRead } from "../scenes-map/visibility-hooks";

type FogMask = ReturnType<typeof maskOf>["mask"];

/** What a re-derive reads once per scene (FR-FOG-35: static state once per point). */
export interface SceneStatic {
  sceneId: string;
  campaignId: string;
  mask: FogMask;
  shapes: readonly FogLayerShape[];
  darkness: readonly DarknessRow[];
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
  return {
    sceneId: s.id,
    campaignId: s.campaignId,
    mask,
    shapes: r?.shapes ?? [],
    darkness: r?.darkness ?? [],
    players: campaignPlayers(read, s.campaignId),
  };
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
  return staticState(st.mask, st.shapes, x, y) === "clear" && !inDarkness(st.darkness, x, y);
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

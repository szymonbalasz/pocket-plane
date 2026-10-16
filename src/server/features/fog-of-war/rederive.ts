// FR-FOG-08 / -10 / -13 / -35 (ADR-0042): the scene re-derive, in the writing command's
// transaction: every fog subject's copies (`fogged`, `seenBy`) against the scene's current fog
// (static state once per sample point), the doors' `f` / `doorSeen` in its `scene-structure` row
// (FR-SCN-36; `rev` + 1 only when an `f` flips). A token whose party-level hidden flips runs the
// token-changed hooks (combat copies, FR-FOG-13 / -14). Subject rows first, then hook rows.
// `updatedAt` moves only with a wire-visible field (`fogged`, `f`): a `seenBy`-only change is
// invisible on every wire and dropped from frames (FR-SYNC-19 as amended). V0: static only.
import {
  doorCells,
  doorSamplePoints,
  propCells,
  templateCells,
} from "@shared/scene-tools/geometry";
import {
  AOE_TEMPLATE_TYPE,
  type Door,
  SCENE_PROP_TYPE,
  SCENE_STRUCTURE_TYPE,
} from "@shared/scene-tools/schemas";
import { footprint } from "@shared/scenes-map/geometry";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { and, eq, ne } from "drizzle-orm";
import { aoeTemplate, prop, scene, sceneFog, sceneStructure, token } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import {
  readProp,
  readStructure,
  readTemplate,
  sceneProps,
  sceneTemplates,
} from "../scene-tools/rows";
import { readScene, readToken, sceneTokens } from "../scenes-map/rows";
import { runTokenChangedHooks } from "../scenes-map/token-hooks";
import { type SceneHookEnv, tokenHiddenForPlayers } from "../scenes-map/visibility-hooks";
import { loadSceneStatic, type SceneStatic, sameSeenBy, subjectCopies } from "./derive";

export interface RederiveOptions {
  /** Run token-changed hooks on party-level flips (default true). */
  hooks?: boolean;
  /** Boot backfill (FR-FOG-40): never touch `updatedAt` (the wire stays byte-equal). */
  migration?: boolean;
}

function rederiveTokens(env: SceneHookEnv, st: SceneStatic, now: string, o: RederiveOptions) {
  const { tx } = env;
  const changes: RecordChange[] = [];
  const hookChanges: RecordChange[] = [];
  for (const t of sceneTokens(tx, st.sceneId)) {
    const n = footprint(t.size);
    const c = subjectCopies(st, {
      type: TOKEN_TYPE,
      sceneId: st.sceneId,
      cells: { col: t.col, row: t.row, w: n, h: n },
      ownerPlayerId: t.ownerPlayerId,
      invisible: t.invisible === true,
    });
    const foggedFlip = c.fogged !== (t.fogged === true);
    if (!foggedFlip && sameSeenBy(t.seenBy, c.seenBy)) continue;
    const set = foggedFlip && !o.migration ? { updatedAt: now } : {};
    tx.update(token)
      .set({ fogged: c.fogged, seenBy: c.seenBy, ...set })
      .where(eq(token.id, t.id))
      .run();
    const next = readToken(tx, t.id);
    changes.push({ type: TOKEN_TYPE, id: t.id, before: t, after: next });
    if (o.hooks !== false && tokenHiddenForPlayers(t) !== tokenHiddenForPlayers(next)) {
      hookChanges.push(...runTokenChangedHooks(env, t, next));
    }
  }
  return { changes, hookChanges };
}

function rederiveProps(env: SceneHookEnv, st: SceneStatic, now: string, o: RederiveOptions) {
  const changes: RecordChange[] = [];
  for (const p of sceneProps(env.tx, st.sceneId)) {
    const c = subjectCopies(st, {
      type: SCENE_PROP_TYPE,
      sceneId: st.sceneId,
      cells: propCells(p),
    });
    const foggedFlip = c.fogged !== (p.fogged === true);
    if (!foggedFlip && sameSeenBy(p.seenBy, c.seenBy)) continue;
    const set = foggedFlip && !o.migration ? { updatedAt: now } : {};
    env.tx
      .update(prop)
      .set({ fogged: c.fogged, seenBy: c.seenBy, ...set })
      .where(eq(prop.id, p.id))
      .run();
    changes.push({ type: SCENE_PROP_TYPE, id: p.id, before: p, after: readProp(env.tx, p.id) });
  }
  return changes;
}

/** Kept templates over their **uncut** cells (FR-FOG-10), so a map change never leaves them stale. */
function rederiveTemplates(env: SceneHookEnv, st: SceneStatic, now: string, o: RederiveOptions) {
  const changes: RecordChange[] = [];
  const s = readScene(env.tx, st.sceneId);
  for (const t of sceneTemplates(env.tx, st.sceneId)) {
    const c = subjectCopies(st, {
      type: AOE_TEMPLATE_TYPE,
      sceneId: st.sceneId,
      cells: templateCells(t, s, { cut: false }),
      placedByPlayerId: t.placedByPlayerId,
    });
    const foggedFlip = c.fogged !== (t.fogged === true);
    if (!foggedFlip && sameSeenBy(t.seenBy, c.seenBy)) continue;
    const set = foggedFlip && !o.migration ? { updatedAt: now } : {};
    env.tx
      .update(aoeTemplate)
      .set({ fogged: c.fogged, seenBy: c.seenBy, ...set })
      .where(eq(aoeTemplate.id, t.id))
      .run();
    const after = readTemplate(env.tx, t.id);
    changes.push({ type: AOE_TEMPLATE_TYPE, id: t.id, before: t, after });
  }
  return changes;
}

/** FR-SCN-36 (per player): each door's `doorSeen[n]` and `f` (seen by nobody). */
export function doorCopies(
  st: SceneStatic,
  doors: readonly Door[],
): { doors: Door[]; doorSeen: Record<string, string[]> } {
  const doorSeen: Record<string, string[]> = {};
  const out = doors.map((d): Door => {
    const c = subjectCopies(st, {
      type: SCENE_STRUCTURE_TYPE,
      sceneId: st.sceneId,
      cells: doorCells([d[1], d[2], d[3], d[4]]),
      points: doorSamplePoints([d[1], d[2], d[3], d[4]]),
    });
    doorSeen[String(d[0])] = c.seenBy;
    const f = c.fogged ? 1 : 0;
    return f === d[6] ? d : [d[0], d[1], d[2], d[3], d[4], d[5], f];
  });
  return { doors: out, doorSeen };
}

const sameDoorSeen = (
  a: Readonly<Record<string, readonly string[]>> | null | undefined,
  b: Record<string, string[]>,
) =>
  a != null &&
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(b).every(([n, ids]) => sameSeenBy(a[n], ids));

function rederiveDoors(env: SceneHookEnv, st: SceneStatic, now: string, o: RederiveOptions) {
  const before = readStructure(env.tx, st.sceneId);
  if (!before) return [];
  const next = doorCopies(st, before.doors);
  const flipped = next.doors.some((d, i) => d !== before.doors[i]);
  if (!flipped && sameDoorSeen(before.doorSeen, next.doorSeen)) return [];
  const set = flipped && !o.migration ? { rev: before.rev + 1, updatedAt: now } : {};
  env.tx
    .update(sceneStructure)
    .set({ doors: next.doors, doorSeen: next.doorSeen, ...set })
    .where(eq(sceneStructure.sceneId, st.sceneId))
    .run();
  const after = readStructure(env.tx, st.sceneId);
  return [{ type: SCENE_STRUCTURE_TYPE, id: st.sceneId, before, after } satisfies RecordChange];
}

/**
 * FR-FOG-35: every fog subject on the scene whose copies change, then token-hook rows. Callers:
 * fog commands, activation of a stale scene, a new player (active scene), the boot backfill.
 */
export function rederiveScene(
  env: SceneHookEnv,
  sceneId: string,
  o: RederiveOptions = {},
): RecordChange[] {
  const st = loadSceneStatic(env.tx, sceneId);
  if (!st) return [];
  const now = env.ctx.clock.iso();
  const tokens = rederiveTokens(env, st, now, o);
  return [
    ...tokens.changes,
    ...rederiveProps(env, st, now, o),
    ...rederiveTemplates(env, st, now, o),
    ...rederiveDoors(env, st, now, o),
    ...tokens.hookChanges,
  ];
}

/**
 * FR-FOG-35 (campaign-wide trigger): marks every non-active scene with a fog row `visionStale`
 * (re-derived on activation) and returns the scenes to re-derive now: the active one and those
 * without a fog row (no row to carry the flag; every point clear, so the re-derive is cheap).
 */
export function markScenesStale(env: SceneHookEnv, campaignId: string): string[] {
  const { tx } = env;
  const scenes = tx
    .select({ id: scene.id, active: scene.active, fog: sceneFog.sceneId })
    .from(scene)
    .leftJoin(sceneFog, eq(sceneFog.sceneId, scene.id))
    .where(eq(scene.campaignId, campaignId))
    .all();
  tx.update(sceneFog)
    .set({ visionStale: true })
    .where(
      and(
        eq(sceneFog.campaignId, campaignId),
        ...scenes.filter((s) => s.active).map((s) => ne(sceneFog.sceneId, s.id)),
      ),
    )
    .run();
  return scenes.filter((s) => s.active || s.fog === null).map((s) => s.id);
}

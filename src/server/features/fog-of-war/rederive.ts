// FR-FOG-08 / -10 / -13 / -35 / -37 / -39 / -44 (ADR-0042): the scene re-derive, in the writing
// command's transaction. Every player's sight (FR-FOG-33, cached, FR-FOG-38), then: each
// player's explored memory (active scene with the setting on only, FR-FOG-37), each darkness
// shape's `seenBy` (FR-FOG-44), every fog subject's copies (`fogged`, `seenBy`; static state once
// per sample point), the doors' `f` / `doorSeen` in the `scene-structure` row (FR-SCN-36; `rev`
// + 1 only when an `f` flips), and each player's derived `vision` record (FR-FOG-39: listed when
// the sight's inputs changed). A token whose party-level hidden flips runs the token-changed hooks
// (combat copies, FR-FOG-13 / -14). Order: `fog`, `vision`, `fog-explored`, subjects, hook rows;
// one change per record (BL-13: a combatant touched by several flips is listed once).
// `updatedAt` moves only with a wire-visible field (`fogged`, `f`): a `seenBy`-only change is
// identical on every wire and dropped from frames (FR-SYNC-19 as amended).
// FR-FOG-50 / -51 (sprint 4): while party vision is on, subjects and darkness `seenBy` follow the
// party's sight (`derive.ts`), every player's memory grows from the changed players' polygons,
// and `vision` records carry `shared` (a switch lists every record with its new flag).

import { exploredMask } from "@shared/fog-of-war/explored";
import {
  encodeRuns,
  type FogMask,
  fogBox,
  rebase,
  runCount,
  uniformMask,
} from "@shared/fog-of-war/mask";
import {
  FOG_EXPLORED_TYPE,
  FOG_RUNS_MAX,
  FOG_TYPE,
  scenePlayerId,
  VISION_TYPE,
} from "@shared/fog-of-war/schemas";
import type { DarknessRow } from "@shared/fog-of-war/shapes";
import { polygonCells } from "@shared/fog-of-war/vision";
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
import { and, eq, inArray } from "drizzle-orm";
import {
  aoeTemplate,
  fogExplored,
  prop,
  scene,
  sceneFog,
  sceneStructure,
  token,
} from "../../db/schema";
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
import {
  campaignPlayers,
  darknessSeenBy,
  loadMemory,
  loadSceneStatic,
  type SceneStatic,
  sameSeenBy,
  subjectCopies,
} from "./derive";
import { readExploredRecord, readFogRecord, type ServerVisionRecord, toVisionRecord } from "./rows";
import { type FogVision, fogLog, isSource, type SourceLike } from "./sight";
import { type VisionEntry, visionCache } from "./vision-cache";

/** A token as a possible vision source (FR-FOG-32). */
export type SourceToken = SourceLike & { id: string };

export interface RederiveOptions {
  /** Run token-changed hooks on party-level flips (default true). */
  hooks?: boolean;
  /** Boot backfill (FR-FOG-40): never touch `updatedAt` (the wire stays byte-equal). */
  migration?: boolean;
  /**
   * The write was a source token's (FR-FOG-35): its before / after, so a player whose last
   * source left (or whose first arrived) gets the `vision` delete (or create).
   */
  sourceChange?: { before: SourceToken | null; after: SourceToken | null };
  /**
   * The players whose sight changed (default: every player): only their `vision` is listed and
   * only their explored memory grows (party vision on: every player's memory grows from their
   * polygons, FR-FOG-37). A source write = its old and new owner (FR-FOG-35 table; FOG §9: the
   * other players get the moved token only).
   */
  players?: readonly string[];
  /**
   * FR-FOG-49: the party switch before this write (`fog.setPartyVision`); absent = unchanged.
   * Every `vision` record whose `shared` flag flips is listed.
   */
  partyBefore?: boolean;
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
 * FR-FOG-44: each darkness shape's `seenBy` against the scene's static state and memory. Writes
 * the row (no `rev` bump: vision doesn't depend on it) and returns its `fog` change, or null.
 */
export function rederiveDarkness(env: Pick<SceneHookEnv, "tx">, st: SceneStatic) {
  if (st.darkness.length === 0) return null;
  const memory = loadMemory(env.tx, st.sceneId);
  const next: DarknessRow[] = st.darkness.map((d) => ({
    ...d,
    seenBy: darknessSeenBy(st, d, memory),
  }));
  if (next.every((d, i) => sameSeenBy(st.darkness[i]?.seenBy, d.seenBy ?? []))) return null;
  const before = readFogRecord(env.tx, st.sceneId);
  env.tx.update(sceneFog).set({ darkness: next }).where(eq(sceneFog.sceneId, st.sceneId)).run();
  const after = readFogRecord(env.tx, st.sceneId);
  return { type: FOG_TYPE, id: st.sceneId, before, after } satisfies RecordChange;
}

/** BL-13: one change per record, at its last position: the first `before`, the last `after`. */
export function mergeChanges(list: readonly RecordChange[]): RecordChange[] {
  const key = (c: RecordChange) => `${c.type}\u0000${c.id}`;
  const last = new Map<string, number>();
  const first = new Map<string, RecordChange>();
  list.forEach((c, i) => {
    last.set(key(c), i);
    if (!first.has(key(c))) first.set(key(c), c);
  });
  if (last.size === list.length) return [...list];
  return list.flatMap((c, i) => {
    const k = key(c);
    if (last.get(k) !== i) return [];
    const f = first.get(k) as RecordChange;
    return [f === c ? c : { ...c, before: f.before }];
  });
}

/** The box cells (row-major indices) whose centre lies in one of the polygons, rasterised once. */
export function polygonsCells(
  polys: readonly (readonly number[])[],
  box: [number, number, number, number],
): Set<number> {
  const [col0, row0, cols, rows] = box;
  const out = new Set<number>();
  for (const poly of polys) {
    polygonCells(poly, (c, r) => {
      const cc = c - col0;
      const rr = r - row0;
      if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) return;
      out.add(rr * cols + cc);
    });
  }
  return out;
}

/**
 * FR-FOG-37 (pure): a memory mask over `box` plus the given cells (`polygonsCells`). Null =
 * nothing new; `{full}` = over 2,000 runs (the memory stops growing).
 */
export function growMemoryCells(
  prev: FogMask,
  cells: ReadonlySet<number>,
  box: [number, number, number, number],
): { mask: FogMask; runs: string } | { full: true } | null {
  const mask = rebase(prev, box);
  let grew = prev.box.some((v, i) => v !== box[i]);
  for (const k of cells) {
    if (mask.cells[k] === 0) {
      mask.cells[k] = 1;
      grew = true;
    }
  }
  if (!grew) return null;
  const runs = encodeRuns(mask.cells, "clear");
  return runCount(runs) > FOG_RUNS_MAX ? { full: true } : { mask, runs };
}

/** FR-FOG-37 (pure): a memory mask over `box` plus every cell whose centre lies in a polygon. */
export function growMemory(
  prev: FogMask,
  polys: readonly (readonly number[])[],
  box: [number, number, number, number],
): { mask: FogMask; runs: string } | { full: true } | null {
  return growMemoryCells(prev, polygonsCells(polys, box), box);
}

/**
 * FR-FOG-37: on the active scene with Explored on, every cell whose centre lies in one of P's
 * polygons becomes explored for P (one row per player, never shrinks; box = the scene's fog box,
 * FR-FOG-03). Full → a `warn`, the row stays. Party vision on (OQ-FOG-47): every player's row
 * grows from the polygons of the players whose sight changed (`only`; the others' cells are
 * already in every row), rasterised once; a listed player without a row yet (a new player)
 * grows from the whole party's sight.
 */
function rederiveMemory(
  env: SceneHookEnv,
  st: SceneStatic,
  box: [number, number, number, number],
  only?: readonly string[],
) {
  const changes: RecordChange[] = [];
  const [col0, row0, cols, rows] = box;
  const changed = [...(st.sight ?? [])].filter(([p]) => !only || only.includes(p));
  const grows: [string, ReadonlySet<number>][] = [];
  if (st.party === true) {
    if (st.partySight?.blind === true) return changes;
    const polysOf = (list: typeof changed) =>
      list.flatMap(([, s]) => s.vision.polys.map((x) => x.poly));
    const cells = polygonsCells(polysOf(changed), box);
    let all: Set<number> | null = null;
    for (const p of st.players) {
      if (only?.includes(p) && !readExploredRecord(env.tx, st.sceneId, p)) {
        all ??= polygonsCells(polysOf([...(st.sight ?? [])]), box);
        grows.push([p, all]);
      } else if (cells.size > 0) grows.push([p, cells]);
    }
  } else {
    for (const [p, sight] of changed) {
      if (sight.vision.polys.length === 0) continue;
      grows.push([
        p,
        polygonsCells(
          sight.vision.polys.map((x) => x.poly),
          box,
        ),
      ]);
    }
  }
  for (const [p, cells] of grows) {
    const before = readExploredRecord(env.tx, st.sceneId, p);
    const prev = before ? exploredMask(before) : uniformMask("clear", box);
    const next = growMemoryCells(prev, cells, box);
    if (next === null) continue;
    if ("full" in next) {
      fogLog().warn(`fog: explored memory of ${p} on scene ${st.sceneId} is full; not growing`);
      continue;
    }
    const values = { col0, row0, cols, rows, runs: next.runs, updatedAt: env.ctx.clock.iso() };
    env.tx
      .insert(fogExplored)
      .values({ sceneId: st.sceneId, playerId: p, campaignId: st.campaignId, ...values })
      .onConflictDoUpdate({ target: [fogExplored.sceneId, fogExplored.playerId], set: values })
      .run();
    const after = readExploredRecord(env.tx, st.sceneId, p);
    changes.push({ type: FOG_EXPLORED_TYPE, id: scenePlayerId(st.sceneId, p), before, after });
  }
  return changes;
}

/** A `vision` before whose data is unknown (cache miss): never equal to a real record. */
const unknownVision = (
  sc: { sceneId: string; campaignId: string },
  p: string,
  shared: boolean,
): ServerVisionRecord =>
  toVisionRecord(sc, p, { blind: false, see: [[]], dark: [], inv: [], src: [], polys: [] }, shared);

/** Same wire content (FR-FOG-39, -48): a sight whose inputs moved but whose polygons didn't. */
const sameVision = (a: FogVision, b: FogVision) =>
  a.blind === b.blind &&
  a.reason === b.reason &&
  a.secret === b.secret &&
  JSON.stringify([a.see, a.dark, a.inv, a.src]) === JSON.stringify([b.see, b.dark, b.inv, b.src]);

/**
 * FR-FOG-39: each player's `vision` change: created (first source), deleted (last source gone)
 * or updated when the sight's inputs and polygons changed, or (FR-FOG-51) its `shared` flag
 * flipped with the party switch; `before` = the cached sight clients last got (unknown → a
 * `before` that never equals a record, so the update always goes out).
 */
function visionChanges(
  st: SceneStatic,
  prior: ReadonlyMap<string, VisionEntry | null>,
  hadBefore: (p: string) => boolean,
  o: RederiveOptions,
): RecordChange[] {
  const sc = { sceneId: st.sceneId, campaignId: st.campaignId };
  const sharedNow = st.party === true;
  const sharedBefore = o.partyBefore ?? sharedNow;
  const out: RecordChange[] = [];
  for (const p of st.players) {
    if (o.players && !o.players.includes(p)) continue;
    const now = st.sight?.get(p) ?? null;
    const had = hadBefore(p);
    const pr = prior.get(p) ?? null;
    if (!now && !had) continue;
    const same = pr && now && (pr.key === now.key || sameVision(pr.vision, now.vision));
    if (now && had && same && sharedBefore === sharedNow) continue;
    const before = had
      ? pr
        ? toVisionRecord(sc, p, pr.vision, sharedBefore)
        : unknownVision(sc, p, sharedBefore)
      : null;
    const after = now ? toVisionRecord(sc, p, now.vision, sharedNow) : null;
    out.push({ type: VISION_TYPE, id: scenePlayerId(st.sceneId, p), before, after });
  }
  return out;
}

/** Did P have a source on the scene before the write? (Now, adjusted by the written token.) */
function sourcesBefore(st: SceneStatic, sceneId: string, o: RederiveOptions) {
  const ch = o.sourceChange;
  return (p: string) => {
    const now = (st.sight?.get(p)?.sources ?? []).filter((s) => s.tokenId !== ch?.after?.id);
    if (now.length > 0) return true;
    const b = ch?.before;
    return isSource(b) && b.sceneId === sceneId && b.ownerPlayerId === p;
  };
}

/**
 * FR-FOG-35: the `fog` row if a darkness `seenBy` changes, `vision` and `fog-explored` rows,
 * every fog subject on the scene whose copies change, then token-hook rows. Callers: fog
 * commands (they list their own `fog` change and drop this one), the visibility line's
 * `rederive` (source tokens, structure edits, a scene copy), activation of a stale scene, a new
 * player and a senses edit (active scene), the boot backfill.
 */
export function rederiveScene(
  env: SceneHookEnv,
  sceneId: string,
  o: RederiveOptions = {},
): RecordChange[] {
  const sc = env.tx.select().from(scene).where(eq(scene.id, sceneId)).get();
  if (!sc) return [];
  const cache = visionCache(env.tx);
  const prior = new Map(
    campaignPlayers(env.tx, sc.campaignId).map((p) => [p, cache.latest(sceneId, p)] as const),
  );
  const st = loadSceneStatic(env.tx, sceneId);
  if (!st) return [];
  const now = env.ctx.clock.iso();
  // FR-FOG-52: with party vision on, a source write may shift the 12-source cut for any player,
  // so every record is checked (unchanged ones are skipped) and every changed sight grows memory.
  const party = st.party === true;
  const moved = (p: string) => {
    const n = st.sight?.get(p);
    const pr = prior.get(p);
    return n !== undefined && (!pr || pr.key !== n.key);
  };
  const only = o.players;
  const vo: RederiveOptions = party ? { ...o, players: undefined } : o;
  const memoryOnly = party && only ? st.players.filter((p) => only.includes(p) || moved(p)) : only;
  const vision = o.migration ? [] : visionChanges(st, prior, sourcesBefore(st, sceneId, o), vo);
  const row = env.tx
    .select({ on: sceneFog.explored, stale: sceneFog.visionStale })
    .from(sceneFog)
    .where(eq(sceneFog.sceneId, sceneId))
    .get();
  // A full re-derive brings a stale scene up to date (FR-FOG-35).
  if (row?.stale) {
    env.tx.update(sceneFog).set({ visionStale: false }).where(eq(sceneFog.sceneId, sceneId)).run();
  }
  const explored = !o.migration && sc.active && row?.on === true;
  const memory = explored ? rederiveMemory(env, st, fogBox(sc), memoryOnly) : [];
  const darkness = rederiveDarkness(env, st);
  const tokens = rederiveTokens(env, st, now, o);
  return mergeChanges([
    ...(darkness ? [darkness] : []),
    ...vision,
    ...memory,
    ...tokens.changes,
    ...rederiveProps(env, st, now, o),
    ...rederiveTemplates(env, st, now, o),
    ...rederiveDoors(env, st, now, o),
    ...tokens.hookChanges,
  ]);
}

/**
 * FR-FOG-35 (campaign-wide trigger): marks the campaign's non-active scenes with a fog row
 * `visionStale` (re-derived on activation; `only` = just those scenes) and returns the scenes to
 * re-derive now: the active one and those without a fog row (no row to carry the flag; every
 * point clear, so the re-derive is cheap).
 */
export function markScenesStale(
  env: SceneHookEnv,
  campaignId: string,
  only?: readonly string[],
): string[] {
  const { tx } = env;
  const scenes = tx
    .select({ id: scene.id, active: scene.active, fog: sceneFog.sceneId })
    .from(scene)
    .leftJoin(sceneFog, eq(sceneFog.sceneId, scene.id))
    .where(and(eq(scene.campaignId, campaignId), ...(only ? [inArray(scene.id, [...only])] : [])))
    .all();
  const stale = scenes.filter((s) => !s.active && s.fog !== null).map((s) => s.id);
  if (stale.length > 0) {
    tx.update(sceneFog).set({ visionStale: true }).where(inArray(sceneFog.sceneId, stale)).run();
  }
  return scenes.filter((s) => s.active || s.fog === null).map((s) => s.id);
}

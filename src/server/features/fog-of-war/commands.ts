// fog-of-war commands (FOG §6, §9; protocol §35, §38). DM-only WS intents: `fog.edit` (append a
// fog shape), `fog.setAll`, `fog.undo` / `fog.redo` (sprint 4, FR-FOG-56), the darkness intents
// (`fog.placeDarkness` / `moveDarkness` / `removeDarkness` / `clearDarkness`), `fog.setExplored`
// and `fog.forgetExplored`, `fog.setInvisible` (#210, FR-FOG-45) and `fog.setPartyVision`
// (sprint 4, FR-FOG-49). Each is one transaction (FR-FOG-08): the `fog` row (`rev` + 1) + its
// undo entry (or the entry marked undone / redone) + the scene re-derive (fog subjects whose
// copies change, door flags, darkness `seenBy`, token-changed hook rows; `rederive.ts`) + one
// event-log entry → one event. Fog edits and darkness edits share one LIFO undo stack (FR-FOG-07,
// #207 G12), ≤ 50 deep; undone entries stay as the redo list until a new edit clears it
// (FR-FOG-56). IDs and time from ctx. Works on any scene of the campaign, active or not (FR-FOG-09).
import {
  DarknessCleared,
  DarknessMoved,
  DarknessPlaced,
  DarknessRemoved,
  ExploredForgotten,
  FogEdited,
  FogExploredSet,
  FogRedone,
  FogUndone,
  PartyVisionSet,
  TokenInvisibleSet,
} from "@shared/events/fog-of-war";
import { mergeCells } from "@shared/fog-of-war/brush";
import {
  type FogRow,
  fogBox,
  maskOf,
  rebase,
  rowOf,
  sameMask,
  uniformMask,
} from "@shared/fog-of-war/mask";
import {
  FOG_EXPLORED_TYPE,
  FOG_INTENTS,
  FOG_SETTINGS_TYPE,
  FOG_TYPE,
  FOG_UNDO_MAX,
  FogClearDarknessInput,
  FogEditInput,
  type FogEditKind,
  type FogEditResult,
  FogForgetExploredInput,
  FogMoveDarknessInput,
  FogPlaceDarknessInput,
  type FogPlaceDarknessResult,
  FogRedoInput,
  type FogRedoResult,
  FogRemoveDarknessInput,
  FogSetAllInput,
  FogSetExploredInput,
  FogSetInvisibleInput,
  FogSetPartyVisionInput,
  FogUndoInput,
} from "@shared/fog-of-war/schemas";
import {
  DARKNESS_MAX,
  type DarknessRow,
  FOG_ROW_BYTES_MAX,
  FOG_SHAPES_MAX,
  type FogBrushGeom,
  type FogLayerShape,
  FogShapeGeom,
  type FogShapeOp,
  isBrush,
  legacyShape,
  normaliseShape,
  type ShapeLike,
  shapeProblem,
  translateShape,
} from "@shared/fog-of-war/shapes";
import { footprint } from "@shared/scenes-map/geometry";
import { type SceneRecord, TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, invalid, notFound } from "../../commands/errors";
import type { Tx } from "../../db/client";
import {
  fogExplored,
  fogSettings,
  sceneFog,
  sceneFogEdit,
  sceneFogEditSeqNext,
  token,
} from "../../db/schema";
import type { RecordChange } from "../../events/types";
import type { Logger } from "../../log";
import { campaignOf, getScene, getToken, readToken } from "../scenes-map/rows";
import { runTokenChangedHooks } from "../scenes-map/token-hooks";
import { deriveSceneObject, tokenHiddenForPlayers } from "../scenes-map/visibility-hooks";
import { readFogRow } from "./hooks";
import { markScenesStale, mergeChanges, rederiveScene } from "./rederive";
import { dmFogRecord, readFogRecord, type ServerFogRecord, sceneExploredRecords } from "./rows";
import { readFogSettings } from "./settings";

/** FR-FOG-27: over the shape cap or the 16 KiB row → nothing written. */
export const FOG_TOO_DETAILED = "Fog too detailed — use Fog all or Reveal all to start over";
/** FR-FOG-27: over the darkness cap. */
export const FOG_TOO_MANY_DARKNESS = "Too many darkness areas";
/** FR-FOG-07: stale `expectedEditId`. */
export const FOG_CHANGED = "Fog changed — check and undo again";
export const FOG_NOTHING_TO_UNDO = "Nothing to undo";
/** FR-FOG-56: stale `expectedEditId` / nothing undone. */
export const FOG_REDO_CHANGED = "Fog changed — check and redo again";
export const FOG_NOTHING_TO_REDO = "Nothing to redo";
/** FR-FOG-30: unknown darkness id on the scene. */
export const DARKNESS_NOT_FOUND = "Darkness area not found";

/** Every cell clear: what a scene without a `fog` row holds (FR-FOG-01). */
const CLEAR_ROW: FogRow = { fill: "clear", box: [0, 0, 0, 0], runs: "" };

const fogChange = (
  before: ServerFogRecord | null,
  after: ServerFogRecord | null,
): RecordChange => ({
  type: FOG_TYPE,
  id: (after ?? before)?.id as string,
  before,
  after,
});

/** The scene's stored mask row; a corrupt row is fully fogged and logged (FR-FOG-04, fail closed). */
function currentRow(tx: Tx, log: Logger, sceneId: string): FogRow {
  const row = readFogRow(tx, sceneId);
  const { mask, corrupt } = maskOf(row);
  if (corrupt) {
    log.error(`fog: scene ${sceneId} has corrupt runs; treated as fully fogged`);
    return rowOf(mask);
  }
  return row ?? CLEAR_ROW;
}

/** Shapes, darkness and the Explored setting stored now (no row: none, off). */
function layers(env: Pick<CommandEnv, "tx">, sceneId: string) {
  const r = env.tx
    .select({ shapes: sceneFog.shapes, darkness: sceneFog.darkness, explored: sceneFog.explored })
    .from(sceneFog)
    .where(eq(sceneFog.sceneId, sceneId))
    .get();
  return { shapes: r?.shapes ?? [], darkness: r?.darkness ?? [], explored: r?.explored ?? false };
}

type RowExtra = Partial<Pick<typeof sceneFog.$inferInsert, "shapes" | "darkness" | "explored">>;

/** Writes the scene's `fog` row (insert or replace; `rev` + 1, FR-FOG-08). */
function writeRow(env: CommandEnv, s: SceneRecord, r: FogRow, extra: RowExtra = {}) {
  const values = {
    fill: r.fill,
    col0: r.box[0],
    row0: r.box[1],
    cols: r.box[2],
    rows: r.box[3],
    runs: r.runs,
    ...extra,
    updatedAt: env.ctx.clock.iso(),
  };
  env.tx
    .insert(sceneFog)
    .values({ sceneId: s.id, campaignId: s.campaignId, ...values })
    .onConflictDoUpdate({
      target: sceneFog.sceneId,
      set: { ...values, rev: sql`${sceneFog.rev} + 1` },
    })
    .run();
}

/** FR-FOG-27: the serialized DM row stays ≤ 16 KiB (checked after the write, rolled back if over). */
function checkRowBytes(env: CommandEnv, sceneId: string) {
  const r = readFogRecord(env.tx, sceneId);
  if (r && Buffer.byteLength(JSON.stringify(dmFogRecord(r))) > FOG_ROW_BYTES_MAX) {
    throw conflict(FOG_TOO_DETAILED);
  }
}

/**
 * FR-FOG-07 / -56: pushes an undo entry (base + shapes + darkness before), clears the redo list
 * (the undone entries) and drops the oldest past 50.
 */
function pushUndo(env: CommandEnv, s: SceneRecord, kind: FogEditKind, prev: FogRow): string {
  const id = env.ctx.ids.next();
  const before = layers(env, s.id);
  env.tx
    .delete(sceneFogEdit)
    .where(and(eq(sceneFogEdit.sceneId, s.id), isNotNull(sceneFogEdit.undoneAt)))
    .run();
  env.tx
    .insert(sceneFogEdit)
    .values({
      id,
      campaignId: s.campaignId,
      sceneId: s.id,
      seq: sceneFogEditSeqNext,
      kind,
      prevFill: prev.fill,
      prevCol0: prev.box[0],
      prevRow0: prev.box[1],
      prevCols: prev.box[2],
      prevRows: prev.box[3],
      prevRuns: prev.runs,
      prevShapes: before.shapes,
      prevDarkness: before.darkness,
      createdAt: env.ctx.clock.iso(),
    })
    .run();
  const stack = env.tx
    .select({ id: sceneFogEdit.id })
    .from(sceneFogEdit)
    .where(eq(sceneFogEdit.sceneId, s.id))
    .orderBy(desc(sceneFogEdit.seq))
    .all();
  const dropped = stack.slice(FOG_UNDO_MAX).map((e) => e.id);
  if (dropped.length > 0) {
    env.tx.delete(sceneFogEdit).where(inArray(sceneFogEdit.id, dropped)).run();
  }
  return id;
}

/** The scene's re-derive rows, without its own `fog` change (the command lists that one). */
const subjectsOf = (env: CommandEnv, sceneId: string) =>
  rederiveScene(env, sceneId).filter((c) => c.type !== FOG_TYPE);

/**
 * One undoable fog / darkness edit (FR-FOG-07 / -08): undo entry (the state before), the new row,
 * caps, the re-derive and one event whose changes start with the `fog` upsert.
 */
function commitEdit(
  env: CommandEnv,
  s: SceneRecord,
  prev: FogRow,
  next: { row: FogRow; extra: RowExtra; kind: FogEditKind },
  event: (editId: string) => { type: string; payload: Record<string, unknown> },
): string {
  const before = readFogRecord(env.tx, s.id);
  const editId = pushUndo(env, s, next.kind, prev);
  writeRow(env, s, next.row, next.extra);
  checkRowBytes(env, s.id);
  const subjects = subjectsOf(env, s.id);
  const e = event(editId);
  env.emit({
    type: e.type,
    campaignId: s.campaignId,
    payload: e.payload,
    changes: [fogChange(before, readFogRecord(env.tx, s.id)), ...subjects],
  });
  return editId;
}

/** A fog-layer shape's geometry as `fog.edit` appends it (FR-FOG-26). */
type LayerGeom = FogShapeGeom | FogBrushGeom;

/**
 * FR-FOG-57: the shape list with a `cells` shape merged into the last one (same op, also `cells`,
 * union within 128 × 128 and 500 runs), or null when it appends instead.
 */
export function mergeIntoLast(
  shapes: readonly FogLayerShape[],
  added: FogLayerShape,
): FogLayerShape[] | null {
  const last = shapes.at(-1);
  if (!last || !("cells" in last) || !("cells" in added) || last.op !== added.op) return null;
  const cells = mergeCells(last.cells, added.cells);
  return cells ? [...shapes.slice(0, -1), { op: last.op, cells }] : null;
}

/** FR-FOG-26: a refused shape → `invalid` with the gesture's copy. */
function checkShape(s: ShapeLike, path: string[]) {
  const problem = shapeProblem(s);
  if (problem === "crossing") {
    throw invalid("Edges can't cross", [{ path, message: "Crossing" }]);
  }
  if (problem === "zero-area") {
    throw invalid("The shape has no area", [{ path, message: "Zero area" }]);
  }
}

function findDarkness(darkness: readonly DarknessRow[], id: string): DarknessRow {
  const d = darkness.find((x) => x.id === id);
  if (!d) throw notFound(DARKNESS_NOT_FOUND);
  return d;
}

export function fogCommands(log: Logger) {
  const target = (env: CommandEnv, sceneId: string) => {
    const s = getScene(env.tx, campaignOf(env.actor), sceneId);
    return { s, prev: currentRow(env.tx, log, s.id), now: layers(env, s.id) };
  };

  /**
   * FR-FOG-05 / -26 / -27: append one fog shape (`hide` = `fog`; legacy cell rects / corner
   * polygons as their v2 shapes, undo kind `reveal | hide-rect | polygon` as in sprint 2). Every
   * edit appends and writes an undo entry.
   */
  const edit = defineCommand({
    name: FOG_INTENTS.edit,
    input: FogEditInput,
    execute({ sceneId, op, shape }, env): FogEditResult {
      const { s, prev, now } = target(env, sceneId);
      // FR-FOG-26 (sprint 4): brush shapes are valid by zod (radius, points, decodable cells).
      const geom: LayerGeom =
        "kind" in shape
          ? legacyShape(shape)
          : "stroke" in shape || "cells" in shape
            ? shape
            : normaliseShape(shape);
      if (!isBrush(geom)) checkShape(geom, ["shape"]);
      const fogOp: FogShapeOp = op === "hide" ? "fog" : op;
      const added = { op: fogOp, ...geom } as FogLayerShape;
      // FR-FOG-57: a snapped brush stroke joins the last shape when that is `cells` of the same op
      // and the union stays within the caps; the undo entry still restores the list before it.
      const merged = mergeIntoLast(now.shapes, added);
      if (!merged && now.shapes.length >= FOG_SHAPES_MAX) throw conflict(FOG_TOO_DETAILED);
      const shapes = merged ?? [...now.shapes, added];
      // Sprint-2 inputs keep their sprint-2 kinds (FR-FOG-05: they behave as before).
      const legacy = "kind" in shape && (op === "reveal" || op === "hide");
      const kind = (legacy ? `${op}-${shape.kind}` : `${fogOp}-shape`) as FogEditKind;
      const editId = commitEdit(env, s, prev, { row: prev, extra: { shapes }, kind }, (id) => ({
        type: FogEdited.type,
        payload: { sceneId: s.id, editId: id, kind, shape: geom },
      }));
      return { editId };
    },
  });

  /** FR-FOG-06: base → uniform over the current box, shapes cleared; same value, no shapes → no-op. */
  const setAll = defineCommand({
    name: FOG_INTENTS.setAll,
    input: FogSetAllInput,
    execute({ sceneId, fogged }, env): FogEditResult {
      const { s, prev, now } = target(env, sceneId);
      const box = fogBox(s);
      const next = uniformMask(fogged ? "fog" : "clear", box);
      const same = sameMask(rebase(maskOf(prev).mask, box), next);
      if (same && now.shapes.length === 0) return { editId: null };
      const kind: FogEditKind = fogged ? "fog-all" : "reveal-all";
      const editId = commitEdit(
        env,
        s,
        prev,
        { row: rowOf(next), extra: { shapes: [] }, kind },
        (id) => ({ type: FogEdited.type, payload: { sceneId: s.id, editId: id, kind } }),
      );
      return { editId };
    },
  });

  /**
   * FR-FOG-07: strict LIFO over fog and darkness edits; restores base + shapes + darkness (pre-v2
   * entries: shapes [], darkness kept). Stale `expectedEditId` or an empty stack → `conflict`.
   * FR-FOG-56: the entry is marked undone with the state it replaced (`next*`), joining the redo
   * list, instead of being deleted.
   */
  const undo = defineCommand({
    name: FOG_INTENTS.undo,
    input: FogUndoInput,
    execute({ sceneId, expectedEditId }, env): void {
      const { tx } = env;
      const s = getScene(tx, campaignOf(env.actor), sceneId);
      const latest = tx
        .select()
        .from(sceneFogEdit)
        .where(and(eq(sceneFogEdit.sceneId, s.id), isNull(sceneFogEdit.undoneAt)))
        .orderBy(desc(sceneFogEdit.seq))
        .get();
      if (!latest) throw conflict(FOG_NOTHING_TO_UNDO);
      if (latest.id !== expectedEditId) throw conflict(FOG_CHANGED);
      const before = readFogRecord(tx, s.id);
      const cur = currentRow(tx, log, s.id);
      const now = layers(env, s.id);
      const { mask, corrupt } = maskOf({
        fill: latest.prevFill,
        box: [latest.prevCol0, latest.prevRow0, latest.prevCols, latest.prevRows],
        runs: latest.prevRuns,
      });
      if (corrupt) log.error(`fog: undo entry ${latest.id} has corrupt runs; fully fogged`);
      writeRow(env, s, rowOf(mask), {
        shapes: latest.prevShapes ?? [],
        ...(latest.prevDarkness ? { darkness: latest.prevDarkness } : {}),
      });
      tx.update(sceneFogEdit)
        .set({
          undoneAt: env.ctx.clock.iso(),
          nextBase: { fill: cur.fill, box: cur.box, runs: cur.runs },
          nextShapes: now.shapes,
          nextDarkness: now.darkness,
        })
        .where(and(eq(sceneFogEdit.id, latest.id), eq(sceneFogEdit.sceneId, s.id)))
        .run();
      const subjects = subjectsOf(env, s.id);
      env.emit({
        type: FogUndone.type,
        campaignId: s.campaignId,
        payload: { sceneId: s.id, editId: latest.id },
        changes: [fogChange(before, readFogRecord(tx, s.id)), ...subjects],
      });
    },
  });

  /**
   * FR-FOG-56: re-applies the most recently undone edit (the undone entry with the lowest `seq`):
   * restores its `next*` state and clears its undone mark (it is back on the undo stack). Stale
   * `expectedEditId` or nothing undone → `conflict`.
   */
  const redo = defineCommand({
    name: FOG_INTENTS.redo,
    input: FogRedoInput,
    execute({ sceneId, expectedEditId }, env): FogRedoResult {
      const { tx } = env;
      const s = getScene(tx, campaignOf(env.actor), sceneId);
      const target = tx
        .select()
        .from(sceneFogEdit)
        .where(and(eq(sceneFogEdit.sceneId, s.id), isNotNull(sceneFogEdit.undoneAt)))
        .orderBy(asc(sceneFogEdit.seq))
        .get();
      if (!target) throw conflict(FOG_NOTHING_TO_REDO);
      if (target.id !== expectedEditId) throw conflict(FOG_REDO_CHANGED);
      const before = readFogRecord(tx, s.id);
      const base = target.nextBase;
      const { mask, corrupt } = maskOf(base ?? currentRow(tx, log, s.id));
      if (corrupt) log.error(`fog: redo entry ${target.id} has corrupt runs; fully fogged`);
      writeRow(env, s, rowOf(mask), {
        ...(target.nextShapes ? { shapes: target.nextShapes } : {}),
        ...(target.nextDarkness ? { darkness: target.nextDarkness } : {}),
      });
      tx.update(sceneFogEdit)
        .set({ undoneAt: null, nextBase: null, nextShapes: null, nextDarkness: null })
        .where(eq(sceneFogEdit.id, target.id))
        .run();
      const subjects = subjectsOf(env, s.id);
      env.emit({
        type: FogRedone.type,
        campaignId: s.campaignId,
        payload: { sceneId: s.id, editId: target.id, kind: target.kind },
        changes: [fogChange(before, readFogRecord(tx, s.id)), ...subjects],
      });
      return { editId: target.id };
    },
  });

  /** FR-FOG-28 / -30: a new darkness shape (id from ctx); ≤ 20 per scene. */
  const placeDarkness = defineCommand({
    name: FOG_INTENTS.placeDarkness,
    input: FogPlaceDarknessInput,
    execute({ sceneId, shape }, env): FogPlaceDarknessResult {
      const { s, prev, now } = target(env, sceneId);
      const geom = normaliseShape(shape);
      checkShape(geom, ["shape"]);
      if (now.darkness.length >= DARKNESS_MAX) throw conflict(FOG_TOO_MANY_DARKNESS);
      const darknessId = env.ctx.ids.next();
      const added = { id: darknessId, ...geom } as DarknessRow;
      const editId = commitEdit(
        env,
        s,
        prev,
        { row: prev, extra: { darkness: [...now.darkness, added] }, kind: "darkness-place" },
        (id) => ({ type: DarknessPlaced.type, payload: { sceneId: s.id, editId: id, darknessId } }),
      );
      return { darknessId, editId };
    },
  });

  /** FR-FOG-30: translate a darkness shape; it must stay within ±1,024; (0, 0) → no-op. */
  const moveDarkness = defineCommand({
    name: FOG_INTENTS.moveDarkness,
    input: FogMoveDarknessInput,
    execute({ sceneId, darknessId, dx, dy }, env): FogEditResult {
      const { s, prev, now } = target(env, sceneId);
      const d = findDarkness(now.darkness, darknessId);
      if (dx === 0 && dy === 0) return { editId: null };
      const moved = FogShapeGeom.safeParse(translateShape(d, dx, dy));
      if (!moved.success) {
        throw invalid("The darkness area must stay within ±1,024 cells", [
          { path: ["dx"], message: "Out of range" },
        ]);
      }
      const darkness = now.darkness.map((x) =>
        x.id === darknessId ? ({ id: x.id, ...moved.data } as DarknessRow) : x,
      );
      const editId = commitEdit(
        env,
        s,
        prev,
        { row: prev, extra: { darkness }, kind: "darkness-move" },
        (id) => ({ type: DarknessMoved.type, payload: { sceneId: s.id, editId: id, darknessId } }),
      );
      return { editId };
    },
  });

  /** FR-FOG-30: remove one darkness shape (Undo restores the same id). */
  const removeDarkness = defineCommand({
    name: FOG_INTENTS.removeDarkness,
    input: FogRemoveDarknessInput,
    execute({ sceneId, darknessId }, env): FogEditResult {
      const { s, prev, now } = target(env, sceneId);
      findDarkness(now.darkness, darknessId);
      const darkness = now.darkness.filter((x) => x.id !== darknessId);
      const editId = commitEdit(
        env,
        s,
        prev,
        { row: prev, extra: { darkness }, kind: "darkness-remove" },
        (id) => ({
          type: DarknessRemoved.type,
          payload: { sceneId: s.id, editId: id, darknessId },
        }),
      );
      return { editId };
    },
  });

  /** FR-FOG-30: remove every darkness shape; none → no-op. */
  const clearDarkness = defineCommand({
    name: FOG_INTENTS.clearDarkness,
    input: FogClearDarknessInput,
    execute({ sceneId }, env): FogEditResult {
      const { s, prev, now } = target(env, sceneId);
      if (now.darkness.length === 0) return { editId: null };
      const editId = commitEdit(
        env,
        s,
        prev,
        { row: prev, extra: { darkness: [] }, kind: "darkness-clear" },
        (id) => ({ type: DarknessCleared.type, payload: { sceneId: s.id, editId: id } }),
      );
      return { editId };
    },
  });

  /** FR-FOG-29: Explored memory on / off for the scene (not in the undo stack); same → no-op. */
  const setExplored = defineCommand({
    name: FOG_INTENTS.setExplored,
    input: FogSetExploredInput,
    execute({ sceneId, on }, env): void {
      const { s, prev, now } = target(env, sceneId);
      if (now.explored === on) return;
      const before = readFogRecord(env.tx, s.id);
      writeRow(env, s, prev, { explored: on });
      env.emit({
        type: FogExploredSet.type,
        campaignId: s.campaignId,
        payload: { sceneId: s.id, on },
        changes: [fogChange(before, readFogRecord(env.tx, s.id))],
      });
    },
  });

  /**
   * FR-FOG-31: deletes every `fog-explored` row of the scene; none → no-op. Darkness `seenBy`
   * may shrink with the memory (FR-FOG-44): the re-derive lists the `fog` row then.
   */
  const forgetExplored = defineCommand({
    name: FOG_INTENTS.forgetExplored,
    input: FogForgetExploredInput,
    execute({ sceneId }, env): void {
      const s = getScene(env.tx, campaignOf(env.actor), sceneId);
      const rows = sceneExploredRecords(env.tx, s.id);
      if (rows.length === 0) return;
      env.tx.delete(fogExplored).where(eq(fogExplored.sceneId, s.id)).run();
      const deletes: RecordChange[] = rows.map((r) => ({
        type: FOG_EXPLORED_TYPE,
        id: r.id,
        before: r,
        after: null,
      }));
      env.emit({
        type: ExploredForgotten.type,
        campaignId: s.campaignId,
        payload: { sceneId: s.id },
        changes: [...deletes, ...rederiveScene(env, s.id)],
      });
    },
  });

  /**
   * FR-FOG-45 (#210): the DM-only Invisible token state, any scene. Same value → no-op (no
   * event). Re-derives the token's copies (`derive`, FR-FOG-46: only Sees-invisible polygons see
   * an unowned invisible token) and runs token-changed hooks on a party-level flip (FR-FOG-13 /
   * -14). Not a source change: an owned token keeps its vision.
   */
  const setInvisible = defineCommand({
    name: FOG_INTENTS.setInvisible,
    input: FogSetInvisibleInput,
    execute({ tokenId, invisible }, env): Record<string, never> {
      const { tx } = env;
      const cid = campaignOf(env.actor);
      const before = getToken(tx, cid, tokenId);
      if ((before.invisible === true) === invisible) return {};
      const n = footprint(before.size);
      const { fogged, seenBy } = deriveSceneObject(tx, {
        type: TOKEN_TYPE,
        sceneId: before.sceneId,
        cells: { col: before.col, row: before.row, w: n, h: n },
        ownerPlayerId: before.ownerPlayerId,
        invisible,
      });
      // `invisible` is on the DM wire only: `updatedAt` moves with `fogged` alone, so a player who
      // keeps seeing the token gets nothing (FOG §9 change table).
      const touched = fogged !== (before.fogged === true) ? { updatedAt: env.ctx.clock.iso() } : {};
      tx.update(token)
        .set({ invisible, fogged, seenBy, ...touched })
        .where(eq(token.id, tokenId))
        .run();
      const after = readToken(tx, tokenId);
      const hookChanges =
        tokenHiddenForPlayers(before) !== tokenHiddenForPlayers(after)
          ? runTokenChangedHooks(env, before, after)
          : [];
      env.emit({
        type: TokenInvisibleSet.type,
        campaignId: cid,
        payload: { sceneId: before.sceneId, tokenId, invisible },
        changes: [{ type: TOKEN_TYPE, id: tokenId, before, after }, ...hookChanges],
      });
      return {};
    },
  });

  /**
   * FR-FOG-49 (sprint 4, ADR party vision): the campaign's party vision switch. Same value →
   * no-op (no event). One transaction: the `fog_settings` row + the active scene re-derived for
   * every player (subjects, darkness `seenBy`, memory, every `vision` with its new `shared` flag,
   * FR-FOG-51) + `visionStale` on the campaign's other scenes (re-derived at activation) + one
   * event-log entry → `PartyVisionSet`. Logged, not undoable; prep or live.
   */
  const setPartyVision = defineCommand({
    name: FOG_INTENTS.setPartyVision,
    input: FogSetPartyVisionInput,
    execute({ on }, env): Record<string, never> {
      const cid = campaignOf(env.actor);
      const before = readFogSettings(env.tx, cid);
      if (before.partyVision === on) return {};
      const values = { partyVision: on, updatedAt: env.ctx.clock.iso() };
      env.tx
        .insert(fogSettings)
        .values({ campaignId: cid, ...values })
        .onConflictDoUpdate({ target: fogSettings.campaignId, set: values })
        .run();
      const rows = markScenesStale(env, cid).flatMap((id) =>
        rederiveScene(env, id, { partyBefore: before.partyVision }),
      );
      env.emit({
        type: PartyVisionSet.type,
        campaignId: cid,
        payload: { on },
        changes: [
          { type: FOG_SETTINGS_TYPE, id: cid, before, after: readFogSettings(env.tx, cid) },
          ...mergeChanges(rows),
        ],
      });
      return {};
    },
  });

  return {
    edit,
    setAll,
    undo,
    redo,
    setPartyVision,
    placeDarkness,
    moveDarkness,
    removeDarkness,
    clearDarkness,
    setExplored,
    forgetExplored,
    setInvisible,
  };
}

/** Entries of a scene's undo stack (undone ones included: the redo list), oldest first. */
export function fogUndoStack(tx: Pick<Tx, "select">, sceneId: string) {
  return tx
    .select()
    .from(sceneFogEdit)
    .where(eq(sceneFogEdit.sceneId, sceneId))
    .orderBy(asc(sceneFogEdit.seq))
    .all();
}

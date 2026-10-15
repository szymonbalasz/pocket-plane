// fog-of-war commands (FOG §6, §9; protocol §35). DM-only WS intents `fog.edit`, `fog.setAll`,
// `fog.undo`. Each is one transaction (FR-FOG-08): the `fog` row + its undo entry (or the undone
// entry's delete) + every token on the scene whose `fogged` flips + token-changed hook rows for a
// fog-hidden flip (FR-FOG-13) + one event-log entry → `FogEdited` / `FogUndone`. IDs and time
// from ctx. Works on any scene of the campaign, active or not (FR-FOG-09).
import { FogEdited, FogUndone } from "@shared/events/fog-of-war";
import {
  type FogMask,
  type FogRow,
  fogBox,
  footprintFogged,
  maskOf,
  rebase,
  rowOf,
  runsWithinCap,
  sameMask,
  uniformMask,
} from "@shared/fog-of-war/mask";
import { applyShape, polygonProblem } from "@shared/fog-of-war/raster";
import {
  FOG_INTENTS,
  FOG_TYPE,
  FOG_UNDO_MAX,
  FogEditInput,
  type FogEditKind,
  type FogEditResult,
  type FogRecord,
  FogSetAllInput,
  type FogShape,
  FogUndoInput,
} from "@shared/fog-of-war/schemas";
import { footprint } from "@shared/scenes-map/geometry";
import { type SceneRecord, TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, invalid } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { sceneFog, sceneFogEdit, sceneFogEditSeqNext, token } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import type { Logger } from "../../log";
import { campaignOf, getScene, readToken, sceneTokens } from "../scenes-map/rows";
import { runTokenChangedHooks } from "../scenes-map/token-hooks";
import { hiddenByHooks } from "../scenes-map/visibility-hooks";
import { readFogRow } from "./hooks";
import { readFogRecord } from "./rows";

/** FR-FOG-04: over the run cap → nothing written. */
export const FOG_TOO_DETAILED = "Fog too detailed — reveal or hide larger areas";
/** FR-FOG-07: stale `expectedEditId`. */
export const FOG_CHANGED = "Fog changed — check and undo again";
export const FOG_NOTHING_TO_UNDO = "Nothing to undo";

/** Every cell clear: what a scene without a `fog` row holds (FR-FOG-01). */
const CLEAR_ROW: FogRow = { fill: "clear", box: [0, 0, 0, 0], runs: "" };

const fogChange = (before: FogRecord | null, after: FogRecord | null): RecordChange => ({
  type: FOG_TYPE,
  id: (after ?? before)?.id as string,
  before,
  after,
});

/** The scene's stored mask; a corrupt row is fully fogged and logged (FR-FOG-04, fail closed). */
function currentMask(tx: Tx, log: Logger, sceneId: string): { row: FogRow; mask: FogMask } {
  const row = readFogRow(tx, sceneId);
  const { mask, corrupt } = maskOf(row);
  if (corrupt) {
    log.error(`fog: scene ${sceneId} has corrupt runs; treated as fully fogged`);
    return { row: rowOf(mask), mask };
  }
  return { row: row ?? CLEAR_ROW, mask };
}

/** Writes the scene's `fog` row (insert or replace). */
function writeRow(env: CommandEnv, s: SceneRecord, r: FogRow) {
  const values = {
    fill: r.fill,
    col0: r.box[0],
    row0: r.box[1],
    cols: r.box[2],
    rows: r.box[3],
    runs: r.runs,
    updatedAt: env.ctx.clock.iso(),
  };
  env.tx
    .insert(sceneFog)
    .values({ sceneId: s.id, campaignId: s.campaignId, ...values })
    .onConflictDoUpdate({ target: sceneFog.sceneId, set: values })
    .run();
}

/** FR-FOG-07: pushes an undo entry (the mask before) and drops the oldest past the depth cap. */
function pushUndo(env: CommandEnv, s: SceneRecord, kind: FogEditKind, prev: FogRow): string {
  const id = env.ctx.ids.next();
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

/**
 * FR-FOG-08 / -10 / -13: re-derives `fogged` of every token on the scene against `mask`; a token
 * whose fog-hidden value (any `hides`) flips runs the token-changed hooks. Token rows first, then
 * hook rows (as the FR-MAP-20 size refresh).
 */
function rederiveTokens(env: CommandEnv, sceneId: string, mask: FogMask): RecordChange[] {
  const { tx, ctx, actor } = env;
  const changes: RecordChange[] = [];
  const hookChanges: RecordChange[] = [];
  const now = ctx.clock.iso();
  for (const t of sceneTokens(tx, sceneId)) {
    const n = footprint(t.size);
    const fogged = footprintFogged(mask, { col: t.col, row: t.row, w: n, h: n });
    if (fogged === (t.fogged === true)) continue;
    tx.update(token).set({ fogged, updatedAt: now }).where(eq(token.id, t.id)).run();
    const next = readToken(tx, t.id);
    changes.push({ type: TOKEN_TYPE, id: t.id, before: t, after: next });
    if (hiddenByHooks(TOKEN_TYPE, t) !== hiddenByHooks(TOKEN_TYPE, next)) {
      hookChanges.push(...runTokenChangedHooks({ tx, ctx, actor }, t, next));
    }
  }
  return [...changes, ...hookChanges];
}

/** Commits a new mask as one undoable edit and emits `FogEdited` (FR-FOG-05 / -06 / -08). */
function commitEdit(
  env: CommandEnv,
  s: SceneRecord,
  prev: FogRow,
  next: FogMask,
  kind: FogEditKind,
  shape?: FogShape,
): FogEditResult {
  const row = rowOf(next);
  if (!runsWithinCap(row.runs)) throw conflict(FOG_TOO_DETAILED);
  const before = readFogRecord(env.tx, s.id);
  writeRow(env, s, row);
  const editId = pushUndo(env, s, kind, prev);
  const tokens = rederiveTokens(env, s.id, next);
  env.emit({
    type: FogEdited.type,
    campaignId: s.campaignId,
    payload: { sceneId: s.id, editId, kind, ...(shape ? { shape } : {}) },
    changes: [fogChange(before, readFogRecord(env.tx, s.id)), ...tokens],
  });
  return { editId };
}

/** The masks a fog command works from: the stored row and its mask re-based to the box. */
function editBase(env: CommandEnv, log: Logger, sceneId: string) {
  const s = getScene(env.tx, campaignOf(env.actor), sceneId);
  const { row, mask } = currentMask(env.tx, log, s.id);
  return { s, prev: row, base: rebase(mask, fogBox(s)) };
}

export function fogCommands(log: Logger) {
  /** FR-FOG-05: reveal / hide a rectangle or polygon; no cell changes → no event, `editId: null`. */
  const edit = defineCommand({
    name: FOG_INTENTS.edit,
    input: FogEditInput,
    execute({ sceneId, op, shape }, env): FogEditResult {
      const { s, prev, base } = editBase(env, log, sceneId);
      if (shape.kind === "polygon") {
        const problem = polygonProblem(shape.points);
        if (problem === "crossing") {
          throw invalid("Edges can't cross", [{ path: ["shape", "points"], message: "Crossing" }]);
        }
        if (problem === "zero-area") {
          throw invalid("The polygon has no area", [
            { path: ["shape", "points"], message: "Zero area" },
          ]);
        }
      }
      const { mask, changed } = applyShape(base, op, shape);
      if (!changed) return { editId: null };
      const kind = `${op}-${shape.kind === "rect" ? "rect" : "polygon"}` as FogEditKind;
      return commitEdit(env, s, prev, mask, kind, shape);
    },
  });

  /** FR-FOG-06: Fog all / Reveal all over the current box; same value → no-op. */
  const setAll = defineCommand({
    name: FOG_INTENTS.setAll,
    input: FogSetAllInput,
    execute({ sceneId, fogged }, env): FogEditResult {
      const { s, prev, base } = editBase(env, log, sceneId);
      const next = uniformMask(fogged ? "fog" : "clear", base.box);
      if (sameMask(base, next)) return { editId: null };
      return commitEdit(env, s, prev, next, fogged ? "fog-all" : "reveal-all");
    },
  });

  /** FR-FOG-07: strict LIFO; stale `expectedEditId` or an empty stack → `conflict`. */
  const undo = defineCommand({
    name: FOG_INTENTS.undo,
    input: FogUndoInput,
    execute({ sceneId, expectedEditId }, env): void {
      const { tx } = env;
      const s = getScene(tx, campaignOf(env.actor), sceneId);
      const latest = tx
        .select()
        .from(sceneFogEdit)
        .where(eq(sceneFogEdit.sceneId, s.id))
        .orderBy(desc(sceneFogEdit.seq))
        .get();
      if (!latest) throw conflict(FOG_NOTHING_TO_UNDO);
      if (latest.id !== expectedEditId) throw conflict(FOG_CHANGED);
      const before = readFogRecord(tx, s.id);
      const { mask, corrupt } = maskOf({
        fill: latest.prevFill,
        box: [latest.prevCol0, latest.prevRow0, latest.prevCols, latest.prevRows],
        runs: latest.prevRuns,
      });
      if (corrupt) log.error(`fog: undo entry ${latest.id} has corrupt runs; fully fogged`);
      writeRow(env, s, rowOf(mask));
      tx.delete(sceneFogEdit)
        .where(and(eq(sceneFogEdit.id, latest.id), eq(sceneFogEdit.sceneId, s.id)))
        .run();
      const tokens = rederiveTokens(env, s.id, mask);
      env.emit({
        type: FogUndone.type,
        campaignId: s.campaignId,
        payload: { sceneId: s.id, editId: latest.id },
        changes: [fogChange(before, readFogRecord(tx, s.id)), ...tokens],
      });
    },
  });

  return { edit, setAll, undo };
}

/** Entries of a scene's undo stack, oldest first (tests, fixtures). */
export function fogUndoStack(tx: Pick<Tx, "select">, sceneId: string) {
  return tx
    .select()
    .from(sceneFogEdit)
    .where(eq(sceneFogEdit.sceneId, sceneId))
    .orderBy(asc(sceneFogEdit.seq))
    .all();
}

// FR-FOG-08 / -10 / -13: a fog command's re-derive of every fog subject on the scene against the
// new mask, in the command's transaction: tokens, props and kept AoE templates whose `fogged`
// changes, plus the per-door fog flag `f` in the scene's `scene-structure` row (OQ-SCN-06,
// FR-SCN-36; `rev` + 1 when a flag changes). A token whose fog-hidden value (any `hides`) flips
// runs the token-changed hooks (combat copies, FR-FOG-14). Subject rows first, then hook rows.
import { type FogMask, footprintFogged } from "@shared/fog-of-war/mask";
import { doorCells, propCells, templateCells } from "@shared/scene-tools/geometry";
import {
  AOE_TEMPLATE_TYPE,
  type Door,
  SCENE_PROP_TYPE,
  SCENE_STRUCTURE_TYPE,
} from "@shared/scene-tools/schemas";
import { footprint } from "@shared/scenes-map/geometry";
import { type SceneRecord, TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { aoeTemplate, prop, sceneStructure, token } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import {
  readProp,
  readStructure,
  readTemplate,
  sceneProps,
  sceneTemplates,
} from "../scene-tools/rows";
import { readToken, sceneTokens } from "../scenes-map/rows";
import { runTokenChangedHooks } from "../scenes-map/token-hooks";
import { hiddenByHooks } from "../scenes-map/visibility-hooks";

function rederiveTokens(env: CommandEnv, s: SceneRecord, mask: FogMask, now: string) {
  const { tx, ctx, actor } = env;
  const changes: RecordChange[] = [];
  const hookChanges: RecordChange[] = [];
  for (const t of sceneTokens(tx, s.id)) {
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
  return { changes, hookChanges };
}

function rederiveProps(env: CommandEnv, s: SceneRecord, mask: FogMask, now: string) {
  const changes: RecordChange[] = [];
  for (const p of sceneProps(env.tx, s.id)) {
    const fogged = footprintFogged(mask, propCells(p));
    if (fogged === (p.fogged === true)) continue;
    env.tx.update(prop).set({ fogged, updatedAt: now }).where(eq(prop.id, p.id)).run();
    changes.push({ type: SCENE_PROP_TYPE, id: p.id, before: p, after: readProp(env.tx, p.id) });
  }
  return changes;
}

/** Kept templates over their **uncut** cells (FR-FOG-10), so a map change never leaves them stale. */
function rederiveTemplates(env: CommandEnv, s: SceneRecord, mask: FogMask, now: string) {
  const changes: RecordChange[] = [];
  for (const t of sceneTemplates(env.tx, s.id)) {
    const fogged = footprintFogged(mask, templateCells(t, s, { cut: false }));
    if (fogged === (t.fogged === true)) continue;
    env.tx
      .update(aoeTemplate)
      .set({ fogged, updatedAt: now })
      .where(eq(aoeTemplate.id, t.id))
      .run();
    const after = readTemplate(env.tx, t.id);
    changes.push({ type: AOE_TEMPLATE_TYPE, id: t.id, before: t, after });
  }
  return changes;
}

/** FR-SCN-36: `f = 1` iff every `doorCells` cell is fogged; one structure write if any flips. */
function rederiveDoors(env: CommandEnv, s: SceneRecord, mask: FogMask, now: string) {
  const before = readStructure(env.tx, s.id);
  if (!before || before.doors.length === 0) return [];
  let flipped = false;
  const doors = before.doors.map((d): Door => {
    const f = footprintFogged(mask, doorCells([d[1], d[2], d[3], d[4]])) ? 1 : 0;
    if (f === d[6]) return d;
    flipped = true;
    return [d[0], d[1], d[2], d[3], d[4], d[5], f];
  });
  if (!flipped) return [];
  env.tx
    .update(sceneStructure)
    .set({ doors, rev: before.rev + 1, updatedAt: now })
    .where(eq(sceneStructure.sceneId, s.id))
    .run();
  const after = readStructure(env.tx, s.id);
  return [{ type: SCENE_STRUCTURE_TYPE, id: s.id, before, after } satisfies RecordChange];
}

/** Every fog subject on the scene whose copy changes against `mask`, then token-hook rows. */
export function rederiveSubjects(env: CommandEnv, s: SceneRecord, mask: FogMask): RecordChange[] {
  const now = env.ctx.clock.iso();
  const tokens = rederiveTokens(env, s, mask, now);
  return [
    ...tokens.changes,
    ...rederiveProps(env, s, mask, now),
    ...rederiveTemplates(env, s, mask, now),
    ...rederiveDoors(env, s, mask, now),
    ...tokens.hookChanges,
  ];
}

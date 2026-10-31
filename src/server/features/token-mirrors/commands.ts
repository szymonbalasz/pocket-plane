// Token-mirror commands (MIR §6, §9), DM only: `mir.create`, `mir.move`, `mir.setMode`, `mir.delete`.
// One transaction each: validate → caps → sight copies → one write → one event. IDs and time from
// ctx. Any scene of the campaign (prep); no change → no event.
import {
  MirrorCreated,
  MirrorDeleted,
  MirrorModeSet,
  MirrorMoved,
} from "@shared/events/token-mirrors";
import { overlapsMap } from "@shared/scenes-map/geometry";
import type { SceneRecord } from "@shared/scenes-map/schemas";
import {
  CreateMirrorInput,
  MIR_INTENTS,
  MIRRORS_PER_CAMPAIGN_MAX,
  MIRRORS_PER_SCENE_MAX,
  MirrorIdInput,
  MoveMirrorInput,
  SetMirrorModeInput,
  type TokenMirrorRecord,
} from "@shared/token-mirrors/schemas";
import { count, eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, invalid, notFound } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { tokenMirror, tokenMirrorSeqNext } from "../../db/schema";
import { campaignOf, findScene, getToken } from "../scenes-map/rows";
import { readMirror } from "./rows";
import { isSuppressed, mirrorChange, mirrorSight, sourceCopies } from "./sync";

export const MIRROR_OFF_MAP = "A mirror must overlap the map";

/** A mirror of the actor's campaign, else `not_found`. */
function getMirror(env: CommandEnv, id: string): TokenMirrorRecord {
  const r = readMirror(env.tx, id);
  if (!r || r.campaignId !== campaignOf(env.actor)) throw notFound("Mirror not found");
  return r;
}

function assertCaps(tx: Tx, cid: string, sceneId: string) {
  const n = (where: ReturnType<typeof eq>) =>
    tx.select({ n: count() }).from(tokenMirror).where(where).get()?.n ?? 0;
  if (n(eq(tokenMirror.sceneId, sceneId)) + 1 > MIRRORS_PER_SCENE_MAX) {
    throw conflict(`A scene holds at most ${MIRRORS_PER_SCENE_MAX} mirrors`);
  }
  if (n(eq(tokenMirror.campaignId, cid)) + 1 > MIRRORS_PER_CAMPAIGN_MAX) {
    throw conflict(`A campaign holds at most ${MIRRORS_PER_CAMPAIGN_MAX} mirrors`);
  }
}

/** FR-MIR-01 – -05: a new mirror of a token, on the token's scene; default mode `visible`. */
export const createMirror = defineCommand({
  name: MIR_INTENTS.create,
  input: CreateMirrorInput,
  roles: ["dm"],
  execute({ tokenId, col, row, mode }, env): { mirrorId: string } {
    const { tx, ctx } = env;
    const cid = campaignOf(env.actor);
    const t = getToken(tx, cid, tokenId);
    const s = findScene(tx, cid, t.sceneId) as SceneRecord;
    if (!overlapsMap(s, col, row, t.size)) {
      throw invalid(MIRROR_OFF_MAP, [{ path: ["col"], message: "Off the map" }]);
    }
    assertCaps(tx, cid, t.sceneId);
    const id = ctx.ids.next();
    const now = ctx.clock.iso();
    const at = { col, row, size: t.size };
    tx.insert(tokenMirror)
      .values({
        id,
        campaignId: cid,
        sceneId: t.sceneId,
        tokenId,
        seq: tokenMirrorSeqNext,
        col,
        row,
        mode: mode ?? "visible",
        ...sourceCopies(t),
        suppressed: isSuppressed(t, s, at),
        ...mirrorSight(tx, t.sceneId, at),
        createdAt: now,
        updatedAt: now,
      })
      .run();
    env.emit({
      type: MirrorCreated.type,
      campaignId: cid,
      payload: { mirrorId: id },
      changes: [mirrorChange(null, readMirror(tx, id))],
    });
    return { mirrorId: id };
  },
});

/** FR-MIR-12: the DM places a mirror; its distance to the token is whatever this leaves. */
export const moveMirror = defineCommand({
  name: MIR_INTENTS.move,
  input: MoveMirrorInput,
  roles: ["dm"],
  execute({ mirrorId, col, row }, env): void {
    const { tx, ctx } = env;
    const before = getMirror(env, mirrorId);
    if (before.col === col && before.row === row) return;
    const s = findScene(tx, before.campaignId, before.sceneId) as SceneRecord;
    if (!overlapsMap(s, col, row, before.size)) {
      throw invalid(MIRROR_OFF_MAP, [{ path: ["col"], message: "Off the map" }]);
    }
    const t = getToken(tx, before.campaignId, before.tokenId);
    const at = { col, row, size: before.size };
    tx.update(tokenMirror)
      .set({
        col,
        row,
        suppressed: isSuppressed(t, s, at),
        ...mirrorSight(tx, before.sceneId, at),
        updatedAt: ctx.clock.iso(),
      })
      .where(eq(tokenMirror.id, mirrorId))
      .run();
    env.emit({
      type: MirrorMoved.type,
      campaignId: before.campaignId,
      payload: { mirrorId },
      changes: [mirrorChange(before, readMirror(tx, mirrorId))],
    });
  },
});

/** FR-MIR-06: Hidden, Visible, Transparent or Shadow. */
export const setMirrorMode = defineCommand({
  name: MIR_INTENTS.setMode,
  input: SetMirrorModeInput,
  roles: ["dm"],
  execute({ mirrorId, mode }, env): void {
    const { tx, ctx } = env;
    const before = getMirror(env, mirrorId);
    if (before.mode === mode) return;
    tx.update(tokenMirror)
      .set({ mode, updatedAt: ctx.clock.iso() })
      .where(eq(tokenMirror.id, mirrorId))
      .run();
    env.emit({
      type: MirrorModeSet.type,
      campaignId: before.campaignId,
      payload: { mirrorId },
      changes: [mirrorChange(before, readMirror(tx, mirrorId))],
    });
  },
});

/** FR-MIR-13. */
export const deleteMirror = defineCommand({
  name: MIR_INTENTS.delete,
  input: MirrorIdInput,
  roles: ["dm"],
  execute({ mirrorId }, env): void {
    const before = getMirror(env, mirrorId);
    env.tx.delete(tokenMirror).where(eq(tokenMirror.id, mirrorId)).run();
    env.emit({
      type: MirrorDeleted.type,
      campaignId: before.campaignId,
      payload: { mirrorId },
      changes: [mirrorChange(before, null)],
    });
  },
});

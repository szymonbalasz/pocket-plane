// AoE templates (SCN FR-SCN-20–27, -35): the kept-template commands and the `scn.template`
// signal's audience. Kept: `scn.placeTemplate` (DM, player on the active scene; ≤ 20 per scene,
// ≤ 3 per player per scene), `scn.updateTemplate` / `scn.deleteTemplate` (DM or the placer),
// `scn.clearTemplates` (DM). Each write that sets or moves a footprint derives `fogged` over the
// uncut cells **before** its single write (FR-SCN-35). A player sees a template only on the
// active scene and not hidden for players; others' are `forbidden`, unseen ones `not_found`.
import {
  TemplateDeleted,
  TemplatePlaced,
  TemplatesCleared,
  TemplateUpdated,
} from "@shared/events/scene-tools";
import {
  AOE_TEMPLATE_TYPE,
  type AoeTemplateRecord,
  ClearTemplatesInput,
  PlaceTemplateInput,
  SCN_INTENTS,
  TEMPLATE_WIDTH,
  TEMPLATES_PER_PLAYER_MAX,
  TEMPLATES_PER_SCENE_MAX,
  type TemplateGeometry,
  TemplateIdInput,
  type TemplateShape,
  type TemplateSignalData,
  UpdateTemplateInput,
} from "@shared/scene-tools/schemas";
import { and, count, eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, forbidden, invalid, notFound } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { aoeTemplate, aoeTemplateSeqNext, player, scene } from "../../db/schema";
import type { Actor, RecordChange } from "../../events/types";
import type { SignalAudience, SignalRead, SignalSender } from "../../ws/signals";
import { activeSceneOf, campaignOf, getScene } from "../scenes-map/rows";
import { templateCopies } from "./copies";
import { readTemplate, sceneTemplates } from "./rows";
import { templateVisibility } from "./visibility";

const change = (
  before: AoeTemplateRecord | null,
  after: AoeTemplateRecord | null,
): RecordChange => ({
  type: AOE_TEMPLATE_TYPE,
  id: (after ?? before)?.id as string,
  before,
  after,
});

/** FR-SCN-20: `width` is stored for lines only (default 5 ft), else null. */
const widthFor = (shape: TemplateShape, width: number | null | undefined): number | null =>
  shape === "line" ? (width ?? TEMPLATE_WIDTH.default) : null;

/** A DM-only field sent by a player → `invalid`, like the player schema's strict parse. */
function refuseDmFields(actor: Actor, input: object, fields: readonly string[]): void {
  if (actor.role !== "player") return;
  const sent = fields.filter((f) => (input as Record<string, unknown>)[f] !== undefined);
  if (sent.length > 0) {
    throw invalid(
      "Invalid input",
      sent.map((f) => ({ path: [f], message: "Not allowed for players" })),
    );
  }
}

/** FR-SCN-25: a player places on the active scene only (as the signal, FR-SCN-24). */
function assertActiveForPlayer(tx: Tx, actor: Actor, sceneId: string): void {
  if (actor.role !== "player") return;
  if (activeSceneOf(tx, campaignOf(actor))?.id !== sceneId) {
    throw invalid("Not the scene players see", [{ path: ["sceneId"], message: "Not active" }]);
  }
}

/**
 * FR-SCN-26: the DM edits any template; a player only one they can see (active scene, not
 * hidden for players; else `not_found`) and placed themselves (else `forbidden`).
 */
function getEditable(tx: Tx, actor: Actor, templateId: string): AoeTemplateRecord {
  const cid = campaignOf(actor);
  const t = readTemplate(tx, templateId);
  if (!t || t.campaignId !== cid) throw notFound("Template not found");
  if (actor.role !== "player") return t;
  const v = { connId: "", campaignId: cid, role: "player" as const, playerId: actor.playerId };
  const seen = templateVisibility(t, v) !== "hidden" && activeSceneOf(tx, cid)?.id === t.sceneId;
  if (!seen) throw notFound("Template not found");
  if (t.placedByPlayerId !== actor.playerId) throw forbidden("Not your template");
  return t;
}

const countOn = (tx: Tx, sceneId: string, placedByPlayerId?: string): number =>
  tx
    .select({ n: count() })
    .from(aoeTemplate)
    .where(
      placedByPlayerId === undefined
        ? eq(aoeTemplate.sceneId, sceneId)
        : and(eq(aoeTemplate.sceneId, sceneId), eq(aoeTemplate.placedByPlayerId, placedByPlayerId)),
    )
    .get()?.n ?? 0;

/** FR-SCN-25 (fixtures): a DM-set placer must be a player of the campaign. */
function assertPlayerOf(tx: Tx, cid: string, playerId: string): void {
  const row = tx
    .select({ id: player.id })
    .from(player)
    .where(and(eq(player.id, playerId), eq(player.campaignId, cid)))
    .get();
  if (!row) {
    throw invalid("Placer must be a player of this campaign", [
      { path: ["placedByPlayerId"], message: "Not a player of this campaign" },
    ]);
  }
}

/** FR-SCN-25: Keep → a kept template (`hidden` = the ephemeral's `dmOnly`, DM only). */
export const placeTemplate = defineCommand({
  name: SCN_INTENTS.placeTemplate,
  input: PlaceTemplateInput,
  roles: ["dm", "player"],
  authorize(input, { tx, actor }) {
    refuseDmFields(actor, input, ["hidden", "placedByPlayerId"]);
    assertActiveForPlayer(tx, actor, input.sceneId);
  },
  execute(input, env: CommandEnv): { templateId: string } {
    const { tx, ctx, actor, emit } = env;
    const cid = campaignOf(actor);
    const s = getScene(tx, cid, input.sceneId);
    const placedBy =
      actor.role === "player" ? (actor.playerId ?? null) : (input.placedByPlayerId ?? null);
    if (actor.role !== "player" && placedBy !== null) assertPlayerOf(tx, cid, placedBy);
    if (countOn(tx, s.id) >= TEMPLATES_PER_SCENE_MAX) {
      throw conflict(`A scene holds at most ${TEMPLATES_PER_SCENE_MAX} kept templates`);
    }
    if (placedBy !== null && countOn(tx, s.id, placedBy) >= TEMPLATES_PER_PLAYER_MAX) {
      throw conflict(`At most ${TEMPLATES_PER_PLAYER_MAX} kept templates per player on a scene`);
    }
    const geometry: TemplateGeometry = {
      shape: input.shape,
      x: input.x,
      y: input.y,
      size: input.size,
      width: widthFor(input.shape, input.width),
      angle: input.angle,
    };
    const copies = templateCopies(tx, s, geometry, placedBy);
    const id = ctx.ids.next();
    const now = ctx.clock.iso();
    tx.insert(aoeTemplate)
      .values({
        id,
        campaignId: cid,
        sceneId: s.id,
        seq: aoeTemplateSeqNext,
        shape: geometry.shape,
        x: geometry.x,
        y: geometry.y,
        size: geometry.size,
        width: geometry.width ?? null,
        angle: geometry.angle,
        label: input.label ?? "",
        placedByPlayerId: placedBy,
        hidden: actor.role === "player" ? false : (input.hidden ?? false),
        ...copies,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const after = readTemplate(tx, id) as AoeTemplateRecord;
    emit({
      type: TemplatePlaced.type,
      campaignId: cid,
      payload: { templateId: id },
      changes: [change(null, after)],
    });
    return { templateId: id };
  },
});

/** FR-SCN-26: move / rotate / resize / relabel (placer or DM); `hidden` DM only. */
export const updateTemplate = defineCommand({
  name: SCN_INTENTS.updateTemplate,
  input: UpdateTemplateInput,
  roles: ["dm", "player"],
  authorize(input, { tx, actor }) {
    getEditable(tx, actor, input.templateId);
    refuseDmFields(actor, input, ["hidden"]);
  },
  execute(input, { tx, ctx, actor, emit }): void {
    const before = getEditable(tx, actor, input.templateId);
    const geometry: TemplateGeometry = {
      shape: before.shape,
      x: input.x ?? before.x,
      y: input.y ?? before.y,
      size: input.size ?? before.size,
      width: widthFor(before.shape, input.width ?? before.width),
      angle: input.angle ?? before.angle,
    };
    const label = input.label ?? before.label;
    const hidden = input.hidden ?? before.hidden;
    const same =
      geometry.x === before.x &&
      geometry.y === before.y &&
      geometry.size === before.size &&
      geometry.width === before.width &&
      geometry.angle === before.angle &&
      label === before.label &&
      hidden === before.hidden;
    if (same) return;
    const s = getScene(tx, before.campaignId, before.sceneId);
    const copies = templateCopies(tx, s, geometry, before.placedByPlayerId);
    tx.update(aoeTemplate)
      .set({
        x: geometry.x,
        y: geometry.y,
        size: geometry.size,
        width: geometry.width ?? null,
        angle: geometry.angle,
        label,
        hidden,
        ...copies,
        updatedAt: ctx.clock.iso(),
      })
      .where(eq(aoeTemplate.id, before.id))
      .run();
    emit({
      type: TemplateUpdated.type,
      campaignId: before.campaignId,
      payload: { templateId: before.id },
      changes: [change(before, readTemplate(tx, before.id))],
    });
  },
});

/** FR-SCN-26: Delete (placer or DM). */
export const deleteTemplate = defineCommand({
  name: SCN_INTENTS.deleteTemplate,
  input: TemplateIdInput,
  roles: ["dm", "player"],
  authorize({ templateId }, { tx, actor }) {
    getEditable(tx, actor, templateId);
  },
  execute({ templateId }, { tx, actor, emit }): void {
    const before = getEditable(tx, actor, templateId);
    tx.delete(aoeTemplate).where(eq(aoeTemplate.id, templateId)).run();
    emit({
      type: TemplateDeleted.type,
      campaignId: before.campaignId,
      payload: { templateId },
      changes: [change(before, null)],
    });
  },
});

/** FR-SCN-26: the DM's "Clear templates" (every kept template of the scene). None → no event. */
export const clearTemplates = defineCommand({
  name: SCN_INTENTS.clearTemplates,
  input: ClearTemplatesInput,
  execute({ sceneId }, { tx, actor, emit }): void {
    const cid = campaignOf(actor);
    const s = getScene(tx, cid, sceneId);
    const all = sceneTemplates(tx, s.id);
    if (all.length === 0) return;
    tx.delete(aoeTemplate).where(eq(aoeTemplate.sceneId, s.id)).run();
    emit({
      type: TemplatesCleared.type,
      campaignId: cid,
      payload: { sceneId: s.id, templateIds: all.map((t) => t.id) },
      changes: all.map((t) => change(t, null)),
    });
  },
});

/**
 * FR-SCN-24 (ADR-0033): `scn.template` routing, read-only. Player: the active scene only (else
 * `invalid`), never `dmOnly`, then `"all"` (player templates are never fog-hidden). DM: the
 * scene must be the campaign's (else `not_found`); `"dm"` if `dmOnly` or if the scene isn't
 * active; else the players who would see a DM template over those uncut cells (FR-FOG-15:
 * `derive`'s `seenBy`; nobody → `"dm"`; no hook → `"all"`). An `end` frame carries no
 * geometry and routes `"all"`, except for a non-active scene (`"dm"`: SCN §13 leak list, no
 * `scn.template` from a non-active scene reaches a player).
 */
export function templateAudience(
  data: TemplateSignalData,
  sender: SignalSender,
  read: SignalRead,
): SignalAudience {
  const active = read.activeSceneOf(sender.campaignId);
  if (sender.role === "player") {
    if (data.sceneId !== active) {
      throw invalid("Not the scene players see", [{ path: ["sceneId"], message: "Not active" }]);
    }
    if (!("end" in data) && data.dmOnly !== undefined) {
      throw invalid("Invalid input", [{ path: ["dmOnly"], message: "Not allowed for players" }]);
    }
    return "all";
  }
  const s = read.db
    .select()
    .from(scene)
    .where(and(eq(scene.id, data.sceneId), eq(scene.campaignId, sender.campaignId)))
    .get();
  if (!s) throw notFound("Scene not found");
  if (data.sceneId !== active) return "dm";
  if ("end" in data) return "all";
  if (data.dmOnly) return "dm";
  const { seenBy } = templateCopies(read.db, s, data, null);
  if (seenBy === null) return "all";
  return seenBy.length === 0 ? "dm" : { players: seenBy };
}

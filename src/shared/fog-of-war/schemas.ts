// Fog of war wire shapes (FOG §8, §9; protocol §5). The mask codec and raster live beside this
// (`mask.ts`, `raster.ts`); visibility of fog subjects in `visibility.ts`.
import { z } from "zod";
import {
  DarknessShape,
  FogBrushGeom,
  FogLayerShape,
  FogShapeGeom,
  isDec2,
  SHAPE_COORD_MAX,
} from "./shapes";

export const FOG_TYPE = "fog";
/** FR-FOG-37: explored memory, one per (scene, player); `dmWindow: "view-as"` (FR-FOG-43). */
export const FOG_EXPLORED_TYPE = "fog-explored";
/** FR-FOG-39: derived per (scene, player), no table; `dmWindow: "view-as"` (FR-FOG-43). */
export const VISION_TYPE = "vision";
/** FR-FOG-49 (sprint 4): the campaign's fog settings (party vision), campaign scope. */
export const FOG_SETTINGS_TYPE = "fog-settings";

/** FR-FOG-01: value of every cell outside the box (and of every box cell when `runs` is ""). */
export const FOG_FILLS = ["fog", "clear"] as const;
export const FogFill = z.enum(FOG_FILLS);
export type FogFill = z.infer<typeof FogFill>;

/** FR-FOG-03: box ≤ 513 × 513 cells. */
export const FOG_BOX_MAX = 513;
/** FR-FOG-04 (OQ-FOG-19): ≤ 2,000 runs per scene. */
export const FOG_RUNS_MAX = 2000;
/** FR-FOG-07 (sprint 4, OQ-FOG-53): ≤ 50 undo entries per scene (was 20). */
export const FOG_UNDO_MAX = 50;
/** FR-FOG-05 / FOG §9: polygon 3–64 vertices; every coordinate |v| ≤ 1,024. */
export const FOG_VERTICES_MIN = 3;
export const FOG_VERTICES_MAX = 64;
export const FOG_COORD_MAX = 1024;

/** `[col0, row0, cols, rows]` (FR-FOG-03). */
export const FogBox = z.tuple([
  z.number().int(),
  z.number().int(),
  z.number().int().min(0).max(FOG_BOX_MAX),
  z.number().int().min(0).max(FOG_BOX_MAX),
]);
export type FogBox = z.infer<typeof FogBox>;

/** Undo stack entry kinds (`scene_fog_edit.kind`, FOG §8). */
export const FOG_EDIT_KINDS = [
  "reveal-rect",
  "reveal-polygon",
  "hide-rect",
  "hide-polygon",
  "reveal-all",
  "fog-all",
  // FOG v2 (FR-FOG-05 / -30, FOG §8): shape and darkness edits.
  "reveal-shape",
  "fog-shape",
  "explored-shape",
  "darkness-place",
  "darkness-move",
  "darkness-remove",
  "darkness-clear",
] as const;
export const FogEditKind = z.enum(FOG_EDIT_KINDS);
export type FogEditKind = z.infer<typeof FogEditKind>;

const Coord = z.number().int().min(-FOG_COORD_MAX).max(FOG_COORD_MAX);

/** FR-FOG-05: cells c0…c1 × r0…r1 inclusive (normalised by the raster). */
export const FogRect = z.strictObject({
  kind: z.literal("rect"),
  c0: Coord,
  r0: Coord,
  c1: Coord,
  r1: Coord,
});
export type FogRect = z.infer<typeof FogRect>;

/** FR-FOG-05: vertices on grid corners; crossing edges / zero area are refused by the raster. */
export const FogPolygon = z.strictObject({
  kind: z.literal("polygon"),
  points: z
    .array(z.tuple([Coord, Coord]))
    .min(FOG_VERTICES_MIN)
    .max(FOG_VERTICES_MAX),
});
export type FogPolygon = z.infer<typeof FogPolygon>;

export const FogShape = z.discriminatedUnion("kind", [FogRect, FogPolygon]);
export type FogShape = z.infer<typeof FogShape>;

/** FR-FOG-05: `reveal | fog | explored`; legacy `hide` = `fog`. */
export const FogOp = z.enum(["reveal", "fog", "explored", "hide"]);
export type FogOp = z.infer<typeof FogOp>;

/**
 * DM wire: the latest undo entry and the stack depth, or null when empty. `redo` (FR-FOG-56): the
 * most recently undone entry and the redo depth, absent when nothing can be redone.
 */
export const FogUndoInfo = z.object({
  n: z.number().int().min(1).max(FOG_UNDO_MAX),
  editId: z.string(),
  kind: FogEditKind,
});
export type FogUndoInfo = z.infer<typeof FogUndoInfo>;

/** FR-FOG-56: a fog row's base mask `{fill, box, runs}` (`scene_fog_edit.nextBase`). */
export const FogBaseState = z.object({ fill: FogFill, box: FogBox, runs: z.string() });
export type FogBaseState = z.infer<typeof FogBaseState>;

/** FR-SCN-36 (sprint 3): `scene-structure.doorSeen`, door `n` → player ids. Server only. */
export type DoorSeen = Record<string, string[]>;

/**
 * `fog` (scope scene, `sceneOf = id` = the scene id), DM view (FOG §9): base mask + shapes +
 * darkness (never `seenBy`) + the Explored setting + undo info. `dmWindow` (OQ-FOG-30 B).
 */
export const FogRecord = z.object({
  id: z.string(),
  campaignId: z.string(),
  fill: FogFill,
  box: FogBox,
  runs: z.string(),
  shapes: z.array(FogLayerShape),
  darkness: z.array(DarknessShape),
  explored: z.boolean(),
  undo: FogUndoInfo.nullable(),
  redo: FogUndoInfo.optional(),
});
export type FogRecord = z.infer<typeof FogRecord>;

/**
 * What a player receives (redacted: no campaign, no undo; `darkness` = only the shapes the
 * viewer is in `seenBy` of, FR-FOG-44).
 */
export const PlayerFogRecord = z.object({
  id: z.string(),
  fill: FogFill,
  box: FogBox,
  runs: z.string(),
  shapes: z.array(FogLayerShape),
  darkness: z.array(DarknessShape),
  explored: z.boolean(),
});
export type PlayerFogRecord = z.infer<typeof PlayerFogRecord>;

/** Wire id of a per-(scene, player) row: `sceneId:playerId` (FR-FOG-37 / -39). */
export const scenePlayerId = (sceneId: string, playerId: string) => `${sceneId}:${playerId}`;

/** `fog-explored` (FR-FOG-37): the player's explored cells; full to that player only. */
export const FogExploredRecord = z.object({
  id: z.string(),
  sceneId: z.string(),
  playerId: z.string(),
  box: FogBox,
  runs: z.string(),
});
export type FogExploredRecord = z.infer<typeof FogExploredRecord>;

/**
 * `vision` (FR-FOG-39, derived): the player's rounded, simplified sight polygons, flat
 * `[x, y, …]`; `inv` = indices into `see ++ dark` of the polygons whose source sees invisible
 * (omitted when empty; never in another player's copy, FR-FOG-51); `src` (sprint 4) = the source
 * token id of each polygon of `see ++ dark`.
 */
export const VisionRecord = z.object({
  id: z.string(),
  sceneId: z.string(),
  playerId: z.string(),
  blind: z.boolean(),
  see: z.array(z.array(z.number())),
  dark: z.array(z.array(z.number())),
  inv: z.array(z.number().int().min(0)).optional(),
  src: z.array(z.string()),
});
export type VisionRecord = z.infer<typeof VisionRecord>;

/**
 * FR-FOG-53 (sprint 4): signal `fog.sight` (server-originated, OQ-FOG-58): a dragged source's
 * polygons at the previewed cell (rounded, simplified, FR-FOG-33); map sight only, no records.
 */
export const FOG_SIGNALS = { sight: "fog.sight" } as const;
export const FogSightPayload = z.object({
  sceneId: z.string(),
  tokenId: z.string(),
  see: z.array(z.array(z.number())),
  dark: z.array(z.array(z.number())),
});
export type FogSightPayload = z.infer<typeof FogSightPayload>;

/** `fog-settings` (FR-FOG-49): id = the campaign id; every viewer full; no row = off. */
export const FogSettingsRecord = z.object({ id: z.string(), partyVision: z.boolean() });
export type FogSettingsRecord = z.infer<typeof FogSettingsRecord>;

/** WS intents (FOG §9; DM only, ADR-0021 D). */
export const FOG_INTENTS = {
  edit: "fog.edit",
  setAll: "fog.setAll",
  undo: "fog.undo",
  placeDarkness: "fog.placeDarkness",
  moveDarkness: "fog.moveDarkness",
  removeDarkness: "fog.removeDarkness",
  clearDarkness: "fog.clearDarkness",
  setExplored: "fog.setExplored",
  forgetExplored: "fog.forgetExplored",
  setInvisible: "fog.setInvisible",
  setPartyVision: "fog.setPartyVision",
  redo: "fog.redo",
} as const;

const Id = z.string().min(1).max(64);

/**
 * FR-FOG-05: append one fog shape (v2 geometry, a brush `stroke` / `cells` (sprint 4, FR-FOG-26),
 * or a sprint-2 legacy form).
 */
export const FogEditInput = z.strictObject({
  sceneId: Id,
  op: FogOp,
  shape: z.union([FogShapeGeom, FogBrushGeom, FogShape]),
});
export type FogEditInput = z.input<typeof FogEditInput>;

/** FR-FOG-06: Fog all (`fogged: true`) / Reveal all (`false`). */
export const FogSetAllInput = z.strictObject({ sceneId: Id, fogged: z.boolean() });
export type FogSetAllInput = z.input<typeof FogSetAllInput>;

/** FR-FOG-07: undo the latest edit, guarded by its id. */
export const FogUndoInput = z.strictObject({ sceneId: Id, expectedEditId: Id });
export type FogUndoInput = z.input<typeof FogUndoInput>;

/** FR-FOG-56: redo the most recently undone edit, guarded by its id. */
export const FogRedoInput = z.strictObject({ sceneId: Id, expectedEditId: Id });
export type FogRedoInput = z.input<typeof FogRedoInput>;
export const FogRedoResult = z.object({ editId: z.string() });
export type FogRedoResult = z.infer<typeof FogRedoResult>;

/** `fog.edit` / `fog.setAll` / darkness ack: the new undo entry, or null on a no-op. */
export const FogEditResult = z.object({ editId: z.string().nullable() });
export type FogEditResult = z.infer<typeof FogEditResult>;

const DarknessId = z.string().min(1).max(64);
/** FR-FOG-30: a move in grid units (≤ 2 decimals); the moved shape must stay within ±1,024. */
const Delta = z
  .number()
  .min(-2 * SHAPE_COORD_MAX)
  .max(2 * SHAPE_COORD_MAX)
  .refine(isDec2, "At most 2 decimals");

/** FR-FOG-30: `fog.placeDarkness`. */
export const FogPlaceDarknessInput = z.strictObject({ sceneId: Id, shape: FogShapeGeom });
export type FogPlaceDarknessInput = z.input<typeof FogPlaceDarknessInput>;
export const FogPlaceDarknessResult = z.object({ darknessId: z.string(), editId: z.string() });
export type FogPlaceDarknessResult = z.infer<typeof FogPlaceDarknessResult>;

/** FR-FOG-30: `fog.moveDarkness` (translate). */
export const FogMoveDarknessInput = z.strictObject({
  sceneId: Id,
  darknessId: DarknessId,
  dx: Delta,
  dy: Delta,
});
export type FogMoveDarknessInput = z.input<typeof FogMoveDarknessInput>;

/** FR-FOG-30: `fog.removeDarkness`. */
export const FogRemoveDarknessInput = z.strictObject({ sceneId: Id, darknessId: DarknessId });
export type FogRemoveDarknessInput = z.input<typeof FogRemoveDarknessInput>;

/** FR-FOG-30: `fog.clearDarkness`. */
export const FogClearDarknessInput = z.strictObject({ sceneId: Id });
export type FogClearDarknessInput = z.input<typeof FogClearDarknessInput>;

/** FR-FOG-29: `fog.setExplored` (Explored memory on / off for the scene). */
export const FogSetExploredInput = z.strictObject({ sceneId: Id, on: z.boolean() });
export type FogSetExploredInput = z.input<typeof FogSetExploredInput>;

/** FR-FOG-31: `fog.forgetExplored`. */
export const FogForgetExploredInput = z.strictObject({ sceneId: Id });
export type FogForgetExploredInput = z.input<typeof FogForgetExploredInput>;

/** FR-FOG-45 (#210): the DM-only Invisible token state; same value → no-op. */
export const FogSetInvisibleInput = z.strictObject({ tokenId: Id, invisible: z.boolean() });
export type FogSetInvisibleInput = z.input<typeof FogSetInvisibleInput>;

/** FR-FOG-49 (sprint 4): the campaign's party vision switch (DM); same value → no-op. */
export const FogSetPartyVisionInput = z.strictObject({ on: z.boolean() });
export type FogSetPartyVisionInput = z.input<typeof FogSetPartyVisionInput>;

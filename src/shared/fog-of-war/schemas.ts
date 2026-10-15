// Fog of war wire shapes (FOG §8, §9; protocol §5). The mask codec and raster live beside this
// (`mask.ts`, `raster.ts`); visibility of fog subjects in `visibility.ts`.
import { z } from "zod";

export const FOG_TYPE = "fog";

/** FR-FOG-01: value of every cell outside the box (and of every box cell when `runs` is ""). */
export const FOG_FILLS = ["fog", "clear"] as const;
export const FogFill = z.enum(FOG_FILLS);
export type FogFill = z.infer<typeof FogFill>;

/** FR-FOG-03: box ≤ 513 × 513 cells. */
export const FOG_BOX_MAX = 513;
/** FR-FOG-04 (OQ-FOG-19): ≤ 2,000 runs per scene. */
export const FOG_RUNS_MAX = 2000;
/** FR-FOG-07 (OQ-FOG-08): ≤ 20 undo entries per scene. */
export const FOG_UNDO_MAX = 20;
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

export const FogOp = z.enum(["reveal", "hide"]);
export type FogOp = z.infer<typeof FogOp>;

/** DM wire: the latest undo entry and the stack depth, or null when empty. */
export const FogUndoInfo = z.object({
  n: z.number().int().min(1).max(FOG_UNDO_MAX),
  editId: z.string(),
  kind: FogEditKind,
});
export type FogUndoInfo = z.infer<typeof FogUndoInfo>;

/** `fog` (scope scene, `sceneOf = id` = the scene id), DM view. Never windowed (ADR-0041). */
export const FogRecord = z.object({
  id: z.string(),
  campaignId: z.string(),
  fill: FogFill,
  box: FogBox,
  runs: z.string(),
  undo: FogUndoInfo.nullable(),
});
export type FogRecord = z.infer<typeof FogRecord>;

/** What a player receives (redacted: no campaign, no undo). */
export const PlayerFogRecord = z.object({
  id: z.string(),
  fill: FogFill,
  box: FogBox,
  runs: z.string(),
});
export type PlayerFogRecord = z.infer<typeof PlayerFogRecord>;

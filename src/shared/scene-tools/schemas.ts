// Scene-tools wire shapes (SCN §8, §9; protocol §36): record types, intent payloads, the
// ephemeral template signal and the limits. Geometry (cells, segments, blocking, distance) lives
// beside this in `geometry.ts`. Everything is in grid units: vertices `(x, y)`, cells
// `(col, row)`, 1 cell = 5 ft.
import { z } from "zod";

export const SCENE_STRUCTURE_TYPE = "scene-structure";
export const SCENE_PROP_TYPE = "scene-prop";
export const AOE_TEMPLATE_TYPE = "aoe-template";
export const MAP_SETTINGS_TYPE = "map-settings";

export const SCN_INTENTS = {
  addWalls: "scn.addWalls",
  addDoor: "scn.addDoor",
  setDoor: "scn.setDoor",
  removeSegments: "scn.removeSegments",
  placeProp: "scn.placeProp",
  updateProp: "scn.updateProp",
  setPropHidden: "scn.setPropHidden",
  duplicateProp: "scn.duplicateProp",
  deleteProp: "scn.deleteProp",
  placeTemplate: "scn.placeTemplate",
  updateTemplate: "scn.updateTemplate",
  deleteTemplate: "scn.deleteTemplate",
  clearTemplates: "scn.clearTemplates",
  setDiagonalRule: "scn.setDiagonalRule",
} as const;

export const SCN_SIGNALS = { template: "scn.template" } as const;

/** FR-SCN-38: the wall move guard's name, the `guard` of its `map.checkMove` hint. */
export const WALL_GUARD = "scene-tools.walls";

// ---------- limits (FR-SCN-07, -08, -16, -17, -20, -25) ----------

/** FR-SCN-07: walls + doors per scene. */
export const SEGMENTS_MAX = 2000;
/** FR-SCN-08: segments per `scn.addWalls`. */
export const ADD_WALLS_MAX = 200;
/** SCN §9: `n`s per `scn.removeSegments`. */
export const REMOVE_SEGMENTS_MAX = 500;
/** FR-SCN-16. */
export const PROPS_PER_SCENE_MAX = 200;
export const PROPS_PER_CAMPAIGN_MAX = 2000;
/** FR-SCN-17 (OQ-SCN-10): 1–20 cells per side. */
export const PROP_SIDE_MIN = 1;
export const PROP_SIDE_MAX = 20;
/** FR-SCN-25. */
export const TEMPLATES_PER_SCENE_MAX = 20;
export const TEMPLATES_PER_PLAYER_MAX = 3;
/** FR-SCN-22: label 0–40 chars. */
export const TEMPLATE_LABEL_MAX = 40;
/**
 * FR-SCN-20: `size` 5–300 ft, `width` 5–60 ft, both step 5. `angle` (sprint 4): 0 ≤ a < 360
 * (`max` exclusive), ≤ 1 decimal; `step` = the snapped steps (FR-SCN-43).
 */
export const TEMPLATE_SIZE = { min: 5, max: 300, step: 5 } as const;
export const TEMPLATE_WIDTH = { min: 5, max: 60, step: 5, default: 5 } as const;
export const TEMPLATE_ANGLE = { min: 0, max: 360, step: 15 } as const;
/** Grid coordinates on the wire; commands check the map's range (FR-SCN-07, -16). */
export const COORD_MAX = 10_000;

/** 1 cell = 5 ft. */
export const FT_PER_CELL = 5;

// ---------- leaves ----------

const Id = z.string().min(1).max(64);
const Int = z.number().int();
const Coord = Int.min(-COORD_MAX).max(COORD_MAX);

/** FR-SCN-07 (sprint 3): a number with at most 2 decimals (1/100 cell). */
export const isDec2 = (v: number) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6;
/** FR-SCN-20 (sprint 4): a number with at most 1 decimal (a template angle). */
export const isDec1 = (v: number) => Math.abs(Math.round(v * 10) - v * 10) < 1e-6;
/**
 * FR-SCN-07 (sprint 3): segment coordinates are numbers with ≤ 2 decimals; integers stay valid.
 * Sprint 4 (FR-SCN-20): also a template origin.
 */
const SegCoord = z.number().min(-COORD_MAX).max(COORD_MAX).refine(isDec2, "At most 2 decimals");

/** FR-SCN-07: door state 0 open / 1 closed / 2 locked (DM marker). */
export const DOOR_OPEN = 0;
export const DOOR_CLOSED = 1;
export const DOOR_LOCKED = 2;
export const DoorState = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export type DoorState = z.infer<typeof DoorState>;
export const DOOR_STATE_NAMES = ["open", "closed", "locked"] as const;

/** A segment point to point: `[x1, y1, x2, y2]` (≤ 2 decimals, sprint 3). */
export const Segment = z.tuple([SegCoord, SegCoord, SegCoord, SegCoord]);
export type Segment = z.infer<typeof Segment>;

const SegmentN = Int.min(1);
/** Wall `[n, x1, y1, x2, y2]` (JSON leaf). */
export const Wall = z.tuple([SegmentN, SegCoord, SegCoord, SegCoord, SegCoord]);
export type Wall = z.infer<typeof Wall>;
/** Door `[n, x1, y1, x2, y2, state, f]`; `f` = server-written fog flag (FR-SCN-36). */
export const Door = z.tuple([
  SegmentN,
  SegCoord,
  SegCoord,
  SegCoord,
  SegCoord,
  DoorState,
  z.union([z.literal(0), z.literal(1)]),
]);
export type Door = z.infer<typeof Door>;
/** Player door `[n, x1, y1, x2, y2, open]`: 1 = open, 0 = closed (locked is sent as closed). */
export const PlayerDoor = z.tuple([
  SegmentN,
  SegCoord,
  SegCoord,
  SegCoord,
  SegCoord,
  z.union([z.literal(0), z.literal(1)]),
]);
export type PlayerDoor = z.infer<typeof PlayerDoor>;

/** FR-SCN-17: 90° steps. */
export const PropRotation = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
export type PropRotation = z.infer<typeof PropRotation>;
const PropSide = Int.min(PROP_SIDE_MIN).max(PROP_SIDE_MAX);

export const TEMPLATE_SHAPES = ["cone", "sphere", "cylinder", "cube", "line"] as const;
export const TemplateShape = z.enum(TEMPLATE_SHAPES);
export type TemplateShape = z.infer<typeof TemplateShape>;

const stepped = (r: { min: number; max: number; step: number }) =>
  Int.min(r.min)
    .max(r.max)
    .refine((v) => v % r.step === 0, `Must be a multiple of ${r.step}`);
export const TemplateSize = stepped(TEMPLATE_SIZE);
export const TemplateWidth = stepped(TEMPLATE_WIDTH);
/** FR-SCN-20 (sprint 4): 0 ≤ angle < 360, ≤ 1 decimal (old 15° rows stay valid). */
export const TemplateAngle = z
  .number()
  .min(TEMPLATE_ANGLE.min)
  .lt(TEMPLATE_ANGLE.max)
  .refine(isDec1, "At most 1 decimal");
/** FR-SCN-20 (sprint 4): a template origin, any point with ≤ 2 decimals. */
export const TemplateCoord = SegCoord;
/**
 * DM #377: a snapped sphere / cylinder's origin block, in cells per side: 1 = the square its
 * origin is the centre of, 2–4 = a Large / Huge / Gargantuan token's footprint (FR-MAP-14) centred
 * on the origin. Its squares are those within its radius by grid distance (FR-MAP-22, 5/10/5) of
 * the block, the block included. Absent = the exact > 50 % rule (FR-SCN-41).
 */
export const TemplateFootprint = Int.min(1).max(4);

const isInt = (v: number) => Math.abs(v - Math.round(v)) < 1e-9;

/**
 * #377: a footprint fits a sphere / cylinder whose origin is the centre of an n × n block of
 * cells (`x − n / 2`, `y − n / 2` whole); anything else → the issue's message, else null.
 */
export function footprintProblem(t: {
  shape: TemplateShape;
  x: number;
  y: number;
  footprint?: number | null;
}): string | null {
  const n = t.footprint;
  if (n === undefined || n === null) return null;
  if (t.shape !== "sphere" && t.shape !== "cylinder") return "Sphere or cylinder only";
  return isInt(t.x - n / 2) && isInt(t.y - n / 2) ? null : "Origin is not the block's centre";
}

const footprintFits = (
  t: { shape: TemplateShape; x: number; y: number; footprint?: number | null },
  ctx: z.RefinementCtx,
) => {
  const message = footprintProblem(t);
  if (message) ctx.addIssue({ code: "custom", path: ["footprint"], message });
};
export const TemplateLabel = z.string().max(TEMPLATE_LABEL_MAX);

/** FR-SCN-29 (#145, OQ-SCN-04): 5/10/5 (default) or 5 ft per diagonal step. */
export const DIAGONAL_RULES = ["5-10-5", "5"] as const;
export const DiagonalRule = z.enum(DIAGONAL_RULES);
export type DiagonalRule = z.infer<typeof DiagonalRule>;
export const DEFAULT_DIAGONAL_RULE: DiagonalRule = "5-10-5";

// ---------- record types (SCN §9) ----------
// Compact wire: no timestamps. `campaignId` stays (the registry's scope gate reads it from the
// record); the player redactions of structure and props drop it. `fogged` only when true.

/** `scene-structure` (scope scene, `sceneOf = id` = the scene id), DM view. No row = empty. */
export const SceneStructureRecord = z.object({
  id: z.string(),
  campaignId: z.string(),
  rev: Int.min(0),
  nextN: Int.min(1),
  walls: z.array(Wall),
  doors: z.array(Door),
  /** FR-SCN-36 (sprint 3): FOG-written `{<n>: playerId[]}`; server only, never on a wire. */
  doorSeen: z.record(z.string(), z.array(z.string())).nullable().optional(),
});
export type SceneStructureRecord = z.infer<typeof SceneStructureRecord>;

/** What a player receives: doors only, never walls; `f = 1` doors dropped (FR-SCN-14). */
export const PlayerSceneStructureRecord = z.object({
  id: z.string(),
  doors: z.array(PlayerDoor),
});
export type PlayerSceneStructureRecord = z.infer<typeof PlayerSceneStructureRecord>;

const propFields = {
  id: z.string(),
  sceneId: z.string(),
  /** Draw order after `z` (FR-SCN-18). */
  seq: Int,
  assetId: z.string(),
  col: Int,
  row: Int,
  w: PropSide,
  h: PropSide,
  rotation: PropRotation,
  z: Int,
  hidden: z.boolean(),
  /** Server copy (FR-SCN-35); on the wire only when true. */
  fogged: z.literal(true).optional(),
};

/** `scene-prop` (scope scene, `sceneOf = sceneId`), DM view. */
export const ScenePropRecord = z.object({
  ...propFields,
  campaignId: z.string(),
  locked: z.boolean(),
  /** FR-FOG-10 (ADR-0042): server copy, player ids; never on a wire. */
  seenBy: z.array(z.string()).nullable().optional(),
});
export type ScenePropRecord = z.infer<typeof ScenePropRecord>;

/** What a player receives of a visible prop: no campaign, no `locked` (FR-SCN-19). */
export const PlayerScenePropRecord = z.object(propFields);
export type PlayerScenePropRecord = z.infer<typeof PlayerScenePropRecord>;

/** Fields both clients render a prop from. */
export type PropView = PlayerScenePropRecord & { locked?: boolean };

/** `aoe-template` (scope scene, `sceneOf = sceneId`): persistent (kept) templates only. */
export const AoeTemplateRecord = z.object({
  id: z.string(),
  campaignId: z.string(),
  sceneId: z.string(),
  shape: TemplateShape,
  /** Origin point, ≤ 2 decimals (sprint 4; a vertex when snapped). */
  x: TemplateCoord,
  y: TemplateCoord,
  size: Int,
  /** Line only, else null. */
  width: Int.nullable(),
  /** 0 ≤ angle < 360, ≤ 1 decimal (sprint 4). */
  angle: TemplateAngle,
  /** #377: the snapped origin block (sphere / cylinder); absent = the exact rule. */
  footprint: TemplateFootprint.optional(),
  label: z.string(),
  /** Null = DM-placed (a fog subject); a player's are never fog-hidden (FR-SCN-27). */
  placedByPlayerId: z.string().nullable(),
  hidden: z.boolean(),
  fogged: z.literal(true).optional(),
  /** FR-FOG-10 (ADR-0042): server copy, player ids; never on a wire. */
  seenBy: z.array(z.string()).nullable().optional(),
});
export type AoeTemplateRecord = z.infer<typeof AoeTemplateRecord>;

/** What a player receives of a visible template: no campaign (SCN §8 compact wire). */
export const PlayerAoeTemplateRecord = AoeTemplateRecord.omit({ campaignId: true, seenBy: true });
export type PlayerAoeTemplateRecord = z.infer<typeof PlayerAoeTemplateRecord>;

/** Fields both clients render a kept template from. */
export type TemplateRecordView = PlayerAoeTemplateRecord & { campaignId?: string };

/** `map-settings` (scope campaign, `id` = campaignId): everyone receives it (FR-SCN-29). */
export const MapSettingsRecord = z.object({
  id: z.string(),
  diagonalRule: DiagonalRule,
});
export type MapSettingsRecord = z.infer<typeof MapSettingsRecord>;

// ---------- template geometry input (FR-SCN-20) ----------

/** What `templateCells` reads: the stored fields of a kept or ephemeral template. */
export interface TemplateGeometry {
  shape: TemplateShape;
  x: number;
  y: number;
  size: number;
  width?: number | null;
  angle: number;
  /** #377: a snapped sphere / cylinder's origin block (cells per side); absent = exact rule. */
  footprint?: number | null;
}

// ---------- WS intent payloads (SCN §9) ----------

export const AddWallsInput = z.strictObject({
  sceneId: Id,
  segments: z.array(Segment).min(1).max(ADD_WALLS_MAX),
});
export type AddWallsInput = z.input<typeof AddWallsInput>;
export const AddDoorInput = z.strictObject({
  sceneId: Id,
  segment: Segment,
  /** Default closed (FR-SCN-08). */
  state: DoorState.optional(),
});
export type AddDoorInput = z.input<typeof AddDoorInput>;
export const SetDoorInput = z.strictObject({ sceneId: Id, n: SegmentN, state: DoorState });
export const RemoveSegmentsInput = z.strictObject({
  sceneId: Id,
  ns: z.array(SegmentN).min(1).max(REMOVE_SEGMENTS_MAX),
});
/**
 * `scn.addWalls` ack: one `n` per input segment, in order; a segment identical to one already
 * there (or earlier in the batch) gets that one's `n` (FR-SCN-07 dedupe). Undo remaps by position.
 */
export const AddWallsResult = z.object({ ns: z.array(SegmentN) });
export type AddWallsResult = z.infer<typeof AddWallsResult>;
/**
 * `scn.addDoor` ack. FR-SCN-56, only when the door replaced wall: the walls as they were and the
 * `n`s of the pieces left of them, for undo.
 */
export const AddDoorResult = z.object({
  n: SegmentN,
  replaced: z.array(Wall).optional(),
  pieces: z.array(SegmentN).optional(),
});
export type AddDoorResult = z.infer<typeof AddDoorResult>;

export const PlacePropInput = z.strictObject({
  sceneId: Id,
  assetId: Id,
  col: Coord,
  row: Coord,
  w: PropSide.optional(),
  h: PropSide.optional(),
  hidden: z.boolean().optional(),
});
export type PlacePropInput = z.input<typeof PlacePropInput>;
export const UpdatePropInput = z.strictObject({
  propId: Id,
  col: Coord.optional(),
  row: Coord.optional(),
  w: PropSide.optional(),
  h: PropSide.optional(),
  rotation: PropRotation.optional(),
  z: Int.min(-COORD_MAX).max(COORD_MAX).optional(),
  locked: z.boolean().optional(),
  assetId: Id.optional(),
});
export type UpdatePropInput = z.input<typeof UpdatePropInput>;
export const SetPropHiddenInput = z.strictObject({ propId: Id, hidden: z.boolean() });
export const PropIdInput = z.strictObject({ propId: Id });

const templateFields = {
  sceneId: Id,
  shape: TemplateShape,
  x: TemplateCoord,
  y: TemplateCoord,
  size: TemplateSize,
  width: TemplateWidth.optional(),
  angle: TemplateAngle,
  /** #377 (sphere / cylinder, the origin the block's centre). */
  footprint: TemplateFootprint.optional(),
  label: TemplateLabel.optional(),
};
/** DM schema: may set `hidden` and `placedByPlayerId` (FR-SCN-25). */
export const PlaceTemplateInput = z
  .strictObject({
    ...templateFields,
    hidden: z.boolean().optional(),
    placedByPlayerId: Id.optional(),
  })
  .superRefine(footprintFits);
export type PlaceTemplateInput = z.input<typeof PlaceTemplateInput>;
/** Player schema: neither `hidden` nor `placedByPlayerId` (sending one → `invalid`). */
export const PlayerPlaceTemplateInput = z.strictObject(templateFields).superRefine(footprintFits);
export const UpdateTemplateInput = z.strictObject({
  templateId: Id,
  x: TemplateCoord.optional(),
  y: TemplateCoord.optional(),
  size: TemplateSize.optional(),
  width: TemplateWidth.optional(),
  angle: TemplateAngle.optional(),
  /** #377: set (a snapped origin move) or `null` (a Ctrl move: the exact rule); absent = kept. */
  footprint: TemplateFootprint.nullable().optional(),
  label: TemplateLabel.optional(),
  /** DM only. */
  hidden: z.boolean().optional(),
});
export type UpdateTemplateInput = z.input<typeof UpdateTemplateInput>;
export const TemplateIdInput = z.strictObject({ templateId: Id });
/** FR-SCN-44: DM-placed kept templates only, unless `players: true` (absent = false). */
export const ClearTemplatesInput = z.strictObject({ sceneId: Id, players: z.boolean().optional() });
export const SetDiagonalRuleInput = z.strictObject({ rule: DiagonalRule });

// ---------- signal `scn.template` (FR-SCN-23) ----------

/** A connection's ephemeral template; `key` = one per sender connection. */
export const TemplateSignalPlace = z
  .strictObject({
    sceneId: Id,
    key: z.string().min(1).max(64),
    shape: TemplateShape,
    x: TemplateCoord,
    y: TemplateCoord,
    size: TemplateSize,
    width: TemplateWidth.optional(),
    angle: TemplateAngle,
    /** #377 (sphere / cylinder, the origin the block's centre). */
    footprint: TemplateFootprint.optional(),
    label: TemplateLabel.optional(),
    /** DM only: route to DM tabs (FR-SCN-24). */
    dmOnly: z.boolean().optional(),
  })
  .superRefine(footprintFits);
/** End frame: no geometry, routes to everyone. */
export const TemplateSignalEnd = z.strictObject({
  sceneId: Id,
  key: z.string().min(1).max(64),
  end: z.literal(true),
});
export const TemplateSignalData = z.union([TemplateSignalEnd, TemplateSignalPlace]);
export type TemplateSignalData = z.infer<typeof TemplateSignalData>;

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
/** FR-SCN-20: `size` 5–300 ft, `width` 5–60 ft, both step 5; `angle` 0–345 step 15. */
export const TEMPLATE_SIZE = { min: 5, max: 300, step: 5 } as const;
export const TEMPLATE_WIDTH = { min: 5, max: 60, step: 5, default: 5 } as const;
export const TEMPLATE_ANGLE = { min: 0, max: 345, step: 15 } as const;
/** Grid coordinates on the wire; commands check the map's range (FR-SCN-07, -16). */
export const COORD_MAX = 10_000;

/** 1 cell = 5 ft. */
export const FT_PER_CELL = 5;

// ---------- leaves ----------

const Id = z.string().min(1).max(64);
const Int = z.number().int();
const Coord = Int.min(-COORD_MAX).max(COORD_MAX);

/** FR-SCN-07: door state 0 open / 1 closed / 2 locked (DM marker). */
export const DOOR_OPEN = 0;
export const DOOR_CLOSED = 1;
export const DOOR_LOCKED = 2;
export const DoorState = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export type DoorState = z.infer<typeof DoorState>;
export const DOOR_STATE_NAMES = ["open", "closed", "locked"] as const;

/** A segment vertex to vertex: `[x1, y1, x2, y2]`. */
export const Segment = z.tuple([Coord, Coord, Coord, Coord]);
export type Segment = z.infer<typeof Segment>;

const SegmentN = Int.min(1);
/** Wall `[n, x1, y1, x2, y2]` (JSON leaf). */
export const Wall = z.tuple([SegmentN, Coord, Coord, Coord, Coord]);
export type Wall = z.infer<typeof Wall>;
/** Door `[n, x1, y1, x2, y2, state, f]`; `f` = server-written fog flag (FR-SCN-36). */
export const Door = z.tuple([
  SegmentN,
  Coord,
  Coord,
  Coord,
  Coord,
  DoorState,
  z.union([z.literal(0), z.literal(1)]),
]);
export type Door = z.infer<typeof Door>;
/** Player door `[n, x1, y1, x2, y2, open]`: 1 = open, 0 = closed (locked is sent as closed). */
export const PlayerDoor = z.tuple([
  SegmentN,
  Coord,
  Coord,
  Coord,
  Coord,
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
export const TemplateAngle = stepped(TEMPLATE_ANGLE);
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
  /** Origin vertex. */
  x: Int,
  y: Int,
  size: Int,
  /** Line only, else null. */
  width: Int.nullable(),
  angle: Int,
  label: z.string(),
  /** Null = DM-placed (a fog subject); a player's are never fog-hidden (FR-SCN-27). */
  placedByPlayerId: z.string().nullable(),
  hidden: z.boolean(),
  fogged: z.literal(true).optional(),
});
export type AoeTemplateRecord = z.infer<typeof AoeTemplateRecord>;

/** What a player receives of a visible template: no campaign (SCN §8 compact wire). */
export const PlayerAoeTemplateRecord = AoeTemplateRecord.omit({ campaignId: true });
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
/** `scn.addDoor` ack. */
export const AddDoorResult = z.object({ n: SegmentN });
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
  x: Coord,
  y: Coord,
  size: TemplateSize,
  width: TemplateWidth.optional(),
  angle: TemplateAngle,
  label: TemplateLabel.optional(),
};
/** DM schema: may set `hidden` and `placedByPlayerId` (FR-SCN-25). */
export const PlaceTemplateInput = z.strictObject({
  ...templateFields,
  hidden: z.boolean().optional(),
  placedByPlayerId: Id.optional(),
});
export type PlaceTemplateInput = z.input<typeof PlaceTemplateInput>;
/** Player schema: neither `hidden` nor `placedByPlayerId` (sending one → `invalid`). */
export const PlayerPlaceTemplateInput = z.strictObject(templateFields);
export const UpdateTemplateInput = z.strictObject({
  templateId: Id,
  x: Coord.optional(),
  y: Coord.optional(),
  size: TemplateSize.optional(),
  width: TemplateWidth.optional(),
  angle: TemplateAngle.optional(),
  label: TemplateLabel.optional(),
  /** DM only. */
  hidden: z.boolean().optional(),
});
export type UpdateTemplateInput = z.input<typeof UpdateTemplateInput>;
export const TemplateIdInput = z.strictObject({ templateId: Id });
export const ClearTemplatesInput = z.strictObject({ sceneId: Id });
export const SetDiagonalRuleInput = z.strictObject({ rule: DiagonalRule });

// ---------- signal `scn.template` (FR-SCN-23) ----------

/** A connection's ephemeral template; `key` = one per sender connection. */
export const TemplateSignalPlace = z.strictObject({
  sceneId: Id,
  key: z.string().min(1).max(64),
  shape: TemplateShape,
  x: Coord,
  y: Coord,
  size: TemplateSize,
  width: TemplateWidth.optional(),
  angle: TemplateAngle,
  label: TemplateLabel.optional(),
  /** DM only: route to DM tabs (FR-SCN-24). */
  dmOnly: z.boolean().optional(),
});
/** End frame: no geometry, routes to everyone. */
export const TemplateSignalEnd = z.strictObject({
  sceneId: Id,
  key: z.string().min(1).max(64),
  end: z.literal(true),
});
export const TemplateSignalData = z.union([TemplateSignalEnd, TemplateSignalPlace]);
export type TemplateSignalData = z.infer<typeof TemplateSignalData>;

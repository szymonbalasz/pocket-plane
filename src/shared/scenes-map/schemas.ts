// scenes-map boundary schemas (MAP §6, §8, §9; protocol §12, §13, §15): wire records, WS intent
// payloads, REST bodies and signal data. One schema for server, fixtures and both clients.
import { TokenCreatureType, TokenShape } from "@shared/entities/schemas";
import { z } from "zod";

export { TokenCreatureType, TokenShape };

// ---------- record type names ----------

export const SCENE_TYPE = "scene";
export const SCENE_FOLDER_TYPE = "scene-folder";
export const TOKEN_TYPE = "token";

// ---------- intent + signal names (MAP §9, protocol §13, §15) ----------

export const MAP_INTENTS = {
  activateScene: "map.activateScene",
  setSceneMap: "map.setSceneMap",
  setGrid: "map.setGrid",
  setLocked: "map.setLocked",
  placeToken: "map.placeToken",
  moveToken: "map.moveToken",
  updateToken: "map.updateToken",
  setTokenHidden: "map.setTokenHidden",
  duplicateToken: "map.duplicateToken",
  deleteToken: "map.deleteToken",
  /** FR-SCN-38 (ADR-0042): read-only dry run of the move guards. */
  checkMove: "map.checkMove",
} as const;

export const MAP_SIGNALS = {
  ping: "map.ping",
  laser: "map.laser",
  pull: "map.pull",
  drag: "map.drag",
} as const;

// ---------- names (FR-MAP-01, -02, -16) ----------

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the rule (FR-MAP-01).
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export const SCENE_NAME_MAX = 60;
export const FOLDER_NAME_MAX = 40;
export const TOKEN_NAME_MAX = 40;

/** Code-point length (names are cut and counted by code point). */
export const nameLength = (s: string) => [...s].length;

/** Trimmed, 1–`max` code points, no control chars. */
function nameSchema(max: number) {
  return z
    .string()
    .refine((s) => !CONTROL.test(s), { message: "Name must not contain control characters" })
    .transform((s) => s.trim())
    .refine((s) => s.length >= 1, { message: "Name is required" })
    .refine((s) => nameLength(s) <= max, { message: `Name must be at most ${max} characters` });
}

export const SceneName = nameSchema(SCENE_NAME_MAX);
export const FolderName = nameSchema(FOLDER_NAME_MAX);
export const TokenName = nameSchema(TOKEN_NAME_MAX);

// ---------- grid (FR-MAP-10) ----------

export const CELL_MIN = 8;
export const CELL_MAX = 512;
export const OPACITY_MIN = 0.1;
export const OPACITY_MAX = 1;

/** FR-MAP-01 grid defaults *(proposed, OQ-MAP-20)*. */
export const GRID_DEFAULTS = {
  cellSize: 70,
  offsetX: 0,
  offsetY: 0,
  visible: true,
  color: "#000000",
  opacity: 0.5,
} as const;

const twoDecimals = (v: number) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6;

export const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, { message: "Colour must look like #rrggbb" })
  .transform((s) => s.toLowerCase());

const gridShape = {
  cellSize: z
    .number()
    .min(CELL_MIN)
    .max(CELL_MAX)
    .refine(twoDecimals, { message: "At most 2 decimals" }),
  offsetX: z.number().min(0),
  offsetY: z.number().min(0),
  visible: z.boolean(),
  color: HexColor,
  opacity: z.number().min(OPACITY_MIN).max(OPACITY_MAX),
};

/** 0 ≤ offset < cellSize (FR-MAP-10). */
function offsetsBelowCell(
  g: { cellSize: number; offsetX: number; offsetY: number },
  c: z.RefinementCtx,
) {
  for (const k of ["offsetX", "offsetY"] as const) {
    if (g[k] >= g.cellSize) {
      c.addIssue({ code: "custom", path: [k], message: "Offset must be less than the cell size" });
    }
  }
}

export const GridFields = z.strictObject(gridShape).superRefine(offsetsBelowCell);
export type GridFields = z.output<typeof GridFields>;

// ---------- tokens: sizes, positions, caps (FR-MAP-14) ----------

export const TOKEN_SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"] as const;
export const TokenSize = z.enum(TOKEN_SIZES);
export type TokenSize = z.infer<typeof TokenSize>;

/** Cells per side; `col`/`row` stay well inside JS integers and any sane map. */
export const CELL_INDEX_MAX = 100_000;
export const CellIndex = z.number().int().min(-CELL_INDEX_MAX).max(CELL_INDEX_MAX);

/**
 * FR-MAP-65 (sprint 5): a token's combat trail this turn, cells oldest first (the start cell,
 * then each move's end cell); beyond 20 segments the oldest cell drops. Cells only: its colour
 * is derived at draw time (seams S10).
 */
export const TRAIL_CELLS_MAX = 21;
export const TrailCell = z.tuple([CellIndex, CellIndex]);
export type TrailCell = z.infer<typeof TrailCell>;
export const TokenTrail = z.strictObject({
  cells: z.array(TrailCell).min(2).max(TRAIL_CELLS_MAX),
});
export type TokenTrail = z.infer<typeof TokenTrail>;

/** FR-MAP-14 *(proposed, OQ-MAP-20)*. */
export const TOKENS_PER_SCENE_MAX = 200;
export const TOKENS_PER_CAMPAIGN_MAX = 1000;

const Id = z.string().min(1).max(64);

// ---------- wire records (MAP §9, protocol §12) ----------

const gridRecord = {
  gridCellSize: z.number(),
  gridOffsetX: z.number(),
  gridOffsetY: z.number(),
  gridVisible: z.boolean(),
  gridColor: z.string(),
  gridOpacity: z.number(),
};

/** `scene` (scope scene, `sceneOf = id`), DM full view. */
export const SceneRecord = z.object({
  id: z.string(),
  campaignId: z.string(),
  folderId: z.string().nullable(),
  seq: z.number().int(),
  name: z.string(),
  mapAssetId: z.string(),
  mapWidth: z.number().int(),
  mapHeight: z.number().int(),
  ...gridRecord,
  mapLocked: z.boolean(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SceneRecord = z.infer<typeof SceneRecord>;

/** What a player receives of the active scene: no name, folder, lock or `seq` (OQ-MAP-17). */
export const PlayerSceneRecord = z.object({
  id: z.string(),
  mapAssetId: z.string(),
  mapWidth: z.number().int(),
  mapHeight: z.number().int(),
  ...gridRecord,
  active: z.boolean(),
});
export type PlayerSceneRecord = z.infer<typeof PlayerSceneRecord>;

/** Fields both clients render a scene from. */
export type SceneView = PlayerSceneRecord & Partial<SceneRecord>;

/** `scene-folder` (campaign scope), DM only. */
export const SceneFolderRecord = z.object({
  id: z.string(),
  campaignId: z.string(),
  seq: z.number().int(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SceneFolderRecord = z.infer<typeof SceneFolderRecord>;

const tokenFields = {
  id: z.string(),
  campaignId: z.string(),
  sceneId: z.string(),
  seq: z.number().int(),
  name: z.string(),
  imageAssetId: z.string().nullable(),
  size: TokenSize,
  col: z.number().int(),
  row: z.number().int(),
  ownerPlayerId: z.string().nullable(),
  hidden: z.boolean(),
  /** Token-owned (FR-MAP-35). */
  shape: TokenShape,
  /**
   * Display copy of the monster's `statBlock.type` at placement, token-owned afterwards; null =
   * not known yet (FR-ENT-27, ADR-0050). Players get it on tokens they receive (FR-ENT-30).
   */
  creatureType: TokenCreatureType.nullable(),
  /** Display copy: `definitionId` on character tokens, else null; players get it (FR-MAP-50). */
  characterId: z.string().nullable(),
  /** Server copy: every footprint cell fogged (FR-FOG-10); on the wire only when true. */
  fogged: z.literal(true).optional(),
  /**
   * FR-MAP-65, -66 (sprint 5): this turn's combat trail, written by combat through
   * `appendTrail` / `clearTrails`; null outside combat. Players get it on player tokens only
   * (absent on every other token they receive).
   */
  trail: TokenTrail.nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
};

/** Display copy of `statBlock.speed` in ft; null = unknown (FR-MAP-36). */
const TokenSpeed = z.number().int().nullable();

/**
 * `token` (scope scene, `sceneOf = sceneId`), DM full view. Server records also carry `seenBy`
 * (FR-FOG-10, ADR-0042: player ids, null = pre-v2), which no wire ever carries (the record
 * type's `dmRedact` and player `redact` strip it).
 */
export const TokenRecord = z.object({
  ...tokenFields,
  definitionId: z.string(),
  speed: TokenSpeed,
  /** FR-FOG-45 (#210): DM wire only, only when true; players never get the key. */
  invisible: z.literal(true).optional(),
  /** Server only (never on a wire). */
  seenBy: z.array(z.string()).nullable().optional(),
});
export type TokenRecord = z.infer<typeof TokenRecord>;

/**
 * What a player receives of a visible token: every field but `definitionId` (FR-MAP-26), and
 * `speed` only on tokens the player owns (FR-MAP-36). `characterId` stays (FR-MAP-50).
 */
export const PlayerTokenRecord = z.object({ ...tokenFields, speed: TokenSpeed.optional() });
export type PlayerTokenRecord = z.infer<typeof PlayerTokenRecord>;

/** Fields both clients render a token from. */
export type TokenView = PlayerTokenRecord & { definitionId?: string };

// ---------- WS intent payloads (protocol §13) ----------

export const ActivateSceneInput = z.strictObject({ sceneId: Id });
export const SetSceneMapInput = z.strictObject({ sceneId: Id, mapAssetId: Id });
export const SetGridInput = z
  .strictObject({ sceneId: Id, ...gridShape })
  .superRefine(offsetsBelowCell);
export type SetGridInput = z.input<typeof SetGridInput>;
export const SetLockedInput = z.strictObject({ sceneId: Id, locked: z.boolean() });

/**
 * Never `size`, `speed` (#120, FR-MAP-36) or `creatureType` (FR-ENT-27). Optional fields are for
 * fixtures and the DM menu.
 * `shape` absent → the definition's `tokenShape`, else `round` (FR-MAP-35).
 */
export const PlaceTokenInput = z.strictObject({
  sceneId: Id,
  definitionId: Id,
  col: CellIndex,
  row: CellIndex,
  name: TokenName.optional(),
  imageAssetId: Id.nullable().optional(),
  ownerPlayerId: Id.nullable().optional(),
  hidden: z.boolean().optional(),
  shape: TokenShape.optional(),
});
export type PlaceTokenInput = z.input<typeof PlaceTokenInput>;

export const MoveTokenInput = z.strictObject({ tokenId: Id, col: CellIndex, row: CellIndex });
export type MoveTokenInput = z.input<typeof MoveTokenInput>;

/** FR-SCN-38: `map.checkMove` (same fields as `map.moveToken`). */
export const CheckMoveInput = MoveTokenInput;
export type CheckMoveInput = z.input<typeof CheckMoveInput>;

/** FR-FOG-53: the `guard` of fog's sight hint (the hint phase, ADR-0047). */
export const FOG_SIGHT_HINT = "fog-sight";

/** A guard's hint (FR-SCN-38): segments `[x1, y1, x2, y2]` in grid units (wall: ≤ 1 piece). */
export const SegmentsHint = z.object({
  guard: z.string().refine((g) => g !== FOG_SIGHT_HINT),
  segments: z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])),
});
export type SegmentsHint = z.infer<typeof SegmentsHint>;

/**
 * FR-FOG-53 (sprint 4): the hint phase's sight preview = the source's polygons (flat grid-unit
 * coordinates, rounded + simplified as FR-FOG-33) with the token at the checked cell.
 */
export const FogSightHint = z.object({
  guard: z.literal(FOG_SIGHT_HINT),
  tokenId: z.string(),
  see: z.array(z.array(z.number())),
  dark: z.array(z.array(z.number())),
});
export type FogSightHint = z.infer<typeof FogSightHint>;

/** A `map.checkMove` hint, tagged by `guard` (ADR-0047). */
export const MoveHint = z.union([FogSightHint, SegmentsHint]);
export type MoveHint = z.infer<typeof MoveHint>;

/** `map.checkMove` ack: `ok` = the move would pass; `hints` per guard, then the hint phase. */
export const CheckMoveResult = z.object({
  ok: z.boolean(),
  hints: z.array(MoveHint),
});
export type CheckMoveResult = z.infer<typeof CheckMoveResult>;

export const UpdateTokenInput = z.strictObject({
  tokenId: Id,
  name: TokenName.optional(),
  imageAssetId: Id.nullable().optional(),
  ownerPlayerId: Id.nullable().optional(),
  /** FR-MAP-35; never `size` or `speed`. */
  shape: TokenShape.optional(),
  /** FR-ENT-27: a type or `"initials"`; null is never sent (it only means "not known yet"). */
  creatureType: TokenCreatureType.optional(),
});
export type UpdateTokenInput = z.input<typeof UpdateTokenInput>;

export const SetTokenHiddenInput = z.strictObject({ tokenId: Id, hidden: z.boolean() });
export const TokenIdInput = z.strictObject({ tokenId: Id });
export const DuplicateTokenResult = z.object({ tokenId: z.string() });
export type DuplicateTokenResult = z.infer<typeof DuplicateTokenResult>;

// ---------- REST bodies (MAP §9) ----------

/** POST /api/scenes. */
export const CreateSceneBody = z.strictObject({
  name: SceneName,
  mapAssetId: Id,
  folderId: Id.nullable().optional(),
});
export type CreateSceneBody = z.input<typeof CreateSceneBody>;

/** PATCH /api/scenes/:id: rename and/or move (`folderId: null` = root). */
export const PatchSceneBody = z
  .strictObject({ name: SceneName.optional(), folderId: Id.nullable().optional() })
  .refine((b) => b.name !== undefined || b.folderId !== undefined, {
    message: "Nothing to change",
  });
export type PatchSceneBody = z.input<typeof PatchSceneBody>;

export const SceneFolderBody = z.strictObject({ name: FolderName });
export type SceneFolderBody = z.input<typeof SceneFolderBody>;

export const SceneResponse = z.object({ scene: SceneRecord });
export type SceneResponse = z.infer<typeof SceneResponse>;
export const SceneFolderResponse = z.object({ sceneFolder: SceneFolderRecord });
export type SceneFolderResponse = z.infer<typeof SceneFolderResponse>;

// ---------- signals (FR-MAP-23–25, protocol §15) ----------

export const COORD_MAX = 16384;
export const LASER_POINTS_MAX = 32;
/** Client send budget for laser frames (FR-MAP-24). */
export const LASER_SENDS_PER_S = 20;

const Coord = z.number().min(-COORD_MAX).max(COORD_MAX);

export const PingData = z.strictObject({ sceneId: Id, x: Coord, y: Coord });
export type PingData = z.infer<typeof PingData>;
export const PullData = PingData;
export type PullData = PingData;
export const LaserData = z.strictObject({
  sceneId: Id,
  points: z.array(z.tuple([Coord, Coord])).max(LASER_POINTS_MAX),
  end: z.boolean().optional(),
});
export type LaserData = z.infer<typeof LaserData>;

// ---------- drag preview (FR-MAP-39–41, protocol §15) ----------

/** Sender: at most one frame per 50 ms while moving (decided #172, OQ-MAP-30). */
export const DRAG_INTERVAL_MS = 50;
/** Sender: repeat the last position every 1 s while the pointer rests. */
export const DRAG_REPEAT_MS = 1000;
/** Receiver: a preview without a frame for 3 s drops. */
export const DRAG_TIMEOUT_MS = 3000;

/** `map.drag`: T's top-left in map `display` px (unsnapped), or `end: true` on drop / cancel. */
export const DragData = z.union([
  z.strictObject({ sceneId: Id, tokenId: Id, x: Coord, y: Coord }),
  z.strictObject({ sceneId: Id, tokenId: Id, end: z.literal(true) }),
]);
export type DragData = z.infer<typeof DragData>;

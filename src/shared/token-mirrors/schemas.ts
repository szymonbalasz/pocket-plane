// Token mirrors (MIR §8, §9; ADR-0077): a display-only copy of a token at another place on the same
// map. One schema for the server, fixtures and both clients. A mirror has no sight, no combat and
// no menu for players: it is never a token.
import { TokenCreatureType, TokenShape, TokenSize } from "@shared/scenes-map/schemas";
import { z } from "zod";

export const TOKEN_MIRROR_TYPE = "token-mirror";

export const MIR_INTENTS = {
  create: "mir.create",
  move: "mir.move",
  setMode: "mir.setMode",
  delete: "mir.delete",
} as const;

/** FR-MIR-05: ≤ 200 per scene and ≤ 2,000 per campaign, the props' caps. */
export const MIRRORS_PER_SCENE_MAX = 200;
export const MIRRORS_PER_CAMPAIGN_MAX = 2000;

/**
 * FR-MIR-06: `hidden` nobody; `visible` a normal look, for whoever has sight to it; `transparent`
 * and `shadow` every player, walls and fog ignored.
 */
export const MIRROR_MODES = ["hidden", "visible", "transparent", "shadow"] as const;
export const MirrorMode = z.enum(MIRROR_MODES);
export type MirrorMode = z.infer<typeof MirrorMode>;

const Id = z.string().min(1);
const Cell = z.number().int();

/** Server record and DM wire (the DM wire drops `seenBy`). */
export const TokenMirrorRecord = z.object({
  id: Id,
  campaignId: Id,
  sceneId: Id,
  tokenId: Id,
  seq: z.number().int(),
  col: Cell,
  row: Cell,
  mode: MirrorMode,
  /** FR-MIR-08: copies of the source token, so visibility reads only the record (ADR-0021). */
  name: z.string(),
  imageAssetId: z.string().nullable(),
  creatureType: TokenCreatureType.nullable(),
  size: TokenSize,
  shape: TokenShape,
  /** FR-MIR-09: the source is hidden or Invisible, or the mirror is off the map: nobody sees it. */
  suppressed: z.boolean(),
  /** FR-MIR-06: `visible` mode's sight copies (FR-FOG-10). */
  fogged: z.boolean(),
  /** Server only (never on a wire). */
  seenBy: z.array(z.string()).nullable().optional(),
});
export type TokenMirrorRecord = z.infer<typeof TokenMirrorRecord>;

/** FR-MIR-07: a player's copy: no source token, and a shadow carries no name or art. */
export const PlayerTokenMirrorRecord = z.object({
  id: Id,
  sceneId: Id,
  col: Cell,
  row: Cell,
  mode: MirrorMode,
  size: TokenSize,
  shape: TokenShape,
  name: z.string().optional(),
  imageAssetId: z.string().nullable().optional(),
  creatureType: TokenCreatureType.nullable().optional(),
});
export type PlayerTokenMirrorRecord = z.infer<typeof PlayerTokenMirrorRecord>;

/** What a client draws: the player's copy plus what only the DM receives. */
export type MirrorView = PlayerTokenMirrorRecord &
  Partial<Pick<TokenMirrorRecord, "tokenId" | "suppressed" | "seq">>;

export const CreateMirrorInput = z.strictObject({
  tokenId: Id,
  col: Cell,
  row: Cell,
  mode: MirrorMode.optional(),
});
export type CreateMirrorInput = z.input<typeof CreateMirrorInput>;
export const MoveMirrorInput = z.strictObject({ mirrorId: Id, col: Cell, row: Cell });
export const SetMirrorModeInput = z.strictObject({ mirrorId: Id, mode: MirrorMode });
export const MirrorIdInput = z.strictObject({ mirrorId: Id });

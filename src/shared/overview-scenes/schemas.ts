// Overview scenes wire shapes (OVW §8, §9; protocol §190; ADR-0075): record types, intent payloads,
// label style and the limits. Units: 1 unit = 1 px at 100 % zoom.
import { z } from "zod";
import { isDec2 } from "../scene-tools/schemas";
import { nameLength, SceneName } from "../scenes-map/schemas";

export const OVERVIEW_TYPE = "overview";
export const OVERVIEW_ITEM_TYPE = "overview-item";

export const OVW_INTENTS = {
  create: "ovw.create",
  update: "ovw.update",
  duplicate: "ovw.duplicate",
  delete: "ovw.delete",
  show: "ovw.show",
  placeImage: "ovw.placeImage",
  placeLabel: "ovw.placeLabel",
  updateItems: "ovw.updateItems",
  moveItems: "ovw.moveItems",
  duplicateItems: "ovw.duplicateItems",
  deleteItems: "ovw.deleteItems",
  placeMiniature: "ovw.placeMiniature",
  addParty: "ovw.addParty",
} as const;

export const OVW_SIGNALS = { drag: "ovw.drag" } as const;

// ---------- limits (OQ-OVW-02, FR-OVW-01, -15, -17, -23, -26, -27, -32, -34) ----------

export const OVERVIEWS_PER_CAMPAIGN_MAX = 50;
export const ITEMS_PER_OVERVIEW_MAX = 300;
export const ITEMS_PER_CAMPAIGN_MAX = 3000;
/** FR-OVW-17, §9: items per group action. */
export const GROUP_ACTION_MAX = 50;
/** FR-OVW-15: ± units. */
export const POSITION_MAX = 16384;
/** FR-OVW-23: an image's side. */
export const IMAGE_SIDE = { min: 8, max: 16384 } as const;
/** FR-OVW-34: a miniature's side (square). */
export const MINIATURE_SIDE = { min: 8, max: 4096 } as const;
/** FR-OVW-34: a new miniature's side on the placer's screen, in px (`size` = this ÷ zoom). */
export const MINIATURE_SCREEN_PX = 64;
/** FR-OVW-26. */
export const LABEL_TEXT_MAX = 80;
/** FR-OVW-32. */
export const MINIATURE_NAME_MAX = 40;
export const FONT_SIZE = { min: 8, max: 512 } as const;
export const DOT_SIZE = { min: 2, max: 256 } as const;
export const STROKE_WIDTH_MAX = 32;
/** `ovw.duplicateItems`: a copy lands this far right and down, inside the bounds. */
export const DUPLICATE_OFFSET = 24;

// ---------- fields ----------

const Id = z.string().min(1).max(64);

/** FR-OVW-15: within ±16384, 2 decimals. */
export const Position = z
  .number()
  .min(-POSITION_MAX)
  .max(POSITION_MAX)
  .refine(isDec2, { message: "At most 2 decimals" });
/** An item's side, 2 decimals; a miniature's tighter bounds (FR-OVW-34) sit on top. */
export const Side = z
  .number()
  .min(IMAGE_SIDE.min)
  .max(IMAGE_SIDE.max)
  .refine(isDec2, { message: "At most 2 decimals" });

export const ITEM_KINDS = ["image", "label", "miniature"] as const;
export const ItemKind = z.enum(ITEM_KINDS);
export type ItemKind = z.infer<typeof ItemKind>;

export const MINIATURE_SHAPES = ["round", "square", "none"] as const;
export const MiniatureShape = z.enum(MINIATURE_SHAPES);
export type MiniatureShape = z.infer<typeof MiniatureShape>;

export const LABEL_FONTS = ["fell", "garamond", "alegreya"] as const;
export const LabelFont = z.enum(LABEL_FONTS);

/** `#rrggbb` in any case, stored lowercase. */
const Colour = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Expected a #rrggbb colour")
  .transform((s) => s.toLowerCase());
const StrokeWidth = z.number().min(0).max(STROKE_WIDTH_MAX);

const textStyle = {
  font: LabelFont,
  size: z.number().min(FONT_SIZE.min).max(FONT_SIZE.max),
  color: Colour,
  strokeColor: Colour,
  strokeWidth: StrokeWidth,
};

/** FR-OVW-27. 0 = no stroke. */
export const LabelStyle = z.strictObject({
  ...textStyle,
  dot: z.strictObject({
    on: z.boolean(),
    size: z.number().min(DOT_SIZE.min).max(DOT_SIZE.max),
    color: Colour,
    strokeColor: Colour,
    strokeWidth: StrokeWidth,
  }),
});
export type LabelStyle = z.infer<typeof LabelStyle>;

/** FR-OVW-36: a miniature's name takes the text fields, without the dot. */
export const MiniatureStyle = z.strictObject(textStyle);
export type MiniatureStyle = z.infer<typeof MiniatureStyle>;

export const ItemStyle = z.union([LabelStyle, MiniatureStyle]);
export type ItemStyle = z.infer<typeof ItemStyle>;

/** FR-OVW-27 default. */
export const LABEL_STYLE_DEFAULT: LabelStyle = {
  font: "garamond",
  size: 28,
  color: "#ffffff",
  strokeColor: "#000000",
  strokeWidth: 2,
  dot: { on: true, size: 12, color: "#ffffff", strokeColor: "#000000", strokeWidth: 2 },
};

/** FR-OVW-36 default: the label text style at size 14. */
export const MINIATURE_STYLE_DEFAULT: MiniatureStyle = {
  font: LABEL_STYLE_DEFAULT.font,
  size: 14,
  color: LABEL_STYLE_DEFAULT.color,
  strokeColor: LABEL_STYLE_DEFAULT.strokeColor,
  strokeWidth: LABEL_STYLE_DEFAULT.strokeWidth,
};

/**
 * FR-OVW-36: a new miniature's name style. `size` = 64 ÷ the placer's zoom (FR-OVW-34), so the name
 * starts 14 px on that screen too: 14 ÷ zoom, inside the font's bounds.
 */
export function newMiniatureStyle(size: number): MiniatureStyle {
  const name =
    Math.round(((MINIATURE_STYLE_DEFAULT.size * size) / MINIATURE_SCREEN_PX) * 100) / 100;
  return {
    ...MINIATURE_STYLE_DEFAULT,
    size: Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, name)),
  };
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the rule (FR-OVW-26).
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** FR-OVW-26: clean, one line, trimmed. A kind's length sits on top. */
export const ItemText = z
  .string()
  .refine((s) => !CONTROL.test(s), { message: "Text must not contain control characters" })
  .transform((s) => s.trim());

/** FR-OVW-26: 1–80 code points. */
export const labelTextFits = (s: string) => s.length >= 1 && nameLength(s) <= LABEL_TEXT_MAX;
/** FR-OVW-32: 0–40 code points. */
export const miniatureNameFits = (s: string) => nameLength(s) <= MINIATURE_NAME_MAX;

export const LabelText = ItemText.refine(labelTextFits, {
  message: `Text must be 1–${LABEL_TEXT_MAX} characters`,
});

export const MiniatureName = ItemText.refine(miniatureNameFits, {
  message: `Name must be at most ${MINIATURE_NAME_MAX} characters`,
});

/** FR-OVW-33: a character's name as a miniature's: cut to 40 code points (entities allow 60). */
export const miniatureNameOf = (name: string) =>
  [...name].slice(0, MINIATURE_NAME_MAX).join("").trim();

// ---------- records (OVW §8) ----------

export const OverviewRecord = z.object({
  id: z.string(),
  campaignId: z.string(),
  folderId: z.string().nullable(),
  seq: z.number().int(),
  name: z.string(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OverviewRecord = z.infer<typeof OverviewRecord>;

/** FR-OVW-39: no name, folder or `seq`. */
export const PlayerOverviewRecord = z.strictObject({
  id: z.string(),
  campaignId: z.string(),
  active: z.boolean(),
});
export type PlayerOverviewRecord = z.infer<typeof PlayerOverviewRecord>;

const itemFields = {
  id: z.string(),
  campaignId: z.string(),
  overviewId: z.string(),
  seq: z.number().int(),
  z: z.number().int(),
  kind: ItemKind,
  x: z.number(),
  y: z.number(),
  w: z.number().nullable(),
  h: z.number().nullable(),
  hidden: z.boolean(),
  assetId: z.string().nullable(),
  text: z.string().nullable(),
  style: ItemStyle.nullable(),
  characterId: z.string().nullable(),
  ownerPlayerId: z.string().nullable(),
  shape: MiniatureShape.nullable(),
};

export const OverviewItemRecord = z.object({
  ...itemFields,
  locked: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OverviewItemRecord = z.infer<typeof OverviewItemRecord>;

/** FR-OVW-39: no `locked`, and no timestamps, so a lock change reaches no player. */
export const PlayerOverviewItemRecord = z.strictObject(itemFields);
export type PlayerOverviewItemRecord = z.infer<typeof PlayerOverviewItemRecord>;

// ---------- stacking (FR-OVW-19, ADR-0075 Decision 5) ----------

/** Bands, bottom to top. */
export const ITEM_BANDS: Readonly<Record<ItemKind, number>> = { image: 0, label: 1, miniature: 2 };

type Stacked = Pick<OverviewItemRecord, "kind" | "z" | "seq">;

/** FR-OVW-19 draw order: band, then `z`, then `seq`. */
export const compareItems = (a: Stacked, b: Stacked): number =>
  ITEM_BANDS[a.kind] - ITEM_BANDS[b.kind] || a.z - b.z || a.seq - b.seq;

// ---------- intents (OVW §9) ----------

export const CreateOverviewInput = z.strictObject({
  name: SceneName,
  folderId: Id.nullable().optional(),
});
export type CreateOverviewInput = z.input<typeof CreateOverviewInput>;

export const UpdateOverviewInput = z.strictObject({
  overviewId: Id,
  name: SceneName.optional(),
  folderId: Id.nullable().optional(),
});
export type UpdateOverviewInput = z.input<typeof UpdateOverviewInput>;

export const OverviewIdInput = z.strictObject({ overviewId: Id });
export type OverviewIdInput = z.input<typeof OverviewIdInput>;

export const PlaceImageInput = z.strictObject({
  overviewId: Id,
  assetId: Id,
  x: Position,
  y: Position,
  w: Side,
  h: Side,
  hidden: z.boolean().optional(),
});
export type PlaceImageInput = z.input<typeof PlaceImageInput>;

export const PlaceLabelInput = z.strictObject({
  overviewId: Id,
  x: Position,
  y: Position,
  text: LabelText,
  style: LabelStyle,
  hidden: z.boolean().optional(),
});
export type PlaceLabelInput = z.input<typeof PlaceLabelInput>;

/** FR-OVW-34: the square's side, 2 decimals. */
const MiniatureSize = z
  .number()
  .min(MINIATURE_SIDE.min)
  .max(MINIATURE_SIDE.max)
  .refine(isDec2, { message: "At most 2 decimals" });

/** FR-OVW-32. */
export const PlaceMiniatureInput = z.strictObject({
  overviewId: Id,
  assetId: Id,
  x: Position,
  y: Position,
  size: MiniatureSize,
  text: MiniatureName.optional(),
  ownerPlayerId: Id.optional(),
  hidden: z.boolean().optional(),
});
export type PlaceMiniatureInput = z.input<typeof PlaceMiniatureInput>;

/** FR-OVW-31: `x, y` = the row's centre; `hidden`: the panel's Add hidden (FR-OVW-20). */
export const AddPartyInput = z.strictObject({
  overviewId: Id,
  x: Position,
  y: Position,
  size: MiniatureSize,
  hidden: z.boolean().optional(),
});
export type AddPartyInput = z.input<typeof AddPartyInput>;

/** 1–50 of `schema`, no item twice (FR-OVW-17, §9). */
const groupOf = <S extends z.ZodType>(schema: S, key: (t: z.output<S>) => string) =>
  z
    .array(schema)
    .min(1)
    .max(GROUP_ACTION_MAX)
    .refine((list) => new Set(list.map(key)).size === list.length, {
      message: "An item appears twice",
    });

export const StackMove = z.enum(["front", "back"]);
export type StackMove = z.infer<typeof StackMove>;

/** One item's change; what a kind may take is checked by the command (FR-OVW-24, -26, -34). */
export const ItemPatch = z.strictObject({
  itemId: Id,
  x: Position.optional(),
  y: Position.optional(),
  w: Side.optional(),
  h: Side.optional(),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  /** FR-OVW-19: top or bottom of the item's band. */
  stack: StackMove.optional(),
  text: ItemText.optional(),
  style: ItemStyle.optional(),
  assetId: Id.optional(),
  /** FR-OVW-34, miniatures only. */
  shape: MiniatureShape.optional(),
  /** FR-OVW-32, unlinked miniatures only; null = nobody. */
  ownerPlayerId: Id.nullable().optional(),
});
export type ItemPatch = z.output<typeof ItemPatch>;

export const UpdateItemsInput = z.strictObject({
  overviewId: Id,
  items: groupOf(ItemPatch, (p) => p.itemId),
});
export type UpdateItemsInput = z.input<typeof UpdateItemsInput>;

const ItemMoves = groupOf(
  z.strictObject({ itemId: Id, x: Position, y: Position }),
  (m) => m.itemId,
);

/** FR-OVW-17. */
export const MoveItemsInput = z.strictObject({ overviewId: Id, moves: ItemMoves });
export type MoveItemsInput = z.input<typeof MoveItemsInput>;

/** FR-OVW-37 `ovw.drag`: where the dragged items are drawn, or `end: true` on drop / cancel. */
export const ItemDragData = z.union([
  z.strictObject({ overviewId: Id, moves: ItemMoves }),
  z.strictObject({ overviewId: Id, itemIds: groupOf(Id, (id) => id), end: z.literal(true) }),
]);
export type ItemDragData = z.infer<typeof ItemDragData>;

export const ItemIdsInput = z.strictObject({
  overviewId: Id,
  itemIds: groupOf(Id, (id) => id),
});
export type ItemIdsInput = z.input<typeof ItemIdsInput>;

/** `ovw.placeImage` / `ovw.placeLabel` result. */
export interface PlaceItemResult {
  itemId: string;
}
/** `ovw.addParty` result: the new miniatures; empty = everyone is already here (FR-OVW-31). */
export interface AddPartyResult {
  itemIds: string[];
}
/** `ovw.duplicateItems` result: the copies, in the given order. */
export interface DuplicateItemsResult {
  itemIds: string[];
}

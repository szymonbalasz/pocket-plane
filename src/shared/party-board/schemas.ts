// party-board boundary schemas (PARTY §6, §8, §9). zod is the source of truth; the clients mirror
// the intent rules with these same schemas (FR-PARTY-15, FR-PARTY-16, FR-PARTY-24, FR-PARTY-27).
import { AssetId } from "@shared/assets-pipeline/schemas";
import { cleanText } from "@shared/notifications/schemas";
import { z } from "zod";
import { nothingToSplit } from "./split";

export const HANDOUT_TYPE = "handout";
export const HANDOUT_BODY_TYPE = "handout-body";
export const PARTY_ITEM_TYPE = "party-item";
export const HANDOUT_SHARED_KIND = "handout-shared";
/** S5 (FR-PARTY-31): a shared handout open on one player's screen. */
export const HANDOUT_PRESENT_TYPE = "handout-present";

/** FR-PARTY-01: handouts per campaign. */
export const HANDOUT_MAX = 200;
export const HANDOUT_TITLE_MAX = 80;
export const HANDOUT_BODY_MAX = 10_000;
export const HANDOUT_IMAGES_MAX = 10;
/** FR-PARTY-05: chosen players per share; FR-PARTY-32: per present. */
export const SHARE_PLAYERS_MAX = 20;
/** FR-PARTY-17: party rows per campaign. */
export const PARTY_ITEM_MAX = 60;
/** FR-PARTY-22: sheet `items` rows ([FR-CHARX-16](character-sheet-full.md)). */
export const SHEET_ITEM_MAX = 80;
export const ITEM_NAME_MAX = 60;
export const ITEM_NOTES_MAX = 120;
export const ITEM_QTY_MAX = 9_999;
/** FR-PARTY-26. */
export const SPLIT_CHARACTERS_MAX = 10;
export const SPLIT_COIN_MAX = 999_999;

export const HANDOUT_LIMIT_MESSAGE = `Handout limit reached (${HANDOUT_MAX})`;
export const PARTY_FULL_MESSAGE = `Party inventory is full (${PARTY_ITEM_MAX})`;
export const ITEM_CLASH_MESSAGE = "Same item exists — move or remove one";
export const ITEM_GONE_MESSAGE = "Item is gone";
export const NOTHING_TO_SPLIT = "Nothing to split";
/** FR-PARTY-26: the text of each split row. */
export const SPLIT_TEXT = "Split";
/** FR-PARTY-25: `loot.edit` on an item row. */
export const ITEM_EDIT_MESSAGE = "Item moves can't be edited — move it back";
export const onlyLeftMessage = (n: number) => `Only ${n} left`;
/** FR-PARTY-32: no target can see the handout. */
export const SHARE_FIRST_MESSAGE = "Share it first";
/** FR-PARTY-32: a chosen target can't see the handout. */
export const cantSeeMessage = (name: string) => `${name} can't see this handout — share it first`;

const Id = z.string().min(1).max(64);

// biome-ignore lint/suspicious/noControlCharactersInRegex: FR-PARTY "clean text" body rule keeps only \n and \t.
const BODY_CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/** PARTY §6 clean body text: `\r\n` → `\n`, control characters except `\n` / `\t` removed, trimmed. */
export function cleanBody(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(BODY_CONTROL_CHARS, "").trim();
}

/** PARTY §6 clean text: control characters removed, trimmed, then `min`–`max` chars. */
const cleaned = (min: number, max: number, label: string) =>
  z
    .string()
    .max(4 * max)
    .transform(cleanText)
    .pipe(
      z.string().min(min, `${label}: required`).max(max, `${label}: at most ${max} characters`),
    );

const unique = (xs: readonly string[]) => new Set(xs).size === xs.length;

// ── Handouts ────────────────────────────────────────────────────────────────

export const HandoutTitle = cleaned(1, HANDOUT_TITLE_MAX, "Title");
export const HandoutBody = z
  .string()
  .max(4 * HANDOUT_BODY_MAX)
  .transform(cleanBody)
  .pipe(z.string().max(HANDOUT_BODY_MAX, `Text: at most ${HANDOUT_BODY_MAX} characters`));
export const HandoutImages = z
  .array(AssetId)
  .max(HANDOUT_IMAGES_MAX, `At most ${HANDOUT_IMAGES_MAX} images`)
  .refine(unique, { message: "Each image once" });

export const SHARE_MODES = ["none", "all", "players"] as const;
export type ShareMode = (typeof SHARE_MODES)[number];

/**
 * FR-PARTY-05 / §8 `sharedWith`: `none` = unshared; `players` needs 1–20 unique ids;
 * `none` / `all` need `[]`. Exported for later reuse (OQ-PARTY-01).
 */
export const SharedWith = z
  .strictObject({ mode: z.enum(SHARE_MODES), playerIds: z.array(Id).max(SHARE_PLAYERS_MAX) })
  .superRefine((v, ctx) => {
    if (v.mode === "players" && v.playerIds.length === 0)
      ctx.addIssue({ code: "custom", message: "Choose at least one player", path: ["playerIds"] });
    if (v.mode !== "players" && v.playerIds.length > 0)
      ctx.addIssue({ code: "custom", message: "No players with this mode", path: ["playerIds"] });
    if (!unique(v.playerIds))
      ctx.addIssue({ code: "custom", message: "Each player once", path: ["playerIds"] });
  });
export type SharedWith = z.infer<typeof SharedWith>;

export const NOT_SHARED: SharedWith = { mode: "none", playerIds: [] };

/** FR-PARTY-07: the player's view of `sharedWith`, no ids (OQ-PARTY-10). */
export const RedactedSharedWith = z.strictObject({ mode: z.enum(["all", "players"]) });
export type RedactedSharedWith = z.infer<typeof RedactedSharedWith>;

/** FR-PARTY-02: handout input fields (create and update). */
const handoutFields = { title: HandoutTitle, body: HandoutBody, imageAssetIds: HandoutImages };

/** `party.createHandout` (DM, FR-PARTY-03). */
export const CreateHandoutIntent = z.strictObject(handoutFields);
export type CreateHandoutIntent = z.input<typeof CreateHandoutIntent>;
export type HandoutInput = z.output<typeof CreateHandoutIntent>;

/** `party.updateHandout` (DM, FR-PARTY-04): full replacement. */
export const UpdateHandoutIntent = z.strictObject({ handoutId: Id, ...handoutFields });
export type UpdateHandoutIntent = z.input<typeof UpdateHandoutIntent>;

/**
 * `party.shareHandout` (DM, FR-PARTY-05): share and unshare. *(S5)* `present: true` also opens it
 * on the gainers' screens (FR-PARTY-33); with `mode: none` → `invalid`.
 */
export const ShareHandoutIntent = z
  .strictObject({ handoutId: Id, sharedWith: SharedWith, present: z.boolean().optional() })
  .superRefine((v, ctx) => {
    if (v.present === true && v.sharedWith.mode === "none")
      ctx.addIssue({
        code: "custom",
        message: "Can't open an unshared handout",
        path: ["present"],
      });
  });
export type ShareHandoutIntent = z.input<typeof ShareHandoutIntent>;

/** `party.deleteHandout` (DM, FR-PARTY-08). */
export const DeleteHandoutIntent = z.strictObject({ handoutId: Id });
export type DeleteHandoutIntent = z.input<typeof DeleteHandoutIntent>;

export const CreateHandoutResult = z.strictObject({ handoutId: z.string() });
export type CreateHandoutResult = z.infer<typeof CreateHandoutResult>;

const headerFields = {
  id: z.string(),
  campaignId: z.string(),
  seq: z.int(),
  title: z.string(),
  imageAssetIds: z.array(z.string()),
  rev: z.int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  sharedAt: z.string().nullable(),
};

/** Record `handout` (header, no body), DM view (FR-PARTY-01, §9). */
export const HandoutRecord = z.strictObject({ ...headerFields, sharedWith: SharedWith });
export type HandoutRecord = z.infer<typeof HandoutRecord>;

/** Record `handout`, player view: redacted `sharedWith` (FR-PARTY-07). */
export const PlayerHandoutRecord = z.strictObject({
  ...headerFields,
  sharedWith: RedactedSharedWith,
});
export type PlayerHandoutRecord = z.infer<typeof PlayerHandoutRecord>;

/** A `handout` row as either client stores it. */
export const HandoutView = z.union([HandoutRecord, PlayerHandoutRecord]);
export type HandoutView = z.infer<typeof HandoutView>;

const bodyFields = {
  id: z.string(),
  campaignId: z.string(),
  body: z.string(),
  rev: z.int().min(1),
};

/** Record `handout-body` (id = handoutId), DM view (FR-PARTY-01, §9). */
export const HandoutBodyRecord = z.strictObject({ ...bodyFields, sharedWith: SharedWith });
export type HandoutBodyRecord = z.infer<typeof HandoutBodyRecord>;

/** Record `handout-body`, player view: no `sharedWith` (FR-PARTY-07). */
export const PlayerHandoutBodyRecord = z.strictObject(bodyFields);
export type PlayerHandoutBodyRecord = z.infer<typeof PlayerHandoutBodyRecord>;

export const HandoutBodyView = z.union([HandoutBodyRecord, PlayerHandoutBodyRecord]);
export type HandoutBodyView = z.infer<typeof HandoutBodyView>;

/** Notification `handout-shared` payload (FR-PARTY-06). */
export const HandoutSharedPayload = z.strictObject({ handoutId: z.string() });
export type HandoutSharedPayload = z.infer<typeof HandoutSharedPayload>;

// ── Handout present (S5) ────────────────────────────────────────────────────

/** FR-PARTY-32 targets: everyone who can see it, or 1–20 unique chosen players. */
export const PresentTo = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("all") }),
  z.strictObject({
    mode: z.literal("players"),
    playerIds: z
      .array(Id)
      .min(1, "Choose at least one player")
      .max(SHARE_PLAYERS_MAX)
      .refine(unique, { message: "Each player once" }),
  }),
]);
export type PresentTo = z.infer<typeof PresentTo>;

/** `party.presentHandout` (DM, FR-PARTY-32). */
export const PresentHandoutIntent = z.strictObject({ handoutId: Id, to: PresentTo });
export type PresentHandoutIntent = z.input<typeof PresentHandoutIntent>;

export const PresentHandoutResult = z.strictObject({ presentIds: z.array(z.string()) });
export type PresentHandoutResult = z.infer<typeof PresentHandoutResult>;

/**
 * `party.closePresent` (FR-PARTY-34): `{presentId}` (player: own row; DM: any) or `{handoutId}`
 * (DM: every row of that handout). Exactly one key.
 */
export const ClosePresentIntent = z.union([
  z.strictObject({ presentId: Id }),
  z.strictObject({ handoutId: Id }),
]);
export type ClosePresentIntent = z.input<typeof ClosePresentIntent>;

/** Record `handout-present` (FR-PARTY-31, §8); DM all rows, a player only their own. */
export const HandoutPresentRecord = z.strictObject({
  id: z.string(),
  campaignId: z.string(),
  handoutId: z.string(),
  playerId: z.string(),
  presentedAt: z.string(),
});
export type HandoutPresentRecord = z.infer<typeof HandoutPresentRecord>;

// ── Party inventory ─────────────────────────────────────────────────────────

export const ItemName = cleaned(1, ITEM_NAME_MAX, "Name");
export const ItemNotes = cleaned(0, ITEM_NOTES_MAX, "Notes");
export const ItemQty = z.int().min(1).max(ITEM_QTY_MAX);

/** FR-PARTY-18: item input fields. */
const itemFields = { name: ItemName, qty: ItemQty, notes: ItemNotes };

/** `party.addItem` (DM, FR-PARTY-19). */
export const AddItemIntent = z.strictObject(itemFields);
export type AddItemIntent = z.input<typeof AddItemIntent>;
export type ItemInput = z.output<typeof AddItemIntent>;

/** `party.editItem` (DM, FR-PARTY-20): full replacement. */
export const EditItemIntent = z.strictObject({ itemId: Id, ...itemFields });
export type EditItemIntent = z.input<typeof EditItemIntent>;

/** `party.removeItem` (DM, FR-PARTY-21). */
export const RemoveItemIntent = z.strictObject({ itemId: Id, qty: ItemQty });
export type RemoveItemIntent = z.input<typeof RemoveItemIntent>;

/** An item move's end (FR-PARTY-22): `party` or a character. */
export const ItemEnd = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("party") }),
  z.strictObject({ kind: z.literal("character"), characterId: Id }),
]);
export type ItemEnd = z.infer<typeof ItemEnd>;

export function sameItemEnd(a: ItemEnd, b: ItemEnd): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "party" || a.characterId === (b as typeof a).characterId;
}

/**
 * `party.moveItem` (DM, player; FR-PARTY-22). `from ≠ to`; from `party` needs `itemId`, from a
 * character needs `rowId` (the sheet's `items` row); the other id is rejected (strict).
 */
export const MoveItemIntent = z
  .strictObject({
    from: ItemEnd,
    to: ItemEnd,
    qty: ItemQty,
    itemId: Id.optional(),
    rowId: Id.optional(),
  })
  .superRefine((v, ctx) => {
    if (sameItemEnd(v.from, v.to))
      ctx.addIssue({ code: "custom", message: "From and To must differ", path: ["to"] });
    const fromParty = v.from.kind === "party";
    if (fromParty && v.itemId === undefined)
      ctx.addIssue({ code: "custom", message: "Choose a party item", path: ["itemId"] });
    if (fromParty && v.rowId !== undefined)
      ctx.addIssue({ code: "custom", message: "No sheet row from the party", path: ["rowId"] });
    if (!fromParty && v.rowId === undefined)
      ctx.addIssue({ code: "custom", message: "Choose a sheet item", path: ["rowId"] });
    if (!fromParty && v.itemId !== undefined)
      ctx.addIssue({ code: "custom", message: "No party item from a sheet", path: ["itemId"] });
  });
export type MoveItemIntent = z.input<typeof MoveItemIntent>;

export const AddItemResult = z.strictObject({ itemId: z.string() });
export type AddItemResult = z.infer<typeof AddItemResult>;
/** `party.removeItem` / `party.moveItem` result (§9). */
export const ItemEntryResult = z.strictObject({ entryId: z.string() });
export type ItemEntryResult = z.infer<typeof ItemEntryResult>;

/** Record `party-item` (FR-PARTY-17, §8); DM and player full. */
export const PartyItemRecord = z.strictObject({
  id: z.string(),
  campaignId: z.string(),
  seq: z.int(),
  name: z.string(),
  qty: z.int().min(1).max(ITEM_QTY_MAX),
  notes: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PartyItemRecord = z.infer<typeof PartyItemRecord>;

// ── Gold ledger ─────────────────────────────────────────────────────────────

export const SplitCoin = z.int().min(0).max(SPLIT_COIN_MAX);

/**
 * `loot.split` (DM, FR-PARTY-26): 1–10 unique characters; coins 0…999 999; some share > 0
 * (⌊coin / n⌋), else "Nothing to split".
 */
export const LootSplitIntent = z
  .strictObject({
    characterIds: z
      .array(Id)
      .min(1, "Choose at least one character")
      .max(SPLIT_CHARACTERS_MAX)
      .refine(unique, { message: "Each character once" }),
    cp: SplitCoin.default(0),
    sp: SplitCoin.default(0),
    ep: SplitCoin.default(0),
    gp: SplitCoin.default(0),
    pp: SplitCoin.default(0),
  })
  .superRefine((v, ctx) => {
    if (v.characterIds.length > 0 && nothingToSplit(v, v.characterIds.length))
      ctx.addIssue({ code: "custom", message: NOTHING_TO_SPLIT });
  });
export type LootSplitIntent = z.input<typeof LootSplitIntent>;
export type SplitInput = z.output<typeof LootSplitIntent>;

export const LootSplitResult = z.strictObject({ entryIds: z.array(z.string()) });
export type LootSplitResult = z.infer<typeof LootSplitResult>;

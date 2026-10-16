// Dice looks (FR-DICEX-24–27): named styles, the derived default per owner, the stored
// `dice-look` record (D2) and `dicex.setLook`. Every client draws the roller's look: the stored
// row first, else the derived default (FR-DICEX-20).
import { z } from "zod";

export const DICE_STYLES = [
  "ivory",
  "obsidian",
  "crimson",
  "sapphire",
  "emerald",
  "amethyst",
  "gold",
  "bone",
] as const;
export const DiceStyle = z.enum(DICE_STYLES);
export type DiceStyle = z.infer<typeof DiceStyle>;

export const DICE_MATERIALS = ["plastic", "metal", "glass", "stone"] as const;
export const DiceMaterial = z.enum(DICE_MATERIALS);
export type DiceMaterial = z.infer<typeof DiceMaterial>;

/** `#rrggbb`, lower or upper case. */
export const HexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use #rrggbb");

/** FR-DICEX-24: a look = named style + body / pips colours + material. */
export const DiceLook = z.strictObject({
  style: DiceStyle,
  body: HexColour,
  pips: HexColour,
  material: DiceMaterial,
});
export type DiceLook = z.infer<typeof DiceLook>;

export const DICEX_INTENTS = { setLook: "dicex.setLook" } as const;

/** `dicex.setLook {style, body, pips, material}` (FR-DICEX-26): no owner field, owner = sender. */
export const SetLookInput = DiceLook;
export type SetLookInput = z.infer<typeof SetLookInput>;
export const SetLookResult = z.object({ lookId: z.string() });
export type SetLookResult = z.infer<typeof SetLookResult>;

export const DICE_LOOK_TYPE = "dice-look";
/** The DM's `ownerKey`; a player's is their id. */
export const DM_LOOK_KEY = "dm";

/** `dice-look` (scope campaign, FR-DICEX-25): full to the DM and every player of the campaign. */
export const DiceLookRecord = z.object({
  id: z.string(),
  campaignId: z.string(),
  ownerKey: z.string(),
  /** null = the DM. */
  ownerPlayerId: z.string().nullable(),
  style: DiceStyle,
  body: HexColour,
  pips: HexColour,
  material: DiceMaterial,
  updatedAt: z.string(),
});
export type DiceLookRecord = z.infer<typeof DiceLookRecord>;

/** Each style's starting body / pips / material. */
export const STYLE_LOOK: Record<DiceStyle, DiceLook> = {
  ivory: { style: "ivory", body: "#f4efe1", pips: "#2b2b2b", material: "plastic" },
  obsidian: { style: "obsidian", body: "#1d1d22", pips: "#e8e8e8", material: "stone" },
  crimson: { style: "crimson", body: "#9b1c24", pips: "#ffffff", material: "plastic" },
  sapphire: { style: "sapphire", body: "#1f4fa3", pips: "#ffffff", material: "glass" },
  emerald: { style: "emerald", body: "#16794a", pips: "#ffffff", material: "glass" },
  amethyst: { style: "amethyst", body: "#6b3fa0", pips: "#f4ecff", material: "glass" },
  gold: { style: "gold", body: "#c9a227", pips: "#2b1d00", material: "metal" },
  bone: { style: "bone", body: "#d9cfb8", pips: "#5a3d1e", material: "stone" },
};

/** Player defaults in order of sorted player id; the DM is Obsidian. */
const PLAYER_ORDER: readonly DiceStyle[] = [
  "crimson",
  "sapphire",
  "emerald",
  "amethyst",
  "gold",
  "bone",
  "ivory",
];

/**
 * FR-DICEX-24: the derived default look of an owner (`null` = the DM). Players are numbered by
 * sorted `id`, which every client has (snapshot order and creation time aren't sent).
 */
export function defaultLook(playerId: string | null, playerIds: readonly string[]): DiceLook {
  if (playerId === null) return STYLE_LOOK.obsidian;
  const sorted = [...new Set(playerIds)].sort();
  const i = Math.max(0, sorted.indexOf(playerId));
  return STYLE_LOOK[PLAYER_ORDER[i % PLAYER_ORDER.length] as DiceStyle];
}

/** The `ownerKey` of an owner (`null` = the DM). */
export const lookKeyOf = (playerId: string | null): string => playerId ?? DM_LOOK_KEY;

/** The look part of a stored row. */
export const lookOfRecord = (r: DiceLook): DiceLook => ({
  style: r.style,
  body: r.body,
  pips: r.pips,
  material: r.material,
});

/**
 * FR-DICEX-20 / -24: an owner's look (`null` = the DM): their stored `dice-look` row, else the
 * derived default.
 */
export function lookOf(
  playerId: string | null,
  rows: readonly DiceLookRecord[],
  playerIds: readonly string[],
): DiceLook {
  const key = lookKeyOf(playerId);
  const row = rows.find((r) => r.ownerKey === key);
  return row ? lookOfRecord(row) : defaultLook(playerId, playerIds);
}

/** Same look (colours compared case-insensitively): `dicex.setLook` writes nothing. */
export const sameLook = (a: DiceLook, b: DiceLook): boolean =>
  a.style === b.style &&
  a.material === b.material &&
  a.body.toLowerCase() === b.body.toLowerCase() &&
  a.pips.toLowerCase() === b.pips.toLowerCase();

/** WCAG relative luminance of `#rrggbb`. */
function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (ch[0] as number) + 0.7152 * (ch[1] as number) + 0.0722 * (ch[2] as number);
}

/** WCAG contrast ratio of two `#rrggbb` colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** FR-DICEX-27: pips vs body below this → inline hint (still allowed). */
export const MIN_PIP_CONTRAST = 3;

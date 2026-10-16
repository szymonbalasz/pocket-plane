// Dice looks (FR-DICEX-24): named styles and the derived default per owner. D1 draws default
// looks only; the `dice-look` record and its editor come with D2 / D3.
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
export type DiceStyle = (typeof DICE_STYLES)[number];

export type DiceMaterial = "plastic" | "metal" | "glass" | "stone";

export interface DiceLook {
  style: DiceStyle;
  /** `#rrggbb` */
  body: string;
  pips: string;
  material: DiceMaterial;
}

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

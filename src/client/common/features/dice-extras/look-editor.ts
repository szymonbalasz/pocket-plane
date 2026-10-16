// "Dice look" editor logic (FR-DICEX-27), pure: the draft starts at the owner's current look
// (stored row, else the derived default); a style swatch loads that style's starting look; Reset
// = the draft style's defaults; Save sends `dicex.setLook` only when live, valid and changed.
import {
  type DiceLook,
  type DiceMaterial,
  type DiceStyle,
  HexColour,
  STYLE_LOOK,
  sameLook,
} from "@shared/dice-extras/looks";

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

/** FR-DICEX-27: the 12-swatch palette for body and pips. */
export const LOOK_PALETTE = [
  "#ffffff",
  "#f4efe1",
  "#d9cfb8",
  "#c9a227",
  "#e07a1f",
  "#9b1c24",
  "#c2185b",
  "#6b3fa0",
  "#1f4fa3",
  "#0f8b8d",
  "#16794a",
  "#1d1d22",
] as const;

export const STYLE_NAME: Record<DiceStyle, string> = {
  ivory: "Ivory",
  obsidian: "Obsidian",
  crimson: "Crimson",
  sapphire: "Sapphire",
  emerald: "Emerald",
  amethyst: "Amethyst",
  gold: "Gold",
  bone: "Bone",
};

export const MATERIAL_NAME: Record<DiceMaterial, string> = {
  plastic: "Plastic",
  metal: "Metal",
  glass: "Glass",
  stone: "Stone",
};

/** The editor's draft: colours as typed (the hex Inputs may hold a half-typed value). */
export interface LookDraft {
  style: DiceStyle;
  body: string;
  pips: string;
  material: DiceMaterial;
}

export type DraftAction =
  | { type: "style"; style: DiceStyle }
  | { type: "body" | "pips"; value: string }
  | { type: "material"; material: DiceMaterial }
  | { type: "reset" }
  | { type: "load"; look: DiceLook };

export function draftReducer(d: LookDraft, a: DraftAction): LookDraft {
  switch (a.type) {
    case "style":
      return { ...STYLE_LOOK[a.style] };
    case "body":
      return { ...d, body: a.value };
    case "pips":
      return { ...d, pips: a.value };
    case "material":
      return { ...d, material: a.material };
    case "reset":
      return { ...STYLE_LOOK[d.style] };
    case "load":
      return { ...a.look };
  }
}

/** A typed colour is `#rrggbb` (a leading `#` may be left out); lower-cased. */
export function parseHex(v: string): string | null {
  const t = v.trim();
  const hex = t.startsWith("#") ? t : `#${t}`;
  return HexColour.safeParse(hex).success ? hex.toLowerCase() : null;
}

/** The draft as a valid look, or null while a colour is invalid. */
export function draftLook(d: LookDraft): DiceLook | null {
  const body = parseHex(d.body);
  const pips = parseHex(d.pips);
  return body && pips ? { style: d.style, body, pips, material: d.material } : null;
}

export interface EditorView {
  look: DiceLook | null;
  bodyInvalid: boolean;
  pipsInvalid: boolean;
  /** Pips vs body < 3:1: inline hint, still allowed. */
  lowContrast: boolean;
  dirty: boolean;
  canSave: boolean;
}

export function editorView(d: LookDraft, current: DiceLook, live: boolean): EditorView {
  const look = draftLook(d);
  const lowContrast = look !== null && contrastRatio(look.body, look.pips) < MIN_PIP_CONTRAST;
  const dirty = look === null || !sameLook(look, current);
  return {
    look,
    bodyInvalid: parseHex(d.body) === null,
    pipsInvalid: parseHex(d.pips) === null,
    lowContrast,
    dirty,
    canSave: live && look !== null && dirty,
  };
}

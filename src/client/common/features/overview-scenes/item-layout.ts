// How an overview item is laid out (FR-OVW-19, -27, -29, -30, -34, -36; ADR-0075 Decision 5), in
// units (1 unit = 1 px at 100 % zoom). An image's and a miniature's `x, y` = the top-left of their
// box; a label's = its dot's centre, or its text's left middle with the dot off. DOM-free so it
// runs under `bun test`; text widths come from a `MeasureText` (`label-fonts.ts` in the browser).
import {
  compareItems,
  type ItemKind,
  LABEL_FONTS,
  LABEL_STYLE_DEFAULT,
  type LabelStyle,
  MINIATURE_SCREEN_PX,
  MINIATURE_STYLE_DEFAULT,
  type MiniatureStyle,
  type PlayerOverviewItemRecord,
} from "@shared/overview-scenes/schemas";
import type { Box } from "../scenes-map/camera";

/** An item as this client holds it; `locked` reaches the DM only (FR-OVW-39). */
export type OverviewItemView = PlayerOverviewItemRecord & { locked?: boolean };

export type LabelFontKey = (typeof LABEL_FONTS)[number];

/** FR-OVW-27 → the `themes/fonts.css` families. */
export const LABEL_FONT_FAMILY: Readonly<Record<LabelFontKey, string>> = {
  fell: "IM Fell English SC",
  garamond: "EB Garamond",
  alegreya: "Alegreya Sans",
};

/** The family with a generic fallback, as Konva and the 2D canvas take it. */
export const fontStack = (font: LabelFontKey) => `"${LABEL_FONT_FAMILY[font]}", serif`;

export type MeasureText = (text: string, style: { font: LabelFontKey; size: number }) => number;

/** FR-OVW-36 default. */
export const MINIATURE_NAME_DEFAULT: MiniatureStyle = MINIATURE_STYLE_DEFAULT;

/** FR-OVW-34: a miniature's side before anything has sized it. */
export const MINIATURE_SIDE_DEFAULT = MINIATURE_SCREEN_PX;

export const labelStyleOf = (item: Pick<OverviewItemView, "style">): LabelStyle =>
  item.style && "dot" in item.style ? item.style : LABEL_STYLE_DEFAULT;

export const nameStyleOf = (item: Pick<OverviewItemView, "style">): MiniatureStyle =>
  item.style ?? MINIATURE_NAME_DEFAULT;

/** FR-OVW-19: bottom to top, each in draw order (`z`, then `seq`). */
export function itemBands<T extends Pick<OverviewItemView, "kind" | "z" | "seq">>(
  items: readonly T[],
): Record<ItemKind, T[]> {
  const bands: Record<ItemKind, T[]> = { image: [], label: [], miniature: [] };
  for (const item of [...items].sort(compareItems)) bands[item.kind].push(item);
  return bands;
}

export interface LabelLayout {
  /** The dot's radius; null with the dot off. Centred on the item's `x, y`. */
  dotR: number | null;
  /** The text box's top-left, relative to `x, y`; its height = the font size. */
  textX: number;
  textY: number;
  /** Everything drawn, strokes included, relative to `x, y` (hits, Fit, hidden outline). */
  box: Box;
}

/** FR-OVW-29: text right of the dot, vertically centred; dot off: `x, y` = its left middle. */
export function labelLayout(style: LabelStyle, textW: number): LabelLayout {
  const half = style.strokeWidth / 2;
  const textH = style.size + style.strokeWidth;
  const textY = -style.size / 2;
  if (!style.dot.on) {
    return {
      dotR: null,
      textX: 0,
      textY,
      box: { x: -half, y: -textH / 2, w: textW + style.strokeWidth, h: textH },
    };
  }
  const dotR = style.dot.size / 2;
  const dotOuter = dotR + style.dot.strokeWidth / 2;
  // A quarter of the font size between the dot's edge and the text's stroke.
  const textX = dotOuter + style.size / 4 + half;
  const h = Math.max(textH, 2 * dotOuter);
  return {
    dotR,
    textX,
    textY,
    box: { x: -dotOuter, y: -h / 2, w: dotOuter + textX + textW + half, h },
  };
}

export interface MiniatureLayout {
  side: number;
  /** The name's top, relative to `y`; centred under the miniature (FR-OVW-36). */
  nameY: number;
  /** Everything drawn, relative to `x, y`. */
  box: Box;
}

export function miniatureLayout(
  side: number,
  name: string,
  style: MiniatureStyle,
  textW: number,
): MiniatureLayout {
  const nameY = side + style.size / 8;
  if (name === "") return { side, nameY, box: { x: 0, y: 0, w: side, h: side } };
  const w = Math.max(side, textW + style.strokeWidth);
  return {
    side,
    nameY,
    box: { x: (side - w) / 2, y: 0, w, h: nameY + style.size + style.strokeWidth / 2 },
  };
}

/** The item's drawn box in units, absolute (FR-OVW-12's Fit). */
export function itemBox(item: OverviewItemView, measure: MeasureText): Box {
  const at = (b: Box): Box => ({ x: item.x + b.x, y: item.y + b.y, w: b.w, h: b.h });
  if (item.kind === "image") return { x: item.x, y: item.y, w: item.w ?? 0, h: item.h ?? 0 };
  if (item.kind === "label") {
    const style = labelStyleOf(item);
    return at(labelLayout(style, measure(item.text ?? "", style)).box);
  }
  const style = nameStyleOf(item);
  const name = item.text ?? "";
  const textW = name === "" ? 0 : measure(name, style);
  return at(miniatureLayout(item.w ?? MINIATURE_SIDE_DEFAULT, name, style, textW).box);
}

/** The fonts these items draw in. */
export function fontsIn(
  items: readonly Pick<OverviewItemView, "kind" | "style">[],
): LabelFontKey[] {
  const out = new Set<LabelFontKey>();
  for (const item of items) {
    if (item.kind === "label") out.add(labelStyleOf(item).font);
    else if (item.kind === "miniature") out.add(nameStyleOf(item).font);
  }
  return LABEL_FONTS.filter((f) => out.has(f));
}

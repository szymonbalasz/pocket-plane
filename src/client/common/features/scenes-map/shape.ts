// Token shape drawing math (FR-MAP-35). round = circular crop + ring; square = image cover-fitted
// to the footprint, square border; none = image contain-fitted, alpha kept, no border or backdrop.
// DOM-free so it runs under `bun test`.
import type { TokenShape } from "@shared/scenes-map/schemas";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Cover: the centred square of the source image (Konva `crop`), drawn at `side × side`. */
export function coverCrop(imgW: number, imgH: number): Rect {
  const s = Math.min(imgW, imgH);
  return { x: (imgW - s) / 2, y: (imgH - s) / 2, width: s, height: s };
}

/** Contain: the whole image, aspect kept, centred in `side × side`. */
export function containRect(imgW: number, imgH: number, side: number): Rect {
  if (imgW <= 0 || imgH <= 0) return { x: 0, y: 0, width: side, height: side };
  const k = Math.min(side / imgW, side / imgH);
  const width = imgW * k;
  const height = imgH * k;
  return { x: (side - width) / 2, y: (side - height) / 2, width, height };
}

/** Outline shape of selection, target and hidden rings (none: square). */
export const outlineOf = (shape: TokenShape): "circle" | "square" =>
  shape === "round" ? "circle" : "square";

/** No image: initials in a circle (round) or a rounded square (square, none). */
export const initialsBackdropOf = (shape: TokenShape): "circle" | "rounded-square" =>
  shape === "round" ? "circle" : "rounded-square";

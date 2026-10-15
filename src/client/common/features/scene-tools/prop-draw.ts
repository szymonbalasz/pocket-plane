// FR-SCN-18 prop drawing math: the `display` image cover-fitted to the drawn sides (90° / 270°
// swap them) and rotated about the footprint centre. Pure, map px.

import { propDrawnSides } from "@shared/scene-tools/geometry";
import { type PropBox, propDrawOrder } from "@shared/scene-tools/props";
import type { ToolGrid } from "../scenes-map/tools";

export interface PropFrame {
  /** Footprint top-left and size (outline, hit area). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Rotation centre and the drawn (pre-rotation) image box. */
  cx: number;
  cy: number;
  drawW: number;
  drawH: number;
  rotation: number;
}

export function propFrame(box: PropBox, rotation: number, g: ToolGrid): PropFrame {
  const cs = g.gridCellSize;
  const x = g.gridOffsetX + box.col * cs;
  const y = g.gridOffsetY + box.row * cs;
  const width = box.w * cs;
  const height = box.h * cs;
  const sides = propDrawnSides({ w: box.w, h: box.h, rotation });
  return {
    x,
    y,
    width,
    height,
    cx: x + width / 2,
    cy: y + height / 2,
    drawW: sides.w * cs,
    drawH: sides.h * cs,
    rotation,
  };
}

/** The image crop that covers a `boxW × boxH` box without distortion (centred). */
export function coverCrop(
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number,
): { x: number; y: number; width: number; height: number } {
  if (imgW <= 0 || imgH <= 0 || boxW <= 0 || boxH <= 0) {
    return { x: 0, y: 0, width: Math.max(imgW, 0), height: Math.max(imgH, 0) };
  }
  const scale = Math.max(boxW / imgW, boxH / imgH);
  const width = boxW / scale;
  const height = boxH / scale;
  return { x: (imgW - width) / 2, y: (imgH - height) / 2, width, height };
}

/** Props in draw order (FR-SCN-18); DM-only items off → hidden ones dropped (FR-SCN-05). */
export function propsToDraw<P extends { z: number; seq: number; hidden: boolean }>(
  props: readonly P[],
  dmOnlyOff: boolean,
): P[] {
  return props.filter((p) => !(dmOnlyOff && p.hidden)).sort(propDrawOrder);
}

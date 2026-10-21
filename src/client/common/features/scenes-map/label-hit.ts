// FR-MAP-89 (1): a press on a token's label row (name pill, marker, badges: what LabelsLayer draws
// for it) is a press on that token. The labels layer doesn't listen (clicks reach the token
// below), but the name pill's lower half and a name wider than the footprint lie outside the
// token's hit area, so a press there missed the token and started a pan (`moved`).
import type Konva from "konva";
import type { Box } from "./camera";

/** One drawn label-row part: its token and its rect (stage container px). */
export interface LabelHitItem {
  tokenId: string;
  rect: Box;
}

/** The token whose label-row part is topmost (drawn last) under `p`, or null. */
export function labelHitAt(
  items: readonly LabelHitItem[],
  p: { x: number; y: number },
): string | null {
  const hit = items.findLast(
    ({ rect: r }) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h,
  );
  return hit?.tokenId ?? null;
}

/**
 * The label-row parts on `stage`, in draw order: the children of each token's label group in
 * `map-labels` (name pill, badges, icon chips; each has `id` = token id).
 */
export function labelRowItems(stage: Konva.Stage): LabelHitItem[] {
  const labels = stage.findOne(".map-labels") as Konva.Group | undefined;
  if (!labels) return [];
  const out: LabelHitItem[] = [];
  for (const row of labels.getChildren()) {
    for (const part of (row as Konva.Group).getChildren?.() ?? []) {
      const id = part.id();
      if (!id) continue;
      const r = part.getClientRect();
      out.push({ tokenId: id, rect: { x: r.x, y: r.y, w: r.width, h: r.height } });
    }
  }
  return out;
}

/** The token under `p` (stage container px): its node first, else its label row; or null. */
export function tokenIdAt(stage: Konva.Stage, p: { x: number; y: number }): string | null {
  const node = stage.getIntersection(p)?.findAncestor(".map-token", true) ?? null;
  return node?.id() ?? labelHitAt(labelRowItems(stage), p);
}

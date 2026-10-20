// Map footprint helpers for window-vs-token checks (SHELL FR-SHELL-57, -77): a token's footprint is
// its grid cells on screen (`data-cell-px` each), centred on its body.
import type { Page } from "@playwright/test";
import { konvaNodes } from "./konva";

export interface Box {
  id: string;
  label: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Every drawn token's footprint, screen px, with its label text. */
export async function tokenFootprints(page: Page): Promise<Box[]> {
  const cell = Number(await page.getByTestId("map-canvas").getAttribute("data-cell-px"));
  return (await konvaNodes(page, "map-token")).map((t) => {
    const side = Math.max(1, Math.round(t.width / cell)) * cell;
    return { id: t.id, label: t.text, x: t.x - side / 2, y: t.y - side / 2, w: side, h: side };
  });
}

/**
 * Footprints of the tokens whose label (`map-token-label`, id = the token's) starts with one of
 * `names` (a cut label keeps its start).
 */
export async function footprintsOf(page: Page, names: readonly string[]): Promise<Box[]> {
  const labels = await konvaNodes(page, "map-token-label");
  // A cut label ("Mi…") is the start of its name.
  const named = (text: string, n: string) => {
    const cut = text.endsWith("…") ? text.slice(0, -1).trimEnd() : null;
    return cut === null ? text.startsWith(n) : cut.length > 0 && n.startsWith(cut);
  };
  const ids = new Set(
    labels.filter((l) => names.some((n) => named(l.text ?? "", n))).map((l) => l.id),
  );
  const text = new Map(labels.map((l) => [l.id, l.text]));
  return (await tokenFootprints(page))
    .filter((t) => ids.has(t.id))
    .map((t) => ({ ...t, label: text.get(t.id) ?? null }));
}

/** Overlap by more than half a px (rounded screen rects). */
export const overlaps = (a: Omit<Box, "id" | "label">, b: Omit<Box, "id" | "label">) =>
  a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

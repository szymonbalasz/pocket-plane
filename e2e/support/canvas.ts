// Map footprint helpers for window-vs-token checks (SHELL FR-SHELL-57, -77): a token's footprint is
// its grid cells on screen (`data-cell-px` each), centred on its body. Turn rings (FR-MAP-112).
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

/** FR-MAP-112: one drawn turn ring (`cbt-token-turn`, FR-MAP-108) on the map canvas. */
export interface TurnRing {
  /** The ringed token's id (Konva `id`). */
  id: string;
  /** Konva attr `hidden`: dashed, DM only (FR-MAP-109). */
  hidden: boolean;
  dashed: boolean;
  glow: boolean;
  listening: boolean;
  /** The group it is drawn in (`map-token`, same id) and its index there (1 = right after the hit area, under the body). */
  parent: { name: string; id: string };
  index: number;
  /** Centre in page px. */
  x: number;
  y: number;
  /** The token footprint's centre (its group's hit area), page px. */
  footprint: { x: number; y: number };
}

/** Every visible turn ring, as FR-MAP-34's other marks (AGENTS §9.5: name = test id, id = token id). */
export async function turnRings(page: Page): Promise<TurnRing[]> {
  return page.evaluate(() => {
    type KNode = {
      id(): string;
      name(): string;
      isVisible(): boolean;
      getAttr(k: string): unknown;
      listening(): boolean;
      dash(): number[] | undefined;
      shadowEnabled(): boolean;
      zIndex(): number;
      getParent(): KNode | null;
      getChildren(): KNode[];
      getClientRect(): { x: number; y: number; width: number; height: number };
    };
    type KStage = { container(): HTMLElement; find(s: string): KNode[] };
    const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
    const out: TurnRing[] = [];
    for (const stage of K?.stages ?? []) {
      const box = stage.container().getBoundingClientRect();
      for (const n of stage.find(".cbt-token-turn")) {
        if (!n.isVisible()) continue;
        const r = n.getClientRect();
        const parent = n.getParent();
        const hit = parent?.getChildren()[0]?.getClientRect() ?? r;
        out.push({
          id: n.id(),
          hidden: n.getAttr("hidden") === "true",
          dashed: (n.dash()?.length ?? 0) > 0,
          glow: n.shadowEnabled(),
          listening: n.listening(),
          parent: { name: parent?.name() ?? "", id: parent?.id() ?? "" },
          index: n.zIndex(),
          x: box.left + r.x + r.width / 2,
          y: box.top + r.y + r.height / 2,
          footprint: { x: box.left + hit.x + hit.width / 2, y: box.top + hit.y + hit.height / 2 },
        });
      }
    }
    return out;
  });
}

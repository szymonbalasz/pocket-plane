// Canvas query helpers (AGENTS §9.5): Konva node `name` = test ID, node `id` = record ID. Konva
// registers itself as `window.Konva`; every Stage is in `Konva.stages`.
import type { Page } from "@playwright/test";

export interface NodeInfo {
  id: string;
  name: string;
  /** Centre in page (viewport) px. */
  x: number;
  y: number;
  width: number;
  height: number;
  text: string | null;
  opacity: number;
}

/** Visible Konva nodes named `name` (optionally with record id `id`) on the map canvas. */
export async function konvaNodes(page: Page, name: string, id?: string): Promise<NodeInfo[]> {
  return page.evaluate(
    ([name, id]) => {
      type KNode = {
        id(): string;
        name(): string;
        isVisible(): boolean;
        getAbsoluteOpacity(): number;
        getClientRect(o?: { skipShadow?: boolean; skipStroke?: boolean }): {
          x: number;
          y: number;
          width: number;
          height: number;
        };
        getClassName(): string;
        text?: () => string;
        findOne?: (s: string) => KNode | undefined;
      };
      type KStage = { container(): HTMLElement; find(s: string): KNode[] };
      const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
      const out: NodeInfo[] = [];
      for (const stage of K?.stages ?? []) {
        const box = stage.container().getBoundingClientRect();
        for (const n of stage.find(`.${name}`)) {
          if (id !== undefined && n.id() !== id) continue;
          if (!n.isVisible()) continue;
          // BL-81: a token is its footprint (the group's first child, the hit-area Rect: side ×
          // side at the group's origin), never a child Circle (an icon row's badge) nor the group's
          // rect (widened by labels / icons). Other groups: their circle, as before.
          const isToken = n.name() === "map-token" && n.getClassName() === "Group";
          const footprint = isToken ? n.findOne?.("Rect") : undefined;
          const body =
            footprint ?? (n.getClassName() === "Group" ? (n.findOne?.("Circle") ?? n) : n);
          const r = body.getClientRect({ skipShadow: true, skipStroke: true });
          const textNode = n.getClassName() === "Text" ? n : n.findOne?.("Text");
          out.push({
            id: n.id(),
            name: n.name(),
            x: box.left + r.x + r.width / 2,
            y: box.top + r.y + r.height / 2,
            width: r.width,
            height: r.height,
            text: textNode?.text?.() ?? null,
            opacity: n.getAbsoluteOpacity(),
          });
        }
      }
      return out;
    },
    [name, id] as const,
  );
}

/** A token's footprint (centre + side in page px), BL-81. */
export async function tokenNode(page: Page, tokenId: string): Promise<NodeInfo | null> {
  return (await konvaNodes(page, "map-token", tokenId))[0] ?? null;
}

/** Map-space cell size in screen px (scale × cell). */
export async function stageScale(page: Page): Promise<number> {
  return page.evaluate(() => {
    const K = (window as unknown as { Konva?: { stages: { scaleX(): number }[] } }).Konva;
    return K?.stages[0]?.scaleX() ?? 1;
  });
}

// Token screen boxes for placing panels clear of the tokens the DM needs to click (FR-CBT-56 popup,
// FR-NOTE-32 toast stack). `coveredArea` is pure; `tokenScreenBoxes` reads the live map canvas.

/** A token's on-screen box, px. */
export interface TokenBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Area of `boxes` under the rect (x, y, w, h), px². */
export function coveredArea(
  r: { x: number; y: number; w: number; h: number },
  boxes: readonly TokenBox[],
): number {
  return boxes.reduce(
    (sum, t) =>
      sum +
      Math.max(0, Math.min(r.x + r.w, t.x + t.w) - Math.max(r.x, t.x)) *
        Math.max(0, Math.min(r.y + r.h, t.y + t.h) - Math.max(r.y, t.y)),
    0,
  );
}

interface KonvaNode {
  id(): string;
  getClientRect(): { x: number; y: number; width: number; height: number };
}
interface KonvaStage {
  container(): HTMLElement;
  find(selector: string): KonvaNode[];
}

/**
 * On-screen box of each drawn token in `tokenIds` on the map canvas (Konva `name` / `id`, AGENTS
 * §9.5); tokens not drawn (other scene, no canvas) are left out.
 */
export function tokenScreenBoxes(tokenIds: readonly string[]): TokenBox[] {
  if (tokenIds.length === 0 || typeof window === "undefined") return [];
  const K = (window as unknown as { Konva?: { stages: KonvaStage[] } }).Konva;
  const stage = K?.stages.find((s) => s.container().isConnected);
  if (!stage) return [];
  const box = stage.container().getBoundingClientRect();
  const want = new Set(tokenIds);
  return stage
    .find(".map-token")
    .filter((n) => want.has(n.id()))
    .map((n) => {
      const r = n.getClientRect();
      return { x: box.left + r.x, y: box.top + r.y, w: r.width, h: r.height };
    });
}

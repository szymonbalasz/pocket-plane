// Attack popup placement (FR-CBT-55, G2): vertically centred at the left or right edge of the
// work area, on the side farther from the centre of its selection rows' tokens (none: the
// attacker's likely targets, FR-CBT-56; none either: left); on the right it sits just left of an
// open Initiative window. Fixed once per open; not draggable. `popupPlacement` and
// `placementTokenIds` are pure; `measurePlacement` reads the live screen.
import type { CombatantKind } from "@shared/combat-tracker/schemas";
import { INITIATIVE_KIND } from "@ui/features/combat-tracker/window";
import { EDGE_GAP, LAUNCHER_CLEAR, TOP_BAR_H } from "@ui/features/play-shell/geometry";
import { windowId } from "@ui/features/play-shell/manager";
import { RAIL_CLEAR } from "@ui/features/play-shell/placement";
import type { TargetCandidate } from "./targets";

/**
 * FR-CBT-55/56: the tokens the popup side is measured from, at open. Selection rows' tokens win;
 * with none, the attacker's **likely targets**: active, non-removed combatants of the encounter
 * of the other kind (monster → PCs, PC → monsters) bound to a token on the viewed scene.
 */
export function placementTokenIds<C extends TargetCandidate & { kind: CombatantKind }>(o: {
  rowTokenIds: readonly string[];
  combatants: readonly C[];
  encounterId: string;
  attackerId: string;
  tokenSceneOf(tokenId: string): string | null;
  viewedSceneId: string | null;
}): string[] {
  if (o.rowTokenIds.length > 0) return [...o.rowTokenIds];
  const attacker = o.combatants.find((c) => c.id === o.attackerId);
  if (!attacker || !o.viewedSceneId) return [];
  return o.combatants.flatMap((c) =>
    c.encounterId === o.encounterId &&
    c.id !== o.attackerId &&
    c.active !== false &&
    !c.removed &&
    c.kind !== attacker.kind &&
    c.tokenId &&
    o.tokenSceneOf(c.tokenId) === o.viewedSceneId
      ? [c.tokenId]
      : [],
  );
}

/** Popup width, px (the panel is `min(440px, 100vw - 2rem)`). */
export const POPUP_W = 440;

export interface PlacementInput {
  viewport: { w: number; h: number };
  /** Screen x of each selection row's token centre. */
  tokenXs: readonly number[];
  /** Screen rect of the DM's open Initiative window, if any. */
  initiative: { x: number; w: number } | null;
  width: number;
}

export interface Placement {
  side: "left" | "right";
  /** Left edge, px. */
  x: number;
  /** Work area (below the top bar, above the launcher): the popup centres in it. */
  top: number;
  bottom: number;
}

export function popupPlacement(i: PlacementInput): Placement {
  const top = TOP_BAR_H + EDGE_GAP;
  const bottom = i.viewport.h - LAUNCHER_CLEAR;
  const left = RAIL_CLEAR;
  const centre = (left + i.viewport.w - EDGE_GAP) / 2;
  const n = i.tokenXs.length;
  const mean = n > 0 ? i.tokenXs.reduce((s, x) => s + x, 0) / n : null;
  // Tokens right of centre → the popup goes left, and vice versa; no token → left.
  const side = mean !== null && mean < centre ? "right" : "left";
  if (side === "left") return { side, x: left, top, bottom };
  const edge = i.initiative ? i.initiative.x - EDGE_GAP : i.viewport.w - EDGE_GAP;
  return { side, x: Math.max(left, edge - i.width), top, bottom };
}

interface KonvaNode {
  id(): string;
  getClientRect(): { x: number; y: number; width: number; height: number };
}
interface KonvaStage {
  container(): HTMLElement;
  find(selector: string): KonvaNode[];
}

/** Screen x of each token's centre on the DM's map canvas (Konva `name` / `id`, AGENTS §9.5). */
function tokenScreenXs(tokenIds: readonly string[]): number[] {
  if (tokenIds.length === 0) return [];
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
      return box.left + r.x + r.width / 2;
    });
}

export function measurePlacement(tokenIds: readonly string[]): Placement {
  const viewport = { w: window.innerWidth, h: window.innerHeight };
  const win = document.querySelector<HTMLElement>(
    `[data-testid="ui-window"][data-record-id="${windowId(INITIATIVE_KIND)}"]`,
  );
  const r = win?.getBoundingClientRect();
  return popupPlacement({
    viewport,
    tokenXs: tokenScreenXs(tokenIds),
    initiative: r && r.width > 0 ? { x: r.left, w: r.width } : null,
    width: Math.min(POPUP_W, viewport.w - 32),
  });
}

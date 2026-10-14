// Attack popup placement (FR-CBT-55, G2): vertically centred in the work area, never over an open
// Initiative window, at the candidate position that covers the least of its selection rows'
// tokens (none: the attacker's likely targets, FR-CBT-56); ties: the side farther from their
// centre (none: left). Fixed once per open; not draggable. `popupPlacement` and
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

/** A token's on-screen box, px. */
export interface TokenBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacementInput {
  viewport: { w: number; h: number };
  /** On-screen boxes of the tokens the popup must not cover (FR-CBT-55/56). */
  tokens: readonly TokenBox[];
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

/**
 * FR-CBT-55/56 (walkthrough step 8 ruling): candidate left edges are the work area's left edge,
 * just left of the Initiative window (or the right edge), and beside each token (the popup sits
 * above other windows, so they don't constrain it). Each is scored by the area of the tokens it
 * covers, the popup taken as the work area's full height (its height is unknown at open); the
 * least overlap wins. Ties keep the side rule (farther from the tokens' mean x; none → left),
 * then the edges, then the candidate nearest that side's edge.
 */
export function popupPlacement(i: PlacementInput): Placement {
  const top = TOP_BAR_H + EDGE_GAP;
  const bottom = i.viewport.h - LAUNCHER_CLEAR;
  const left = RAIL_CLEAR;
  const centre = (left + i.viewport.w - EDGE_GAP) / 2;
  const edge = i.initiative ? i.initiative.x - EDGE_GAP : i.viewport.w - EDGE_GAP;
  const right = Math.max(left, edge - i.width);
  const clamp = (x: number) => Math.min(right, Math.max(left, x));
  const n = i.tokens.length;
  const mean = n > 0 ? i.tokens.reduce((s, t) => s + t.x + t.w / 2, 0) / n : null;
  // Tokens right of centre → the popup goes left, and vice versa; no token → left.
  const ruleX = mean !== null && mean < centre ? right : left;
  const covered = (x: number) =>
    i.tokens.reduce(
      (sum, t) =>
        sum +
        Math.max(0, Math.min(x + i.width, t.x + t.w) - Math.max(x, t.x)) *
          Math.max(0, Math.min(bottom, t.y + t.h) - Math.max(top, t.y)),
      0,
    );
  const candidates = [
    ruleX,
    left,
    right,
    ...i.tokens.flatMap((t) => [clamp(t.x + t.w + EDGE_GAP), clamp(t.x - EDGE_GAP - i.width)]),
  ];
  let best = ruleX;
  let bestArea = covered(ruleX);
  for (const x of candidates) {
    const area = covered(x);
    // Strictly less wins, so ties keep the side rule, then the edges (listed first).
    if (area < bestArea) {
      best = x;
      bestArea = area;
    }
  }
  const side =
    best === left
      ? "left"
      : best === right
        ? "right"
        : best + i.width / 2 < centre
          ? "left"
          : "right";
  return { side, x: best, top, bottom };
}

interface KonvaNode {
  id(): string;
  getClientRect(): { x: number; y: number; width: number; height: number };
}
interface KonvaStage {
  container(): HTMLElement;
  find(selector: string): KonvaNode[];
}

/** On-screen box of each token on the DM's map canvas (Konva `name` / `id`, AGENTS §9.5). */
function tokenScreenBoxes(tokenIds: readonly string[]): TokenBox[] {
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
      return { x: box.left + r.x, y: box.top + r.y, w: r.width, h: r.height };
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
    tokens: tokenScreenBoxes(tokenIds),
    initiative: r && r.width > 0 ? { x: r.left, w: r.width } : null,
    width: Math.min(POPUP_W, viewport.w - 32),
  });
}

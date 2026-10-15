// Attack popup placement (FR-CBT-55, G2): in the work area, never over an open Initiative window,
// at the candidate spot that covers the least of its selection rows' tokens (none: the attacker's
// likely targets, FR-CBT-56), then of the likely targets, then of the other combatants' tokens
// (P3 glitch 2); ties: the side farther from the first tier's centre (none: left), centred.
// Opened from a notification: over it unless that covers a target (FR-CBT-75). Placed once per
// open; then the DM may drag it (FR-CBT-76), always clamped into the work area. `popupPlacement`,
// `placementTiers`, `clampIntoWorkArea` and `dragPopup` are pure; `measurePlacement` reads the
// live screen.
import type { CombatantKind } from "@shared/combat-tracker/schemas";
import { INITIATIVE_KIND } from "@ui/features/combat-tracker/window";
import {
  EDGE_GAP,
  LAUNCHER_CLEAR,
  moveRect,
  type Rect,
  TOP_BAR_H,
  type Viewport,
  workArea,
} from "@ui/features/play-shell/geometry";
import { windowId } from "@ui/features/play-shell/manager";
import { RAIL_CLEAR } from "@ui/features/play-shell/placement";
import { coveredArea, type TokenBox, tokenScreenBoxes } from "@ui/features/play-shell/token-boxes";
import type { TargetCandidate } from "./targets";

export type { TokenBox };

interface TierInput<C> {
  rowTokenIds: readonly string[];
  combatants: readonly C[];
  encounterId: string;
  attackerId: string;
  tokenSceneOf(tokenId: string): string | null;
  viewedSceneId: string | null;
}

/**
 * FR-CBT-55/56: the tokens the popup side is measured from, at open. Selection rows' tokens win;
 * with none, the attacker's **likely targets**: active, non-removed combatants of the encounter
 * of the other kind (monster → PCs, PC → monsters) bound to a token on the viewed scene.
 */
export function placementTokenIds<C extends TargetCandidate & { kind: CombatantKind }>(
  o: TierInput<C>,
): string[] {
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

/**
 * FR-CBT-56 (P3 glitch 2): the placement tiers at open, most important first: (0) the selection
 * rows' tokens, else the likely targets; (1) with rows, the other likely targets; (2) every other
 * active combatant's token on the viewed scene. A tier only breaks the ties of the ones before.
 */
export function placementTiers<C extends TargetCandidate & { kind: CombatantKind }>(
  o: TierInput<C>,
): string[][] {
  const first = placementTokenIds(o);
  const likely =
    o.rowTokenIds.length > 0
      ? placementTokenIds({ ...o, rowTokenIds: [] }).filter((t) => !first.includes(t))
      : [];
  const taken = new Set([...first, ...likely]);
  const rest = o.viewedSceneId
    ? o.combatants.flatMap((c) =>
        c.encounterId === o.encounterId &&
        c.active !== false &&
        !c.removed &&
        c.tokenId &&
        !taken.has(c.tokenId) &&
        o.tokenSceneOf(c.tokenId) === o.viewedSceneId
          ? [c.tokenId]
          : [],
      )
    : [];
  return [first, likely, rest];
}

/** Popup width, px (the panel is `min(440px, 100vw - 2rem)`). */
export const POPUP_W = 440;

export interface PlacementInput {
  viewport: { w: number; h: number };
  /** On-screen boxes of the tokens the popup must not cover (FR-CBT-55/56). */
  tokens: readonly TokenBox[];
  /** Lower tiers (`placementTiers`): compared only when the tiers before tie. */
  others?: readonly (readonly TokenBox[])[];
  /** Screen rect of the DM's open Initiative window, if any. */
  initiative: { x: number; w: number } | null;
  width: number;
  /** The panel's measured height: spots above / below tokens count. Absent: full height, centred. */
  height?: number;
  /**
   * FR-CBT-75: its notification's top-left (clamped). Kept unless the popup there covers a token
   * of the first two tiers; then the usual pick.
   */
  prefer?: { x: number; y: number };
}

export interface Placement {
  side: "left" | "right" | "origin";
  /** Left edge, px. */
  x: number;
  /** Top edge, px; absent (no measured height) → centred in the work area. */
  y?: number;
  /** Work area (below the top bar, above the launcher): the popup fits in it. */
  top: number;
  bottom: number;
}

/** Lexicographic: tier 0 first, a lower tier only on a tie. */
function less(a: readonly number[], b: readonly number[]): boolean {
  for (let k = 0; k < a.length; k++) {
    const x = a[k] ?? 0;
    const y = b[k] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/**
 * FR-CBT-55/56 (walkthrough step 8 ruling; P3 glitch 2): candidate left edges are the work area's
 * left edge, just left of the Initiative window (or the right edge), and beside each token (the
 * popup sits above other windows, so they don't constrain it); with a measured height, candidate
 * tops are centred, the work area's top and bottom, and above / below each token. Each spot is
 * scored by the token area it covers, tier by tier; the least wins. Ties keep the side rule
 * (farther from the first tier's mean x; none → left) and centred, then the edges, then the
 * candidate nearest that side's edge.
 */
export function popupPlacement(i: PlacementInput): Placement {
  const top = TOP_BAR_H + EDGE_GAP;
  const bottom = i.viewport.h - LAUNCHER_CLEAR;
  const left = RAIL_CLEAR;
  const centre = (left + i.viewport.w - EDGE_GAP) / 2;
  const edge = i.initiative ? i.initiative.x - EDGE_GAP : i.viewport.w - EDGE_GAP;
  const right = Math.max(left, edge - i.width);
  const clamp = (x: number) => Math.min(right, Math.max(left, x));
  const tiers = [i.tokens, ...(i.others ?? [])];
  const all = tiers.flat();
  const h = i.height === undefined ? bottom - top : Math.min(i.height, bottom - top);
  const clampY = (y: number) => Math.min(bottom - h, Math.max(top, y));
  const score = (x: number, y: number) => tiers.map((t) => coveredArea({ x, y, w: i.width, h }, t));
  const n = i.tokens.length;
  const mean = n > 0 ? i.tokens.reduce((s, t) => s + t.x + t.w / 2, 0) / n : null;
  // Tokens right of centre → the popup goes left, and vice versa; no token → left.
  const ruleX = mean !== null && mean < centre ? right : left;
  const result = (x: number, y: number, origin = false): Placement => ({
    side: origin
      ? "origin"
      : x === left
        ? "left"
        : x === right
          ? "right"
          : x + i.width / 2 < centre
            ? "left"
            : "right",
    x,
    ...(i.height === undefined ? {} : { y }),
    top,
    bottom,
  });
  if (i.prefer) {
    const [t0 = 0, t1 = 0] = score(i.prefer.x, i.prefer.y);
    if (t0 === 0 && t1 === 0) return result(i.prefer.x, i.prefer.y, true);
  }
  const xs = [
    ruleX,
    left,
    right,
    ...all.flatMap((t) => [clamp(t.x + t.w + EDGE_GAP), clamp(t.x - EDGE_GAP - i.width)]),
  ];
  const ys =
    i.height === undefined
      ? [top]
      : [
          clampY(top + (bottom - top - h) / 2),
          top,
          bottom - h,
          ...all.flatMap((t) => [clampY(t.y + t.h + EDGE_GAP), clampY(t.y - EDGE_GAP - h)]),
        ];
  let best = { x: ruleX, y: ys[0] ?? top };
  let bestScore = score(best.x, best.y);
  for (const x of xs) {
    for (const y of ys) {
      const s = score(x, y);
      // Strictly less wins, so ties keep the side rule and centred, then the edges (listed first).
      if (less(s, bestScore)) {
        best = { x, y };
        bestScore = s;
      }
    }
  }
  return result(best.x, best.y);
}

/**
 * The live placement: token boxes per tier from the map canvas, the open Initiative window, the
 * panel's measured size and (FR-CBT-75) its notification's top-left.
 */
export function measurePlacement(
  tiers: readonly (readonly string[])[],
  size?: { w: number; h: number },
  origin?: { x: number; y: number } | null,
): Placement {
  const viewport = { w: window.innerWidth, h: window.innerHeight };
  const win = document.querySelector<HTMLElement>(
    `[data-testid="ui-window"][data-record-id="${windowId(INITIATIVE_KIND)}"]`,
  );
  const r = win?.getBoundingClientRect();
  const [first = [], ...rest] = tiers.map((t) => tokenScreenBoxes(t));
  return popupPlacement({
    viewport,
    tokens: first,
    others: rest,
    initiative: r && r.width > 0 ? { x: r.left, w: r.width } : null,
    width: size?.w ?? Math.min(POPUP_W, viewport.w - 32),
    height: size?.h,
    prefer: origin && size ? originPlacement(origin, size, viewport) : undefined,
  });
}

/**
 * FR-CBT-75/76: `r` moved (never resized) so it lies inside the work area (FR-SHELL-29: below the
 * top bar, above the launcher); taller / wider than the area → its top-left corner stays inside.
 */
export function clampIntoWorkArea(r: Rect, vp: Viewport): Rect {
  const wa = workArea(vp);
  const x = Math.max(0, Math.min(r.x, wa.w - r.w));
  const y = Math.max(TOP_BAR_H, Math.min(r.y, TOP_BAR_H + wa.h - r.h));
  return { ...r, x: Math.round(x), y: Math.round(y) };
}

/** FR-CBT-75: opened from a toast / Notifications row → its top-left at the origin's, clamped. */
export function originPlacement(
  origin: { x: number; y: number },
  size: { w: number; h: number },
  vp: Viewport,
): Rect {
  return clampIntoWorkArea({ x: origin.x, y: origin.y, ...size }, vp);
}

/** FR-CBT-76: a header drag by (dx, dy) from `start` (play-shell's `moveRect`), in the work area. */
export function dragPopup(start: Rect, dx: number, dy: number, vp: Viewport): Rect {
  return clampIntoWorkArea(moveRect(start, dx, dy, vp), vp);
}

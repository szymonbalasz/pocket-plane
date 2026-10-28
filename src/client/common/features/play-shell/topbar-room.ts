// BL-136 (FR-THEME-05, FR-KIT-14): the launcher's room in the top bar, the same under every theme.
// The centre zone is what the title and the right cluster leave, and Gilt & Stone draws their text
// in its own faces (the title zone in `--font-title`, the rest in `--font-body`), so the zone
// drawn is a few px wider or narrower by theme. The room counts each text run at the wider of
// Simple Dark's width (measured) and Gilt's (committed advance tables, as the labels'): never more
// than the zone drawn, and the same number under both themes.
import { GILT_LABEL_ADVANCE, GILT_LABEL_UPEM, LAUNCHER_MIN_ZONE } from "./launcher-fit";

/** Gilt & Stone's face for a top-bar run: `title` (IM Fell English SC) or `body` (Alegreya Sans). */
export type GiltFace = "title" | "body";

/**
 * Alegreya Sans (Gilt's `--font-body`) per committed weight (`themes/fonts.css`): advances for
 * U+0020–U+007E in font units, `ALEGREYA_UPEM` per em, read off the committed woff2 files (test
 * `BL-136 the Alegreya Sans tables are the committed fonts'`).
 */
export const ALEGREYA_UPEM = 1000;
export const ALEGREYA_ADVANCE: Readonly<Record<400 | 500 | 700, readonly number[]>> = {
  400: [
    165, 256, 280, 516, 428, 824, 694, 166, 288, 306, 374, 480, 229, 307, 229, 287, 528, 344, 455,
    412, 481, 418, 470, 417, 474, 470, 229, 229, 480, 480, 480, 331, 825, 578, 537, 520, 646, 482,
    434, 600, 684, 268, 310, 547, 416, 789, 683, 635, 520, 639, 555, 472, 490, 626, 564, 893, 594,
    528, 528, 288, 287, 288, 424, 450, 389, 462, 514, 385, 518, 461, 303, 487, 520, 242, 265, 456,
    247, 800, 516, 491, 509, 510, 323, 370, 319, 510, 423, 674, 435, 427, 412, 288, 314, 288, 480,
  ],
  500: [
    160, 260, 310, 529, 437, 836, 701, 182, 291, 303, 378, 480, 229, 306, 229, 286, 525, 351, 462,
    420, 490, 423, 475, 424, 482, 475, 229, 229, 480, 480, 480, 335, 833, 587, 554, 519, 650, 493,
    443, 599, 689, 279, 321, 563, 423, 792, 688, 639, 534, 643, 570, 483, 495, 631, 573, 897, 606,
    541, 536, 291, 286, 291, 431, 447, 389, 470, 518, 385, 521, 465, 314, 492, 525, 250, 275, 472,
    254, 803, 521, 492, 513, 514, 334, 376, 327, 515, 433, 685, 446, 435, 417, 291, 311, 291, 480,
  ],
  700: [
    151, 264, 354, 549, 450, 854, 711, 205, 295, 300, 383, 480, 229, 304, 229, 284, 521, 360, 471,
    431, 503, 432, 483, 432, 493, 483, 229, 229, 480, 480, 480, 340, 844, 600, 579, 517, 655, 509,
    456, 598, 696, 295, 335, 584, 433, 797, 695, 643, 553, 649, 590, 498, 503, 638, 587, 903, 623,
    558, 547, 295, 284, 295, 441, 444, 389, 481, 523, 385, 526, 472, 329, 500, 533, 261, 285, 495,
    263, 807, 529, 494, 518, 519, 348, 384, 338, 522, 445, 698, 461, 447, 424, 295, 307, 295, 480,
  ],
};

/** The Alegreya Sans face CSS font matching picks for `weight` among 400, 500, 700. */
export function alegreyaWeight(weight: number): 400 | 500 | 700 {
  return weight <= 400 ? 400 : weight <= 500 ? 500 : 700;
}

/**
 * A run's width in its Gilt face, px: no kerning, a character outside the table as the widest,
 * IM Fell's synthetic bold (one face, 400) at `px / 24` more per character from 600, plus 1 px.
 */
export function giltTextWidth(text: string, face: GiltFace, weight: number, px: number): number {
  const adv = face === "title" ? GILT_LABEL_ADVANCE : ALEGREYA_ADVANCE[alegreyaWeight(weight)];
  const upem = face === "title" ? GILT_LABEL_UPEM : ALEGREYA_UPEM;
  const widest = Math.max(...adv);
  let units = 0;
  let n = 0;
  for (const ch of text) {
    units += adv[(ch.codePointAt(0) ?? 0) - 32] ?? widest;
    n++;
  }
  const bold = face === "title" && weight >= 600 ? (n * px) / 24 : 0;
  return (units * px) / upem + bold + 1;
}

/** One text run in the top bar's title zone or right cluster. */
export interface TopBarRun {
  text: string;
  /** Font size, px, and weight (computed). */
  px: number;
  weight: number;
  face: GiltFace;
  /** Width in the font it is drawn in now, px. */
  current: number;
  /** Width in Simple Dark's font (`--font-sans`, same size and weight), px. */
  plain: number;
  /** Its box's max width when the run truncates there (`text-overflow: ellipsis`), px. */
  cap?: number;
}

/** How much wider than drawn the run counts (its widest across themes, within its cap), px. */
export function runExtra(r: TopBarRun): number {
  const cap = r.cap ?? Number.POSITIVE_INFINITY;
  const widest = Math.max(r.plain, giltTextWidth(r.text, r.face, r.weight, r.px));
  return Math.min(cap, widest) - Math.min(cap, r.current);
}

export interface TopBarZones {
  /** Drawn widths, px: the centre zone, the title zone. */
  centre: number;
  left: number;
  /** The title zone's widest share (`TOP_TITLE_MAX` of the bar's content box), px. */
  leftCap: number;
  /** Something in the title zone is cut off now (it is at its cap whatever the theme). */
  leftTruncated: boolean;
  leftRuns: readonly TopBarRun[];
  rightRuns: readonly TopBarRun[];
}

const sum = (runs: readonly TopBarRun[]) => runs.reduce((s, r) => s + runExtra(r), 0);

/**
 * The launcher's fit room, px: the centre zone with the title zone and right cluster at their
 * theme-independent widths. Never wider than drawn; never below the "⋯" trigger's zone.
 */
export function launcherRoom(z: TopBarZones): number {
  const left = z.leftTruncated ? z.leftCap : Math.min(z.leftCap, z.left + sum(z.leftRuns));
  const room = Math.floor(z.centre - Math.max(0, left - z.left) - Math.max(0, sum(z.rightRuns)));
  return Math.min(Math.floor(z.centre), Math.max(Math.min(LAUNCHER_MIN_ZONE, z.centre), room));
}

/** The Gilt face of a run in the title zone (`ui-topbar-left`, except `topbar-sub`) or not. */
function faceOf(el: Element): GiltFace {
  return el.closest('[data-testid="ui-topbar-left"]') && !el.closest('[data-slot="topbar-sub"]')
    ? "title"
    : "body";
}

/**
 * The text runs under `zone` that size it: rendered, in flow, not in a fixed-width top-bar item
 * (FR-SHELL-112 (3)); white space between flex items is not drawn. `measure(font, text)` = a
 * canvas measure; `sans` = Simple Dark's `--font-sans` family.
 */
export function topBarRuns(
  zone: Element,
  measure: (font: string, text: string) => number,
  sans: string,
): TopBarRun[] {
  const runs: TopBarRun[] = [];
  const walk = zone.ownerDocument.createTreeWalker(zone, NodeFilter.SHOW_TEXT);
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    const el = node.parentElement;
    if (!el || el.closest('[data-testid="ui-topbar-item"]')) continue;
    const cs = getComputedStyle(el);
    if (cs.position === "absolute" || cs.position === "fixed" || el.getClientRects().length === 0) {
      continue;
    }
    const text = (node.textContent ?? "").replace(/\s+/g, " ");
    if (!text) continue;
    if (!text.trim() && /flex|grid/.test(cs.display)) continue;
    const font = (family: string) => `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${family}`;
    const cap = cs.textOverflow === "ellipsis" && cs.maxWidth.endsWith("px");
    runs.push({
      text,
      px: Number.parseFloat(cs.fontSize),
      weight: Number(cs.fontWeight) || 400,
      face: faceOf(el),
      current: measure(font(cs.fontFamily), text),
      plain: measure(font(sans), text),
      ...(cap && { cap: Number.parseFloat(cs.maxWidth) }),
    });
  }
  return runs;
}

/** Something in `zone` (or `zone` itself) is cut off. */
export function truncated(zone: Element): boolean {
  if (zone.scrollWidth > zone.clientWidth + 0.5) return true;
  for (const el of zone.querySelectorAll("*")) {
    const clips = getComputedStyle(el).overflowX !== "visible";
    if (clips && el.scrollWidth > el.clientWidth + 0.5) return true;
  }
  return false;
}

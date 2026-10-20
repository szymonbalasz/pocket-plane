// The roll popup's content and geometry (FR-DICEX-38–41, -46, -47), pure, in the lazy popup
// chunk. One named row per entry (sim-7: no "· N rolls"), read from `payload` only (never
// `dmPayload`); the dice line's cells and the card's pixel budget (§6.1 tables A, B); how many
// popups fit the toast region; the miniature's clip to its popup's visible rect; the DM stack's
// keep-clear of Initiative and the open combat popup.
import type { ThrowDie } from "@shared/dice-extras/throw";
import type { GameLogEntryView } from "@shared/dice-roll-log/schemas";
import { z } from "zod";
import type { Rect } from "../play-shell/geometry";
import { EDGE_GAP } from "../play-shell/geometry";
import { RAIL_CLEAR } from "../play-shell/placement";
import { STACK_GAP } from "../play-shell/toast-region";

// ---- the dice line (FR-DICEX-46, §6.1 table A) ----

/** One cell: a die at full size, never scaled by the count or the viewport (OQ-DICEX-34). */
export const CELL_PX = 44;
export const CELL_GAP = 4;
export const CELLS_PER_LINE = 6;
/** ≤ 2 lines (OQ-DICEX-33): > 6 dice wrap; > 12 → 11 dice + a "+N" cell. */
export const CELL_LINES = 2;
/** The line's width: 6 cells and their gaps (284 px, inside the card's 296 px). */
export const LINE_W = CELLS_PER_LINE * CELL_PX + (CELLS_PER_LINE - 1) * CELL_GAP;

/** A slot of the line: `index` from 0, `line` 1 | 2, `x` / `y` its top-left in px. */
export interface CellSlot {
  index: number;
  line: number;
  x: number;
  y: number;
}

export interface PopupCell extends CellSlot {
  die: ThrowDie;
}

export interface PopupLine {
  /** The dice drawn in cells, in `throwDice` order. */
  cells: PopupCell[];
  /** The "+N" cell: every die not shown; `entryId` = the first hidden die's entry. */
  more: (CellSlot & { n: number; entryId: string }) | null;
  /** Lines used (0 without dice). */
  lines: number;
  /** The line box: `LINE_W` × the lines' height. */
  w: number;
  h: number;
}

const slotAt = (index: number): CellSlot => ({
  index,
  line: Math.floor(index / CELLS_PER_LINE) + 1,
  x: (index % CELLS_PER_LINE) * (CELL_PX + CELL_GAP),
  y: Math.floor(index / CELLS_PER_LINE) * (CELL_PX + CELL_GAP),
});

/** Height of `lines` dice lines (px). */
export const linesH = (lines: number) => (lines > 0 ? lines * CELL_PX + (lines - 1) * CELL_GAP : 0);

/**
 * FR-DICEX-46: the frame's dice (`throwDice` order) in cells; `more` = dice beyond the throw's 20
 * (FR-DICEX-14), counted in "+N" too.
 */
export function popupLine(dice: readonly ThrowDie[], more = 0): PopupLine {
  const cap = CELLS_PER_LINE * CELL_LINES;
  const all = dice.length + more;
  const shown = all > cap ? cap - 1 : dice.length;
  const cells = dice.slice(0, shown).map((die, i) => ({ ...slotAt(i), die }));
  const first = dice[shown];
  const plus =
    all > shown && first ? { ...slotAt(shown), n: all - shown, entryId: first.entryId } : null;
  const used = plus ? shown + 1 : shown;
  const lines = Math.ceil(used / CELLS_PER_LINE);
  return { cells, more: plus, lines, w: LINE_W, h: linesH(lines) };
}

/** A MOD / offered die's tag (cut to the cell with "…") and its full text (the die's Tooltip). */
export function cellTag(d: ThrowDie): { tag: string; full: string } | null {
  if (!d.label && !d.offered) return null;
  const tag = `${d.sign === -1 ? "−" : ""}${d.label ?? ""}`;
  return { tag, full: d.offered ? `${tag} on a hit` : tag };
}

// ---- the card's pixel budget (FR-DICEX-47, §6.1 table B) ----

/** Padding top and bottom (border included). */
export const POPUP_PAD = 10;
/** One entry row: actor, label, its total at the right (the first also holds ✕ and ⚙). */
export const ROW_H = 22;
/** Rows shown; more scroll inside. */
export const ROWS_SHOWN = 3;
/** Gap rows → dice. */
export const ROWS_GAP = 8;
/** Cell tags overhang the last line by this. */
export const TAG_OVERHANG = 4;

/** FR-DICEX-47: a card's height with `rows` entry rows and `lines` dice lines (≤ 190). */
export function popupHeight(rows: number, lines: number): number {
  const body = lines > 0 ? ROWS_GAP + linesH(lines) + TAG_OVERHANG : 0;
  return 2 * POPUP_PAD + Math.min(Math.max(rows, 1), ROWS_SHOWN) * ROW_H + body;
}

/**
 * FR-DICEX-47 short screens: how many cards (heights newest first) fit `room` px with
 * `STACK_GAP` between them; the newest always shows.
 */
export function popupsThatFit(heights: readonly number[], room: number): number {
  let used = 0;
  let n = 0;
  for (const h of heights) {
    const next = used + (n > 0 ? STACK_GAP : 0) + h;
    if (n > 0 && next > room) break;
    used = next;
    n += 1;
  }
  return n;
}

/** One payload item as its row shows it (FR-DICEX-40: as the line, FR-DICE-20, -29). */
export interface PopupItem {
  /** The item's roll id (a React key). */
  key: string;
  /** The item's label, else its expression. */
  label: string;
  total: number;
  mode: "adv" | "dis" | null;
  /** "natural 20!" / "natural 1" (never on an `initiative` roll, FR-DICE-29). */
  natural: string | null;
  physical: boolean;
  /** Offered trigger parts (Divine Fury): "on a hit", outside the total (FR-DICEX-13). */
  offered: { key: string; label: string; value: number }[];
}

export interface PopupRow {
  entryId: string;
  /** The entry's `actorName`: "Mira", "Goblin", "DM". */
  actor: string;
  /** DM-only (only ever true on the DM client): the eye-off marker. */
  hidden: boolean;
  items: PopupItem[];
}

// Lenient reads, as `throwDice`: an item that doesn't parse is skipped.
const Offered = z.looseObject({
  rollId: z.string().optional(),
  label: z.string().nullable(),
  value: z.number(),
});
const Item = z.looseObject({
  rollId: z.string().optional(),
  expression: z.string(),
  mode: z.string().optional(),
  manual: z.boolean(),
  total: z.number(),
  natural: z.number().nullable().optional(),
  label: z.string().nullable(),
  offered: z.array(Offered).optional(),
});

const MODE = { advantage: "adv", disadvantage: "dis" } as const;

/** FR-DICEX-40: one row per `roll` entry, in `n` order. */
export function popupRows(entries: readonly GameLogEntryView[]): PopupRow[] {
  return entries
    .filter((e) => e.kind === "roll")
    .sort((a, b) => a.n - b.n)
    .map((e) => {
      const items: PopupItem[] = [];
      for (const raw of Array.isArray(e.payload) ? e.payload : []) {
        const r = Item.safeParse(raw);
        if (!r.success) continue;
        const i = r.data;
        const nat = e.category === "initiative" ? null : i.natural;
        const key = i.rollId ?? `${items.length}`;
        items.push({
          key,
          label: i.label ?? i.expression,
          total: i.total,
          mode: MODE[i.mode as keyof typeof MODE] ?? null,
          natural: nat === 20 ? "natural 20!" : nat === 1 ? "natural 1" : null,
          physical: i.manual,
          offered: (i.offered ?? []).map((o, n) => ({
            key: o.rollId ?? `${key}:${n}`,
            label: o.label ?? "DM",
            value: o.value,
          })),
        });
      }
      return { entryId: e.id, actor: e.actorName, hidden: !e.public, items };
    });
}

const intersect = (a: Rect, b: Rect): Rect | null => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
};

/** The largest part of `r` outside `cover` (one of its four side strips), or null. */
function outside(r: Rect, cover: Rect): Rect | null {
  if (!intersect(r, cover)) return r;
  const strips: Rect[] = [
    { x: r.x, y: r.y, w: cover.x - r.x, h: r.h },
    { x: cover.x + cover.w, y: r.y, w: r.x + r.w - (cover.x + cover.w), h: r.h },
    { x: r.x, y: r.y, w: r.w, h: cover.y - r.y },
    { x: r.x, y: cover.y + cover.h, w: r.w, h: r.y + r.h - (cover.y + cover.h) },
  ].filter((s) => s.w > 0 && s.h > 0);
  let best: Rect | null = null;
  for (const s of strips) if (!best || s.w * s.h > best.w * best.h) best = s;
  return best;
}

/**
 * FR-DICEX-41 (B26): the scissor of a PiP arena, read each frame: its rect inside every `bound`
 * (the popup card, the viewport), minus every `cover` (a modal dialog over the popup: no PiP
 * pixel under it). Null = nothing to draw.
 */
export function pipClip(
  arena: Rect,
  bounds: readonly Rect[],
  covers: readonly Rect[],
): Rect | null {
  let r: Rect | null = arena;
  for (const b of bounds) r = r && intersect(r, b);
  for (const c of covers) r = r && outside(r, c);
  return r;
}

/**
 * FR-DICEX-46: a die at full size spans its cell (the die size px of FR-DICEX-33: 44 px per
 * `DIE_WORLD`); the miniature's and the flown-in dice match.
 */
export const MINI_DIE_PX = CELL_PX;

/**
 * FR-DICEX-39 / FR-NOTE-32 rule for the DM's popup stack: centred at `top`; over a rect it keeps
 * clear of (Initiative; the open combat popup, FR-CBT-75, which may sit where its toast was; the
 * hard keep-outs, FR-DICEX-55: the map tool bar) → left of it with a 12 px gap; no room there
 * (a shift onto the tool bar at the rail) → below it. Returns the stack's left / top.
 */
export function dmStackAt(
  vp: { w: number },
  top: number,
  size: { w: number; h: number },
  clear: readonly Rect[],
): { left: number; top: number } {
  let at = { left: Math.round((vp.w - size.w) / 2), top };
  const over = (r: Rect) =>
    at.left < r.x + r.w + EDGE_GAP &&
    r.x - EDGE_GAP < at.left + size.w &&
    r.y < at.top + size.h + EDGE_GAP &&
    r.y + r.h + EDGE_GAP > at.top;
  // One move per rect at most: a move can land on another rect, never back on a cleared one.
  for (let pass = 0; pass < clear.length; pass++) {
    const r = clear.find(over);
    if (!r) break;
    const shifted = r.x - EDGE_GAP - size.w;
    at =
      shifted >= RAIL_CLEAR
        ? { left: Math.min(at.left, shifted), top: at.top }
        : { left: at.left, top: Math.round(r.y + r.h + EDGE_GAP) };
  }
  return at;
}

/**
 * FR-DICEX-55: what the DM popup stack keeps clear of, in `dmStackAt`'s order: Initiative, the open
 * non-modal dialogs, the hard keep-outs (the map tool bar), then every other reported shown stack
 * (FR-SHELL-59: the notification toasts; `own` = the popups' own report, skipped). The toast stack
 * keeps its spot; the popups stack in its band `STACK_GAP` (8 px) below it, or left of it, never on
 * it: a stack enters inset by `EDGE_GAP` − `STACK_GAP` per side, so `dmStackAt`'s 12-px clearance
 * leaves the stacks' own 8 px and a popup already 8 px under the toasts (the region's home) stays.
 */
export function dmPopupClear(
  initiative: Rect | null,
  dialogs: readonly Rect[],
  hard: readonly Rect[],
  shown: ReadonlyMap<string, Rect>,
  own: string,
): Rect[] {
  const d = EDGE_GAP - STACK_GAP;
  const others = [...shown]
    .filter(([id]) => id !== own)
    .map(([, r]) => ({ x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d }));
  return [...(initiative ? [initiative] : []), ...dialogs, ...hard, ...others];
}

/**
 * FR-SHELL-59 (OQ-MAP-57 D): what the DM popup stack reports as shown for the Fit: its rendered
 * rect while it draws something; null for players, an empty stack or a zero-size box.
 */
export function shownPopupStack(dm: boolean, rect: Rect | null): Rect | null {
  return dm && rect && rect.w > 0 && rect.h > 0 ? rect : null;
}

// The roll popup's content and geometry (FR-DICEX-38–41, -46, -47), pure, in the lazy popup
// chunk. One named row per entry (sim-7: no "· N rolls"), read from `payload` only (never
// `dmPayload`); the dice line's cells and the card's pixel budget (§6.1 tables A, B); how many
// popups fit the toast region; the miniature's clip to its popup's visible rect; the DM stack's
// keep-clear of Initiative and the open combat popup. T5 (DM #347): the whole card × 1.4
// (`POPUP_BIG`), today's 320 px card (`POPUP_BASE`) only where the viewport can't hold it.
import type { ThrowDie } from "@shared/dice-extras/throw";
import type { GameLogEntryView } from "@shared/dice-roll-log/schemas";
import { z } from "zod";
import type { Rect } from "../play-shell/geometry";
import { EDGE_GAP, TITLE_H, TOP_BAR_H } from "../play-shell/geometry";
import { RAIL_CLEAR } from "../play-shell/placement";
import type { ShellClient } from "../play-shell/registry";
import {
  DM_TOAST_TOP,
  NOTE_EDGE,
  PLAYER_TOAST_BOTTOM,
  ROLL_POPUP_W,
  STACK_GAP,
} from "../play-shell/toast-region";

// ---- the card's geometry (FR-DICEX-46, -47, §6.1 tables A, B; T5, DM #347) ----

export const CELLS_PER_LINE = 6;
/** ≤ 2 lines (OQ-DICEX-33): > 6 dice wrap; > 12 → 11 dice + a "+N" cell. */
export const CELL_LINES = 2;
/** Rows shown; more scroll inside. */
export const ROWS_SHOWN = 3;
/** DM #347: the popup about 40 % bigger on every client: box, dice, numbers, rows and total. */
export const POPUP_SCALE = 1.4;

/** Tables A and B at a scale `k`, whole px. */
export interface PopupGeom {
  k: number;
  /** One cell: a die at full size, never scaled by the count (OQ-DICEX-34). */
  cell: number;
  gap: number;
  /** The line's width: 6 cells and their gaps. */
  lineW: number;
  /** Padding top and bottom (border included). */
  pad: number;
  /** One entry row: actor, label, its total at the right (the first also holds ✕ and ⚙). */
  row: number;
  /** Gap rows → dice. */
  rowsGap: number;
  /** Cell tags overhang the last line by this. */
  tag: number;
  /** The card's width and its height with 3 rows and 2 lines. */
  w: number;
  maxH: number;
}

export function popupGeom(k: number): PopupGeom {
  const px = (v: number) => Math.round(v * k);
  const cell = px(44);
  const gap = px(4);
  const g = { k, cell, gap, pad: px(10), row: px(22), rowsGap: px(8), tag: px(4) };
  return {
    ...g,
    lineW: CELLS_PER_LINE * cell + (CELLS_PER_LINE - 1) * gap,
    w: px(ROLL_POPUP_W),
    maxH: 2 * g.pad + ROWS_SHOWN * g.row + g.rowsGap + CELL_LINES * cell + gap + g.tag,
  };
}

/** Sprint 5's card: 320 × ≤ 190, 44-px cells (284-px line), rows 22. */
export const POPUP_BASE = popupGeom(1);
/** T5: 448 × ≤ 268, 62-px cells (402-px line), rows 31. */
export const POPUP_BIG = popupGeom(POPUP_SCALE);

/**
 * T5 (FR-DICEX-47): the big card wherever the viewport holds one beside the region's insets (its
 * width + 16 px a side; its full height below the DM's top-centre start, or between the top bar
 * and the players' launcher clearance), else today's (a phone, a very short window).
 */
export function popupGeomAt(client: ShellClient, vp: { w: number; h: number }): PopupGeom {
  const inset =
    client === "dm" ? DM_TOAST_TOP + EDGE_GAP : PLAYER_TOAST_BOTTOM + TOP_BAR_H + EDGE_GAP;
  const fits = vp.w >= POPUP_BIG.w + 2 * NOTE_EDGE && vp.h >= POPUP_BIG.maxH + inset;
  return fits ? POPUP_BIG : POPUP_BASE;
}

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

const slotAt = (index: number, g: PopupGeom): CellSlot => ({
  index,
  line: Math.floor(index / CELLS_PER_LINE) + 1,
  x: (index % CELLS_PER_LINE) * (g.cell + g.gap),
  y: Math.floor(index / CELLS_PER_LINE) * (g.cell + g.gap),
});

/** Height of `lines` dice lines (px). */
export const linesH = (lines: number, g: PopupGeom = POPUP_BIG) =>
  lines > 0 ? lines * g.cell + (lines - 1) * g.gap : 0;

/**
 * FR-DICEX-46: the frame's dice (`throwDice` order) in cells; `more` = dice beyond the throw's 20
 * (FR-DICEX-14), counted in "+N" too.
 */
export function popupLine(
  dice: readonly ThrowDie[],
  more = 0,
  g: PopupGeom = POPUP_BIG,
): PopupLine {
  const cap = CELLS_PER_LINE * CELL_LINES;
  const all = dice.length + more;
  const shown = all > cap ? cap - 1 : dice.length;
  const cells = dice.slice(0, shown).map((die, i) => ({ ...slotAt(i, g), die }));
  const first = dice[shown];
  const plus =
    all > shown && first ? { ...slotAt(shown, g), n: all - shown, entryId: first.entryId } : null;
  const used = plus ? shown + 1 : shown;
  const lines = Math.ceil(used / CELLS_PER_LINE);
  return { cells, more: plus, lines, w: g.lineW, h: linesH(lines, g) };
}

/** A MOD / offered die's tag (cut to the cell with "…") and its full text (the die's Tooltip). */
export function cellTag(d: ThrowDie): { tag: string; full: string } | null {
  if (!d.label && !d.offered) return null;
  const tag = `${d.sign === -1 ? "−" : ""}${d.label ?? ""}`;
  return { tag, full: d.offered ? `${tag} on a hit` : tag };
}

// ---- the card's pixel budget (FR-DICEX-47, §6.1 table B) ----

/** FR-DICEX-47: a card's height with `rows` entry rows and `lines` dice lines (≤ `g.maxH`). */
export function popupHeight(rows: number, lines: number, g: PopupGeom = POPUP_BIG): number {
  const body = lines > 0 ? g.rowsGap + linesH(lines, g) + g.tag : 0;
  return 2 * g.pad + Math.min(Math.max(rows, 1), ROWS_SHOWN) * g.row + body;
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

/** FR-DICEX-40: an item's label as the row reads it: "Attack (adv)", else the label alone. */
export const popupItemLabel = (i: Pick<PopupItem, "label" | "mode">) =>
  i.mode ? `${i.label} (${i.mode})` : i.label;

/** FR-DICEX-13 / -63: an offered part after the total: "Sneak Attack 8 on a hit" (one space each). */
export const popupOfferText = (o: Pick<PopupItem["offered"][number], "label" | "value">) =>
  `${o.label} ${o.value} on a hit`;

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
 * BL-118 (X1 walkthrough 1, 4): the DM column's start row, as play-shell's `popupRegion` lays the
 * region row out below the toast stack: from the stack's resting height (its FR-SHELL-59 report,
 * `noteH`; 0 = none), not the row's drawn top, which follows the toast height late (the column
 * moved on its own rolling → rest re-render, 2.2 s after the card, or flipped left / right).
 */
export function dmColumnTop(noteH: number): number {
  return DM_TOAST_TOP + (noteH > 0 ? noteH + STACK_GAP : 0);
}

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

/** BL-132: a window's head kept clear: its title bar and at least 40 px of body. */
export const HEAD_MIN = TITLE_H + 40;
/** BL-132: at most this deep (a first record that is a whole panel isn't a head). */
export const HEAD_MAX = TITLE_H + 120;

/**
 * BL-132 (sim-16 g01: the DM's tray popup on Party Manager's tabs and pot for ~6 s): each window's
 * head as the DM popups keep clear of it: title bar, tab strip, search box and first record (the
 * frame's first-row report, FR-NOTE-44, matched by the window's top-left), `HEAD_MIN`..`HEAD_MAX`
 * deep. Pure.
 */
export function windowHeads(
  windows: readonly Rect[],
  rows: readonly { x: number; y: number; bottom: number }[],
): Rect[] {
  return windows.map((w) => {
    const row = rows.find((r) => Math.abs(r.x - w.x) <= 1 && Math.abs(r.y - w.y) <= 1);
    const deep = row ? row.bottom - w.y : HEAD_MIN;
    return { ...w, h: Math.min(w.h, Math.max(HEAD_MIN, Math.min(HEAD_MAX, deep))) };
  });
}

const overlaps = (a: Rect, b: Rect, gap: number) =>
  a.x < b.x + b.w + gap && b.x - gap < a.x + a.w && a.y < b.y + b.h + gap && b.y - gap < a.y + a.h;

/**
 * BL-132: the DM popup column's spot. `dmStackAt` over `clear` (Initiative, dialogs, tool bar,
 * the toast stack), first also over every other window (a spot on none), else over their heads
 * (`windowHeads`: off title bars, tab strips and first records); each only where that spot clears
 * every rect it was given and holds the column above the viewport's bottom. Neither → as before
 * (the column may cover windows; `popupRoom` then keeps it off the heads below it). Pure.
 */
export function dmPopupAt(
  vp: { w: number; h: number },
  top: number,
  size: { w: number; h: number },
  clear: readonly Rect[],
  windows: readonly Rect[],
  heads: readonly Rect[],
): { left: number; top: number } {
  for (const extra of [windows, heads]) {
    const rects = [...clear, ...extra];
    const at = dmStackAt(vp, top, size, rects);
    const box = { x: at.left, y: at.top, w: size.w, h: size.h };
    const fits = at.top + size.h <= vp.h - EDGE_GAP && at.left >= RAIL_CLEAR;
    if (fits && !rects.some((r) => overlaps(box, r, EDGE_GAP))) return at;
  }
  return dmStackAt(vp, top, size, clear);
}

/**
 * FR-DICEX-47 short screens + BL-132 (sim-16 d01: three quick player rolls stacked 448-wide
 * popups from 104, 354 over the Game log's title bar): the DM column's room below its top `at`,
 * px: to the viewport's bottom; a column moved off its `home` (shifted or dropped by what it keeps
 * clear of) also stops at the top of the first window head below it that its width crosses (it
 * may end on the head's edge, never over it; the oldest popups drop, the newest always shows). At
 * home #347's counts stand (the cards overhang the toast region's keep-out box, FR-DICEX-47). Pure.
 * A nudge that keeps over half the home lane (8 px clear of Initiative at 868, 1280 wide) is home.
 */
export function popupRoom(
  vpH: number,
  at: { left: number; top: number },
  w: number,
  heads: readonly Rect[],
  home: { left: number; top: number },
): number {
  let bottom = vpH - EDGE_GAP;
  const atHome = Math.abs(at.left - home.left) < w / 2 && Math.abs(at.top - home.top) <= 1;
  for (const h of atHome ? [] : heads) {
    if (h.y < at.top || h.x >= at.left + w || h.x + h.w <= at.left) continue;
    bottom = Math.min(bottom, h.y);
  }
  return bottom - at.top;
}

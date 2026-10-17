// The roll popup's content and geometry (FR-DICEX-38–41), pure, in the lazy popup chunk. One
// named row per entry (sim-7: no "· N rolls"), read from `payload` only (never `dmPayload`); the
// miniature's clip to its popup's visible rect; the DM stack's keep-clear of Initiative.
import type { GameLogEntryView } from "@shared/dice-roll-log/schemas";
import { z } from "zod";
import type { Rect } from "../play-shell/geometry";
import { EDGE_GAP } from "../play-shell/geometry";
import { RAIL_CLEAR } from "../play-shell/placement";

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

/** FR-DICEX-41: the miniature's die size, so `count` dice fit the PiP rect (px). */
export function pipDiePx(rect: { w: number; h: number }, count: number): number {
  const fit = Math.sqrt((rect.w * rect.h) / Math.max(1, count) / 3);
  return Math.round(Math.max(18, Math.min(40, rect.h * 0.42, fit)));
}

/**
 * FR-DICEX-39 / FR-NOTE-32 rule for the DM's popup stack: centred at `top`; over Initiative →
 * left of it with a 12 px gap; no room there → below it. Returns the stack's left / top.
 */
export function dmStackAt(
  vp: { w: number },
  top: number,
  size: { w: number; h: number },
  initiative: Rect | null,
): { left: number; top: number } {
  const left = Math.round((vp.w - size.w) / 2);
  if (!initiative) return { left, top };
  const overlapsX =
    left < initiative.x + initiative.w + EDGE_GAP && initiative.x - EDGE_GAP < left + size.w;
  const overlapsY =
    initiative.y < top + size.h + EDGE_GAP && initiative.y + initiative.h + EDGE_GAP > top;
  if (!overlapsX || !overlapsY) return { left, top };
  const shifted = initiative.x - EDGE_GAP - size.w;
  if (shifted >= RAIL_CLEAR) return { left: Math.min(left, shifted), top };
  return { left, top: Math.round(initiative.y + initiative.h + EDGE_GAP) };
}

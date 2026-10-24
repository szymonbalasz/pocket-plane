// The kill feed (FR-STATS-26–30, FR-NOTE-69), pure (clock injected): which lines of a live event
// frame toast, their words (`feedText`, FR-STATS-27, from the line's names only), and the batcher
// that makes one apply one toast. A multi-target apply reaches a client as one frame per target
// (one line each), so lines arriving within `FEED_BATCH_MS` of the first share a toast (≤ 3 lines,
// then "and N more"). Only lines the hub sent are read (FR-STATS-29): players never hold a hidden
// side's line, and no amount but the line's public damage.
import {
  AttackLogDmPayload,
  AttackLogPayload,
  HpLogDmPayload,
  HpLogPayload,
} from "@shared/combat-tracker/log-kinds";
import { LOG_KIND_ATTACK, LOG_KIND_HP } from "@shared/combat-tracker/schemas";
import type { GameLogEntryView } from "@shared/dice-roll-log/schemas";
import type { EventFrame } from "@shared/protocol/frames";
import { type FeedEvent, feedText } from "@shared/stats/feed";
import { logUpserts } from "./logic";
import type { Timers } from "./refresh";

/** FR-STATS-28: the feed toast's life. */
export const FEED_TOAST_MS = 4000;
/** FR-NOTE-50: one callout at a time; the feed's id (a newer toast replaces it). */
export const FEED_TOAST_ID = "stats-feed";
/**
 * Lines of one apply arrive as back-to-back frames: this long after the first, they share a toast.
 * 400 ms (sprint 10 T4, was 150): on a busy client the second target's frame landed later and
 * replaced the toast (1 line, not 2).
 */
export const FEED_BATCH_MS = 400;
/** FR-STATS-28: lines shown in one toast; the rest are "and N more". */
export const FEED_LINES_MAX = 3;

export interface FeedLine {
  /** The log entry's id (each line toasts once). */
  id: string;
  text: string;
}

/** The feed facts of one outcome line, or null (not a `fell` / callout line). */
function eventOf(e: GameLogEntryView, role: "dm" | "player"): FeedEvent | null {
  let ev: FeedEvent;
  let overkill: number | undefined;
  if (e.kind === LOG_KIND_ATTACK) {
    const p = AttackLogPayload.safeParse(e.payload);
    if (!p.success) return null;
    ev = { from: e.actorName, to: p.data.targetName, callout: p.data.callout === "overkill" };
    if (p.data.fell) ev.fell = p.data.fell;
    else ev.damage = p.data.damage;
    overkill = AttackLogDmPayload.safeParse(e.dmPayload).data?.overkill;
  } else if (e.kind === LOG_KIND_HP) {
    const p = HpLogPayload.safeParse(e.payload);
    if (!p.success || p.data.kind !== "damage") return null;
    // A DM's direct line has no source: "Goblin 1 falls" (FR-STATS-27).
    ev = {
      from: p.data.sourced ? e.actorName : null,
      to: p.data.targetName,
      callout: p.data.callout === "overkill",
    };
    if (p.data.fell) ev.fell = p.data.fell;
    else ev.damage = p.data.amount;
    overkill = HpLogDmPayload.safeParse(e.dmPayload).data?.overkill;
  } else {
    return null;
  }
  if (!ev.fell && !ev.callout) return null;
  // FR-STATS-27: the DM's adds the overkill amount and "(hidden)"; players' never (no `dmPayload`).
  if (role === "dm") {
    if (ev.callout && overkill !== undefined) ev.overkill = overkill;
    if (!e.public) ev.hidden = true;
  }
  return ev;
}

/**
 * FR-STATS-28, -29: the feed lines of a live frame: each outcome line upsert with `fell` or
 * `callout`, not undone and not superseded (an undo or supersede upsert never toasts). FR-STATS-68
 * (amends FR-STATS-28): a new line or an upsert of one already held both count, so a line toasts
 * the first time this page sees it carry `fell` / `callout`. The caller keeps to live frames
 * (never a snapshot or resync) and to lines it hasn't toasted (`createFeed`).
 */
export function feedLinesOf(
  frame: Pick<EventFrame, "cause" | "changes">,
  role: "dm" | "player",
): FeedLine[] {
  const out: FeedLine[] = [];
  for (const e of logUpserts(frame)) {
    if (e.undone || e.supersededBy !== null) continue;
    const ev = eventOf(e, role);
    if (ev) out.push({ id: e.id, text: feedText(ev) });
  }
  return out;
}

/** FR-STATS-28: what one toast shows: ≤ 3 lines, then "and N more". */
export function feedToastText(lines: readonly FeedLine[]): { lines: string[]; more: number } {
  return {
    lines: lines.slice(0, FEED_LINES_MAX).map((l) => l.text),
    more: Math.max(0, lines.length - FEED_LINES_MAX),
  };
}

/** Lines kept as toasted (a later upsert of the same line, e.g. an edit, never toasts again). */
const TOASTED_MAX = 200;

/**
 * One feed per page (BL-71: one listener per client): `push` a frame's lines; the first starts a
 * `FEED_BATCH_MS` wait, lines meanwhile join it, then `show` gets them all once. A line id already
 * toasted on this page is dropped.
 */
export function createFeed(opts: { show(lines: FeedLine[]): void; timers?: Timers; ms?: number }) {
  const timers: Timers = opts.timers ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as number),
  };
  const toasted = new Set<string>();
  let batch: FeedLine[] = [];
  let timer: unknown = null;
  const flush = () => {
    timer = null;
    const lines = batch;
    batch = [];
    if (lines.length > 0) opts.show(lines);
  };
  return {
    push(lines: readonly FeedLine[]) {
      for (const l of lines) {
        if (toasted.has(l.id)) continue;
        toasted.add(l.id);
        if (toasted.size > TOASTED_MAX) {
          const [oldest] = toasted;
          if (oldest) toasted.delete(oldest);
        }
        batch.push(l);
      }
      if (batch.length > 0 && timer === null)
        timer = timers.setTimeout(flush, opts.ms ?? FEED_BATCH_MS);
    },
    dispose() {
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      batch = [];
    },
  };
}

export type Feed = ReturnType<typeof createFeed>;

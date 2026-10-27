// The Game log's 40-px row (kit-parity §6.4, FR-KIT-42, -44): what a row shows, derived from the
// entry the client already holds (0 B). `rowAction` = the "Name · action" text, `rowResults` =
// the boxed totals and their outcome. The full line stays `formatEntry`'s: the row's Tooltip,
// its copy (FR-KIT-46) and screen readers read it.
import type { RollCategory } from "@shared/events/dice-roll-log";
import type { LineSegment } from "./kind-types";
import { type EntryLike, formatEntry } from "./line";
import { itemRuns, ROLL_KIND, runName } from "./roll-kind";
import { RollEntryPayload, type RollPayloadItem } from "./schemas";

/** A Result box's outcome (FR-KIT-05); the kit part's `ResultOutcome`. */
export type RollOutcome = "plain" | "crit" | "fumble" | "damage" | "heal";

export interface RowAction {
  /** The line's actor name; null = the line names none (a player's side change, FR-CBT-99). */
  actor: string | null;
  /** One line, no actor, no badges ("physical", "undone": chips after the boxes). */
  text: string;
}

/** A separator the actor leaves at the start of its line's rest (" — ", ": "). */
const LEAD = /^\s*(?:[—:]\s*)?/;

const words = (segments: readonly LineSegment[]) =>
  segments
    .filter((s) => s.style !== "badge")
    .map((s) => s.text)
    .join("");

/**
 * FR-KIT-42: `roll` → its runs' names joined with " + " (a label, else the expression; a weapon's
 * part run by its name); other kinds → their line text without the actor ("attacks Goblin: …").
 * A line whose actor isn't first ("DM awards Mira …") keeps its whole text.
 */
export function rowAction(entry: EntryLike): RowAction {
  if (entry.kind === ROLL_KIND) {
    const p = RollEntryPayload.safeParse(entry.payload);
    if (p.success) {
      const items = p.data;
      const names = itemRuns(items).map((run) =>
        runName(run.map((i) => items[i] as RollPayloadItem)),
      );
      return { actor: entry.actorName, text: names.join(" + ") };
    }
  }
  const { segments } = formatEntry(entry);
  const at = segments.findIndex((s) => s.style === "actor");
  if (at < 0) return { actor: null, text: words(segments).trim() };
  const actor = (segments[at] as LineSegment).text;
  if (at > 0) return { actor, text: words(segments).trim() };
  return { actor, text: words(segments.slice(1)).replace(LEAD, "").trimEnd() };
}

/**
 * FR-KIT-44: a d20's natural 20 → `crit`, natural 1 → `fumble` (not on initiative, as the line's
 * marker, FR-DICE-29); a damage part or category Damage → `damage`; Healing → `heal`; else `plain`.
 */
export function resultOutcome(
  item: Pick<RollPayloadItem, "natural" | "part">,
  category?: RollCategory,
): RollOutcome {
  if (category !== "initiative") {
    if (item.natural === 20) return "crit";
    if (item.natural === 1) return "fumble";
  }
  if (item.part || category === "damage") return "damage";
  if (category === "healing") return "heal";
  return "plain";
}

export interface RowResult {
  /** The run's first roll id (`data-record-id`). */
  rollId: string;
  /** The run's name ("Perception"), for the "+N" Tooltip. */
  label: string;
  total: number;
  outcome: RollOutcome;
}

/**
 * FR-KIT-44: one total per run of a `roll` entry, as its line shows them (a weapon's base part
 * and its extra parts sum to one, FR-CHARX-55); [] for other kinds.
 */
export function rowResults(entry: EntryLike): RowResult[] {
  if (entry.kind !== ROLL_KIND) return [];
  const p = RollEntryPayload.safeParse(entry.payload);
  if (!p.success) return [];
  const items = p.data;
  return itemRuns(items).map((run) => {
    const parts = run.map((i) => items[i] as RollPayloadItem);
    const base = parts[0] as RollPayloadItem;
    return {
      rollId: base.rollId,
      label: runName(parts),
      total: parts.reduce((n, x) => n + x.total, 0),
      outcome: resultOutcome(base, entry.category),
    };
  });
}

/** FR-KIT-44: at most this many boxes, then "+N". */
export const ROW_RESULTS_MAX = 2;

/** The line's badges once each ("physical", "undone"): the chips after the boxes. */
export function rowBadges(segments: readonly LineSegment[]): string[] {
  return [...new Set(segments.filter((s) => s.style === "badge").map((s) => s.text))];
}

/** FR-KIT-46: a line's copied text, as the line read before the row layout (FR-DICE-93). */
export const copyText = (segments: readonly { text: string }[]): string =>
  segments.map((s) => s.text).join("");

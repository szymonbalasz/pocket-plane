// The Game log's 40-px row (kit-parity §6.4, FR-KIT-42, -44): what a row shows, derived from the
// entry the client already holds (0 B). `rowAction` = the "Name · action" text, `rowResults` =
// the boxed totals and their outcome. The full line stays `formatEntry`'s: the row's Tooltip,
// its copy (FR-KIT-46) and screen readers read it. K8 (K6 gaps 1, 2): `cbt.attack` / `cbt.hp`
// rows are short kit rows too ("Longbow attack vs Goblin" [21] [8]); their maths is the Tooltip's.
import {
  AttackLogDmPayload,
  AttackLogPayload,
  HpLogPayload,
} from "@shared/combat-tracker/log-kinds";
import { LOG_KIND_ATTACK, LOG_KIND_HP } from "@shared/combat-tracker/schemas";
import type { RollCategory } from "@shared/events/dice-roll-log";
import type { LineSegment } from "./kind-types";
import { type EntryLike, formatEntry } from "./line";
import { itemRuns, itemsAfterActor, ROLL_KIND, runName } from "./roll-kind";
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

/** FR-CBT-137: the public overkill callout stays in the short text (a moment, not maths). */
const calloutText = (callout: "overkill" | undefined) => (callout ? " — Overkill!" : "");

/** The attack's name: the payload's, else the DM's (a companion attacker, FR-CBT-114). */
function attackName(entry: EntryLike, p: AttackLogPayload): string | null {
  if (p.attackName) return p.attackName;
  const dm = AttackLogDmPayload.safeParse(entry.dmPayload);
  return dm.success ? (dm.data.attackName ?? null) : null;
}

/**
 * K8 (K6 gap 1): a `cbt.attack` line as the kit's row: "Longbow attack vs Goblin", else (no
 * attack name: a companion's line for players) "attacks Goblin". A damage-only miss has no box,
 * so its text says "— miss". `cbt.hp`: "Goblin takes damage" / "Goblin heals", a sourced line
 * "damages Mira" / "heals Mira" (FR-CBT-136). Null = neither kind, or unreadable.
 */
function combatAction(entry: EntryLike): string | null {
  if (entry.kind === LOG_KIND_ATTACK) {
    const a = AttackLogPayload.safeParse(entry.payload);
    if (!a.success) return null;
    const p = a.data;
    const name = attackName(entry, p);
    const text = name ? `${name} attack vs ${p.targetName}` : `attacks ${p.targetName}`;
    const miss = p.toHit === null && !p.hit ? " — miss" : "";
    return `${text}${miss}${calloutText(p.callout)}`;
  }
  if (entry.kind === LOG_KIND_HP) {
    const h = HpLogPayload.safeParse(entry.payload);
    if (!h.success) return null;
    const p = h.data;
    const verb = p.kind === "damage" ? "damages" : "heals";
    const text = p.sourced
      ? `${verb} ${p.targetName}`
      : `${p.targetName} ${p.kind === "damage" ? "takes damage" : "heals"}`;
    return `${text}${calloutText(p.callout)}`;
  }
  return null;
}

/**
 * FR-KIT-42: `roll` → its runs' names joined with " + " (a label, else the expression; a weapon's
 * part run by its name); `cbt.attack` / `cbt.hp` → a short action whose numbers are boxes (K8);
 * other kinds → their line text without the actor. A line whose actor isn't first ("DM awards
 * Mira …") keeps its whole text.
 */
export function rowAction(entry: EntryLike): RowAction {
  const combat = combatAction(entry);
  if (combat !== null) return { actor: entry.actorName, text: combat };
  if (entry.kind === ROLL_KIND) {
    const p = RollEntryPayload.safeParse(entry.payload);
    if (p.success) {
      const items = itemsAfterActor(p.data, entry.actorName);
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
 * K8 (K6 gap 2): `damagePart` = a roll after the to-hit of an attack entry ("Longbow attack +
 * Longbow damage": the entry's category is `attack`, its damage roll has none of its own), so it
 * is `damage` whatever its dice show.
 */
export function resultOutcome(
  item: Pick<RollPayloadItem, "natural" | "part">,
  category?: RollCategory,
  damagePart = false,
): RollOutcome {
  if (damagePart) return "damage";
  if (category !== "initiative") {
    if (item.natural === 20) return "crit";
    if (item.natural === 1) return "fumble";
  }
  if (item.part || category === "damage") return "damage";
  if (category === "healing") return "heal";
  return "plain";
}

export interface RowResult {
  /** Unique in the row: the roll id, or a combat line's number (`hit`, `damage`, `amount`). */
  key: string;
  /** The run's first roll id (`data-record-id`); null = a combat line's number (no roll record). */
  rollId: string | null;
  /** The run's name ("Perception"), for the "+N" Tooltip. */
  label: string;
  total: number;
  outcome: RollOutcome;
  /**
   * BL-141 (K6c gap 3): a `cbt.attack` to-hit that hit (not a crit): the kit's green box, as the
   * damage card's `hit` (K12). Absent otherwise.
   */
  hit?: true;
}

/**
 * K8 (K6 gap 1): a `cbt.attack` line's to-hit box (`crit` on a critical hit, `fumble` = dim on a
 * miss, else plain; BL-141: `hit` marks a plain one that hit) and, once damage landed on a hit, its damage box; a `cbt.hp` line's amount
 * (damage / heal). The words ("hit!", "DM ruled miss", the AC) stay in the Tooltip's line. Null =
 * neither kind.
 */
function combatResults(entry: EntryLike): RowResult[] | null {
  if (entry.kind === LOG_KIND_ATTACK) {
    const a = AttackLogPayload.safeParse(entry.payload);
    if (!a.success) return [];
    const p = a.data;
    const out: RowResult[] = [];
    if (p.toHit) {
      const outcome = !p.hit ? "fumble" : p.crit ? "crit" : "plain";
      const box: RowResult = {
        key: "hit",
        rollId: null,
        label: "To hit",
        total: p.toHit.total,
        outcome,
      };
      out.push(p.hit && !p.crit ? { ...box, hit: true } : box);
    }
    // FR-CBT-88: an Apply hit line has no damage yet.
    if (p.hit && !p.awaitingDamage) {
      out.push({
        key: "damage",
        rollId: null,
        label: "Damage",
        total: p.damage,
        outcome: "damage",
      });
    }
    return out;
  }
  if (entry.kind === LOG_KIND_HP) {
    const h = HpLogPayload.safeParse(entry.payload);
    if (!h.success) return [];
    const damage = h.data.kind === "damage";
    const label = damage ? "Damage" : "Healing";
    const outcome = damage ? "damage" : "heal";
    return [{ key: "amount", rollId: null, label, total: h.data.amount, outcome }];
  }
  return null;
}

/**
 * FR-KIT-44: one total per run of a `roll` entry, as its line shows them (a weapon's base part
 * and its extra parts sum to one, FR-CHARX-55); a combat line's numbers (K8); [] for other kinds.
 */
export function rowResults(entry: EntryLike): RowResult[] {
  const combat = combatResults(entry);
  if (combat !== null) return combat;
  if (entry.kind !== ROLL_KIND) return [];
  const p = RollEntryPayload.safeParse(entry.payload);
  if (!p.success) return [];
  const items = itemsAfterActor(p.data, entry.actorName);
  return itemRuns(items).map((run, k) => {
    const parts = run.map((i) => items[i] as RollPayloadItem);
    const base = parts[0] as RollPayloadItem;
    return {
      key: base.rollId,
      rollId: base.rollId,
      label: runName(parts),
      total: parts.reduce((n, x) => n + x.total, 0),
      // K8: the runs after an attack entry's to-hit are its damage.
      outcome: resultOutcome(base, entry.category, entry.category === "attack" && k > 0),
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

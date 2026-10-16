// Rule-trigger firing rules (FR-MOD-35–37, -42, -43; MOD §8.4), pure: the owner's formula
// values, hard owner-side filters, the popup's settle facts frozen at the roll, window keys and
// the `requires` origin match. The server's roll hook, apply hook and reminders read these.
import {
  ABILITIES,
  abilityMod,
  type ClassRow,
  proficiencyBonus,
  type StatBlock,
} from "@shared/entities/schemas";
import type { FormulaOwner } from "./formula";
import { matches } from "./rules";
import type { RollSubject } from "./schemas";
import { rowMatches, type TriggerEvery, type TriggerFilter, type TriggerRule } from "./triggers";

/** FR-MOD-35: a character's or a monster definition's formula values. */
export function formulaOwnerOf(stats: StatBlock): FormulaOwner {
  const abilities = stats.abilities
    ? Object.fromEntries(ABILITIES.map((a) => [a, abilityMod(stats.abilities?.[a] ?? 10)]))
    : undefined;
  if ("cr" in stats) {
    const [n, d] = stats.cr.split("/").map(Number);
    return {
      level: 0,
      cr: Math.floor((n ?? 0) / (d ?? 1)),
      prof: proficiencyBonus(stats),
      ...(abilities ? { abilities } : {}),
    };
  }
  // `level(<class>)`: the class rows, else the legacy `className` at the total level.
  const classes: readonly Pick<ClassRow, "name" | "level">[] =
    stats.classes ??
    (stats.className.trim() ? [{ name: stats.className, level: stats.level }] : []);
  return {
    level: stats.level,
    classes: classes.map((c) => ({ name: c.name, level: c.level })),
    prof: proficiencyBonus(stats),
    ...(abilities ? { abilities } : {}),
  };
}

// ---------- windows (FR-MOD-42) ----------

/** The window key of a feature-frequency use (its charge is a CHARX use, not a key). */
export const FEATURE_WINDOW = "f";

/** A turn-ref of the started encounter. */
export interface TurnNow {
  round: number;
  turnCombatantId: string | null;
}

/**
 * FR-MOD-42: the window key of a use now. `each` has no charge; its rows carry the turn key
 * (informational, never checked).
 */
export function windowKey(every: TriggerEvery, now: TurnNow): string {
  if (typeof every === "object") return FEATURE_WINDOW;
  if (every === "round") return `r:${now.round}`;
  if (every === "encounter") return "e";
  return `t:${now.round}:${now.turnCombatantId ?? "-"}`;
}

/** The charge is per window (turn / round / encounter); `each` and `feature` are not. */
export const windowed = (every: TriggerEvery): every is "turn" | "round" | "encounter" =>
  every === "turn" || every === "round" || every === "encounter";

/** "this turn" / "this round" / "this encounter" for a `conflict` (FR-MOD-38). */
export function windowWords(every: TriggerEvery): string {
  return every === "round" ? "this round" : every === "encounter" ? "this encounter" : "this turn";
}

// ---------- requires (FR-MOD-36) ----------

/**
 * FR-MOD-36 origin match: keys match if equal, or one is a preset whose `originKey` is the
 * other. `originOf(key)` = that preset's `originKey` (null for a built-in key or no preset).
 */
export function presetKeysMatch(
  a: string,
  b: string,
  originOf: (key: string) => string | null,
): boolean {
  return a === b || originOf(a) === b || originOf(b) === a;
}

/** `requires` holds iff an active effect's `presetKey` matches (no `requires` → holds). */
export function requiresMet(
  rule: Pick<TriggerRule, "requires">,
  activeKeys: readonly (string | null)[],
  originOf: (key: string) => string | null,
): boolean {
  const want = rule.requires?.preset;
  if (want === undefined) return true;
  return activeKeys.some((k) => k !== null && presetKeysMatch(k, want, originOf));
}

// ---------- filters (FR-MOD-37, -43; §8.4) ----------

export type ToHitMode = "normal" | "advantage" | "disadvantage";

/** What the owner-side filters read at a roll. */
export interface FireFacts {
  subject: RollSubject;
  /** The owner's combatant has the turn (out of combat: false). */
  ownTurn: boolean;
  /** `hit`: the card's to-hit mode (damage-only card: normal); `roll`: the subject's. */
  mode: ToHitMode;
}

const isSoft = (f: TriggerFilter): boolean => f.if === "ask" || (f.if === "mode" && !!f.soft);

/** One owner-side filter; target-side and soft ones hold here (they never gate the fire). */
function holds(f: TriggerFilter, x: FireFacts): boolean {
  switch (f.if) {
    case "via":
      return x.subject.via === f.via;
    case "row":
      return rowMatches(f.names, x.subject.row);
    case "roll":
      return matches(f.on, x.subject);
    case "ownTurn":
      return x.ownTurn;
    case "crit":
      return !!x.subject.crit;
    case "mode":
      return f.modes.includes(x.mode);
    default:
      return true;
  }
}

/** FR-MOD-37, -43: every hard owner-side filter holds (soft and target-side filters don't gate). */
export const ownerFiltersPass = (rule: Pick<TriggerRule, "when">, x: FireFacts): boolean =>
  rule.when.every((f) => isSoft(f) || holds(f, x));

/** FR-MOD-37 / -39: the popup's facts for an offered part, frozen at the roll. */
export interface SettleFacts {
  ask?: string;
  marked?: string;
  hurt?: true;
  untick?: true;
}

/**
 * FR-MOD-37: `marked` = the `targetMarked` preset, `hurt` = a `targetHurt` filter, `ask` = the
 * first `ask` note, `untick` = the rule has soft filters and none of the non-`ask` ones holds.
 */
export function settleFacts(rule: Pick<TriggerRule, "when">, x: FireFacts): SettleFacts {
  const out: SettleFacts = {};
  for (const f of rule.when) {
    if (f.if === "ask" && out.ask === undefined) out.ask = f.note;
    if (f.if === "targetMarked" && out.marked === undefined) out.marked = f.preset;
    if (f.if === "targetHurt") out.hurt = true;
  }
  const soft = rule.when.filter(isSoft);
  if (soft.length > 0 && !soft.some((f) => f.if !== "ask" && holds(f, x))) out.untick = true;
  return out;
}

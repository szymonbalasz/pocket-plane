// FR-DICE-107: what the details window shows per roll, pure, from the entry this client holds: a
// `roll` line's items, a `cbt.attack` line's to-hit and damage. A player's entry has no `dmPayload`,
// so the DM's names and dice simply aren't there (FR-DICE-15, -28).
import { AttackLogDmPayload, AttackLogPayload } from "@shared/combat-tracker/log-kinds";
import { LOG_KIND_ATTACK } from "@shared/combat-tracker/schemas";
import type { LineSegment } from "@shared/dice-roll-log/kind-types";
import {
  diceSegments,
  itemsAfterActor,
  ROLL_KIND,
  type RollBreakdown,
  rollBreakdownSegments,
} from "@shared/dice-roll-log/roll-kind";
import { type RollOutcome, resultOutcome } from "@shared/dice-roll-log/row";
import {
  type GameLogEntryView,
  RollEntryDmPayload,
  RollEntryPayload,
  type RollModPart,
} from "@shared/dice-roll-log/schemas";
import { modeLabels } from "@shared/effect-modifiers/line";

export interface DetailLine {
  key: string;
  label: string;
  value: string;
  /** A rolled number: "…" until the landing (FR-DICE-40). */
  rolled: boolean;
}

export interface DetailSection {
  key: string;
  /** The roll record, for `data-record-id`; a combat line's section has none. */
  rollId: string | null;
  title: string;
  /** The roll's expression, or null (a player's view of a combat line). */
  expression: string | null;
  /** "advantage: Bless"; null = normal. Withheld until the landing, as the line's "(adv)". */
  mode: string | null;
  /** Purpose, damage type, "edited", "critical": facts the roll doesn't wait for. */
  tags: string[];
  /** The dice and their joiners, in the line's order (FR-DICE-35). */
  chips: LineSegment[];
  /** Constant and modifiers, one per line. */
  lines: DetailLine[];
  /** Offered trigger parts, not in the total (FR-MOD-19). */
  offered: DetailLine[];
  total: number;
  outcome: RollOutcome;
  /** "natural 20!", "hit", "miss"; null = none. */
  outcomeText: string | null;
  note: string | null;
}

const signed = (n: number) => (n < 0 ? `- ${Math.abs(n)}` : `+ ${n}`);

const constantLine = (constant: number): DetailLine[] =>
  constant === 0
    ? []
    : [{ key: "constant", label: "Constant", value: signed(constant), rolled: false }];

/** A roll-hook part: the DM's name, else the player-safe label, else "(DM)" (FR-MOD-20). */
function modLines(
  mods: readonly RollModPart[] | undefined,
  names: readonly { label: string }[] | undefined,
): DetailLine[] {
  return (mods ?? []).map((p, i) => {
    const name = names?.[i]?.label ?? p.label ?? "(DM)";
    return {
      key: `mod-${i}`,
      label: p.expression ? `${name} (${p.expression})` : name,
      value: `${signed(p.value)}${p.type ? ` ${p.type}` : ""}`,
      rolled: true,
    };
  });
}

function rollSections(e: GameLogEntryView): DetailSection[] {
  const parsed = RollEntryPayload.safeParse(e.payload);
  if (!parsed.success) return [];
  const dm = RollEntryDmPayload.safeParse(e.dmPayload ?? null).data;
  return itemsAfterActor(parsed.data, e.actorName).map((item, i) => {
    const names = dm?.items[i];
    const natural = e.category === "initiative" ? null : item.natural;
    const tags = [
      ...(item.purpose ? [item.purpose] : []),
      ...(item.part?.type ? [item.part.type] : []),
      ...(item.edited ? ["edited"] : []),
    ];
    const lines = [...constantLine(item.constant), ...modLines(item.mods, names?.mods)];
    if (item.replaces) {
      const value = String(item.replaces.total);
      lines.push({ key: "replaces", label: "Rerolled, was", value, rolled: false });
    }
    const why = item.modes ? `: ${modeLabels(item.modes, names?.modes)}` : "";
    return {
      key: item.rollId,
      rollId: item.rollId,
      title: item.label ?? item.purpose ?? item.expression,
      expression: item.expression,
      mode: item.mode === "normal" ? null : `${item.mode}${why}`,
      tags,
      chips: diceSegments(item),
      lines,
      offered: (item.offered ?? []).map((o, j) => ({
        key: `offered-${j}`,
        label: names?.offered?.[j]?.label ?? o.label ?? "(DM)",
        value: `${o.expression}: ${o.value}${o.type ? ` ${o.type}` : ""}`,
        rolled: true,
      })),
      total: item.total,
      outcome: resultOutcome(item, e.category, e.category === "attack" && i > 0),
      outcomeText: natural === 20 ? "natural 20!" : natural === 1 ? "natural 1" : null,
      note: item.note ?? null,
    };
  });
}

/** The DM's stored dice of a combat roll, chips only (its text is the line's). */
const breakdownChips = (r: RollBreakdown) => rollBreakdownSegments(r).filter((s) => s.die);

function attackSections(e: GameLogEntryView): DetailSection[] {
  const parsed = AttackLogPayload.safeParse(e.payload);
  if (!parsed.success) return [];
  const p = parsed.data;
  const dm = AttackLogDmPayload.safeParse(e.dmPayload ?? null).data;
  const out: DetailSection[] = [];
  if (p.toHit) {
    const stored = dm?.rolls?.toHit;
    const natural = dm?.toHitNatural ?? p.toHit.natural;
    const sum = p.toHit.dice;
    // Players: the to-hit's dice are a sum (FR-CBT-24), one chip, a d20 only when its face is known.
    const chips: LineSegment[] = stored
      ? breakdownChips(stored)
      : sum === null
        ? []
        : [
            {
              text: String(sum),
              die: { faces: natural === null ? null : 20, value: sum, kept: true },
            },
          ];
    out.push({
      key: "hit",
      rollId: null,
      title: `${p.attackName ?? dm?.attackName ?? "Attack"} vs ${p.targetName}`,
      expression: stored?.expression ?? null,
      mode: stored && stored.mode !== "normal" ? stored.mode : null,
      tags: [],
      chips,
      lines: [...constantLine(p.toHit.constant), ...modLines(p.toHit.mods, dm?.mods?.toHit)],
      offered: [],
      total: p.toHit.total,
      outcome: !p.hit ? "fumble" : p.crit ? "crit" : "plain",
      outcomeText: !p.hit ? "miss" : p.crit ? "critical hit!" : "hit",
      note: null,
    });
  }
  if (p.hit && !p.awaitingDamage) {
    const stored = dm?.rolls?.damage;
    const extra = dm?.rolls?.extra ?? [];
    const lines: DetailLine[] = [
      ...constantLine(stored?.constant ?? 0),
      ...(dm?.mods?.damage ? modLines(dm.mods.damage, undefined) : []),
      ...(p.damageParts ?? []).map((x, i) => ({
        key: `part-${i}`,
        label: x.multiplier ? `${x.type} (${x.multiplier})` : x.type,
        value: signed(x.value),
        rolled: true,
      })),
      ...(p.parts ?? []).map((x, i) => {
        const type = x.type ? ` ${x.type}` : "";
        return {
          key: `trigger-${i}`,
          label: dm?.parts?.[i]?.label ?? x.label ?? "(DM)",
          value: `${signed(x.value)}${type}`,
          rolled: true,
        };
      }),
    ];
    out.push({
      key: "damage",
      rollId: null,
      title: p.damageType ? `Damage (${p.damageType})` : "Damage",
      expression: stored?.expression ?? null,
      mode: null,
      tags: [...(p.crit ? ["critical"] : []), ...(p.multiplier !== "normal" ? [p.multiplier] : [])],
      chips: [...(stored ? breakdownChips(stored) : []), ...extra.flatMap(breakdownChips)],
      lines,
      offered: [],
      total: p.damage,
      outcome: "damage",
      outcomeText: null,
      note: null,
    });
  }
  return out;
}

/** FR-DICE-107: the sections of a `roll` or `cbt.attack` line; [] = show its full line instead. */
export function detailSections(e: GameLogEntryView): DetailSection[] {
  if (e.kind === ROLL_KIND) return rollSections(e);
  if (e.kind === LOG_KIND_ATTACK) return attackSections(e);
  return [];
}

/** FR-DICE-107: the "physical" tag under the sections (a manual roll, either kind). */
export function entryPhysical(e: GameLogEntryView): boolean {
  if (e.kind === ROLL_KIND) {
    const items = RollEntryPayload.safeParse(e.payload);
    return items.success && items.data.some((i) => i.manual);
  }
  if (e.kind === LOG_KIND_ATTACK) {
    const m = AttackLogPayload.safeParse(e.payload).data?.manual;
    return m ? m.toHit || m.damage : false;
  }
  return false;
}

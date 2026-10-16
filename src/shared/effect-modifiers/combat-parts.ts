// Rule-trigger parts in combat's text (FR-MOD-40, -47, -48; MOD §7 "Card and toast", "Roll
// lines"). Card: offered parts after the damage, named (the card's audience is the owner or the
// DM): "Brakka: 17 to hit, 12 slashing (+ 6 radiant Divine Fury on a hit)". Outcome line: each
// landed part after the weapon damage, typed when its type differs: "+ 6 radiant (Divine Fury)",
// an untyped one like a roll part "+ 9 Martial Advantage"; a non-public trigger's label reads
// "(DM)" for players, the DM's line names it, with "(DM set; rolled 7)" / "(DM ruled)". Pure.
import type { LineSegment } from "@shared/dice-roll-log/kind-types";
import { DM_PART_LABEL } from "./line";

/** What the card text reads of an offered part (`CardTriggerPart`). */
export interface OfferTextPart {
  label: string;
  value: number;
  /** null = the attack's type. */
  type: string | null;
}

/** "+ 6 radiant Divine Fury" (type: the part's, else the attack's). */
export function offerText(o: OfferTextPart, damageType: string | null): string {
  const type = o.type ?? damageType;
  return `+ ${o.value}${type ? ` ${type}` : ""} ${o.label}`;
}

/** " (+ 6 radiant Divine Fury, + 9 piercing Sneak Attack on a hit)"; "" without offers. */
export function offersSuffix(
  offers: readonly OfferTextPart[] | undefined,
  damageType: string | null,
): string {
  if (!offers?.length) return "";
  return ` (${offers.map((o) => offerText(o, damageType)).join(", ")} on a hit)`;
}

/**
 * The card text with its offers (FR-MOD-48), within `max` chars (notification text, FR-NOTE-21):
 * too long → " (+ 2 trigger parts on a hit)" (the card itself keeps every part).
 */
export function withOffersText(
  base: string,
  offers: readonly OfferTextPart[] | undefined,
  damageType: string | null,
  max: number,
): string {
  const full = `${base}${offersSuffix(offers, damageType)}`;
  if (full.length <= max || !offers?.length) return full;
  const n = offers.length;
  return `${base} (+ ${n} trigger part${n === 1 ? "" : "s"} on a hit)`;
}

const MULT_TEXT = { normal: "", half: " (half)", none: " (none)", double: " (double)" } as const;

/** A landed part as the public line carries it (`AttackLinePart`). */
export interface LinePartView {
  label: string | null;
  value: number;
  type: string | null;
  multiplier?: keyof typeof MULT_TEXT;
}

/** The DM's facts of a line part (`AttackLineDmPart`, same index). */
export interface LineDmPartView {
  label: string;
  rolled: number;
  set?: true;
  forced?: true;
}

/**
 * Segments of the parts after the weapon damage: " + 6 radiant (Divine Fury)" (typed: its type
 * differs from the attack's), " + 9 Martial Advantage" (untyped), " + 9 (DM)" (non-public, for
 * players); then the part's own multiplier; the DM's line names every part and adds " (DM set;
 * rolled 7)" after an edited value and " (DM ruled)" after a forced charge.
 */
export function linePartSegments(
  parts: readonly LinePartView[] | undefined,
  dm: readonly LineDmPartView[] | null | undefined,
  damageType: string | null,
): LineSegment[] {
  return (parts ?? []).flatMap((p, i) => {
    const d = dm?.[i];
    const label = d?.label ?? p.label;
    const typed = p.type !== null && p.type !== damageType;
    const out: LineSegment[] = [{ text: ` + ${p.value}${typed ? ` ${p.type}` : ""}` }];
    if (label === null) out.push({ text: ` ${DM_PART_LABEL}`, style: "muted" });
    else out.push({ text: typed ? ` (${label})` : ` ${label}`, style: "muted" });
    if (p.multiplier) out.push({ text: MULT_TEXT[p.multiplier] });
    if (d?.set) out.push({ text: ` (DM set; rolled ${d.rolled})`, style: "muted" });
    if (d?.forced) out.push({ text: " (DM ruled)", style: "muted" });
    return out;
  });
}

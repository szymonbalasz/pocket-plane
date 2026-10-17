// Rule-trigger parts in combat's text (FR-MOD-40, -47, -48; MOD §7 "Card and toast", "Roll
// lines"). Card: offered parts after the damage, named (the card's audience is the owner or the
// DM): "Brakka: 17 to hit, 12 slashing (+ 6 radiant Divine Fury on a hit)". Outcome line: each
// landed part after the weapon damage, typed when its type differs: "+ 6 radiant (Divine Fury)",
// an untyped one like a roll part "+ 9 Martial Advantage"; a non-public trigger's label reads
// "(DM)" for players, the DM's line names it, with "(DM set; rolled 7)" / "(DM ruled)". Pure.
// FR-MOD-57 (sprint 4): a part's dice follow it as die segments (seams S8 / rulings B5, B9).
import type { LineSegment } from "@shared/dice-roll-log/kind-types";
import { AUTO_PART_TEXT, DM_PART_LABEL, partDiceView } from "./line";

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

/** An offered part on a damage `roll` item (`RollOfferedPart`): label null = not public. */
export interface RollOfferView {
  label: string | null;
  value: number;
  type: string | null;
  auto?: true;
  expression?: string;
  dice?: readonly number[];
}

/** FR-MOD-57: the `label` of an offered part's dice ("Divine Fury (on a hit)"). */
export const offeredDieLabel = (label: string) => `${label} (on a hit)`;

/**
 * FR-MOD-20, §7 "Roll lines": a damage roll's offered parts after its total, muted, as on the
 * card: " (+ 6 radiant Divine Fury on a hit)"; players read a non-public trigger as "(DM)" ("+ 9
 * (DM)"), the DM's line names it (`dm` = `dmPayload` names, same index); "(rolled for you)" after
 * a server-rolled part of a physical roll. FR-MOD-57: each part's dice (the payload's, which
 * every viewer of the roll gets) follow it, `offered: true` (dashed, never struck: whether the
 * offer landed shows only on the outcome line): " (+ 6 radiant Divine Fury (1d6+2: 4 + 2) on a
 * hit)".
 */
export function rollOfferSegments(
  offered: readonly RollOfferView[] | undefined,
  dm?: readonly { label: string }[] | null,
): LineSegment[] {
  if (!offered?.length) return [];
  const out: LineSegment[] = [];
  // Plain text runs merge, so a line without dice reads as one muted segment, as before.
  const text = (t: string) => {
    const last = out[out.length - 1];
    if (last && !last.die) last.text += t;
    else out.push({ text: t, style: "muted" });
  };
  text(" (");
  offered.forEach((o, i) => {
    const named = dm?.[i]?.label ?? o.label;
    const label = named ?? DM_PART_LABEL;
    // A part players read as "(DM)" shows its value only (rulings B4).
    const dice = partDiceView(named === null ? {} : o, o.value, offeredDieLabel(label), true);
    text(`${i > 0 ? ", " : ""}+ `);
    if (dice.value.die) out.push({ ...dice.value, style: "muted" });
    else text(dice.value.text);
    text(`${o.type ? ` ${o.type}` : ""} ${label}${o.auto ? ` ${AUTO_PART_TEXT}` : ""}`);
    out.push(...dice.after);
  });
  text(" on a hit)");
  return out;
}

const MULT_TEXT = { normal: "", half: " (half)", none: " (none)", double: " (double)" } as const;

/** A landed part as the public line carries it (`AttackLinePart`). */
export interface LinePartView {
  label: string | null;
  value: number;
  type: string | null;
  multiplier?: keyof typeof MULT_TEXT;
  /** FR-MOD-57: public character triggers only (rulings B3, B4). */
  expression?: string;
  dice?: readonly number[];
}

/** The DM's facts of a line part (`AttackLineDmPart`, same index). */
export interface LineDmPartView {
  label: string;
  rolled: number;
  set?: true;
  forced?: true;
  /** FR-MOD-57: every part's roll. */
  expression?: string;
  dice?: readonly number[];
}

/**
 * Segments of the parts after the weapon damage: " + 6 radiant (Divine Fury)" (typed: its type
 * differs from the attack's), " + 9 Martial Advantage" (untyped), " + 9 (DM)" (non-public, for
 * players); then the part's own multiplier; the DM's line names every part and adds " (DM set;
 * rolled 7)" after an edited value and " (DM ruled)" after a forced charge. FR-MOD-57: then the
 * part's dice, labelled with its name: " (1d6+2: 4 + 2)", from `dm` on the DM's line (`dm`
 * given) and from the part on players' (built only from `payload` / `dmPayload`, rulings B4).
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
    // Players' dice come from the part (payload), the DM's from `dm` (rulings B4).
    const dice = label === null ? null : partDiceView(d?.dice ? d : p, p.value, label);
    const out: LineSegment[] = [{ text: " + " }, dice?.value ?? { text: String(p.value) }];
    if (typed) out.push({ text: ` ${p.type}` });
    if (label === null) out.push({ text: ` ${DM_PART_LABEL}`, style: "muted" });
    else out.push({ text: typed ? ` (${label})` : ` ${label}`, style: "muted" });
    if (p.multiplier) out.push({ text: MULT_TEXT[p.multiplier] });
    if (d?.set) out.push({ text: ` (DM set; rolled ${d.rolled})`, style: "muted" });
    if (d?.forced) out.push({ text: " (DM ruled)", style: "muted" });
    out.push(...(dice?.after ?? []));
    return out;
  });
}

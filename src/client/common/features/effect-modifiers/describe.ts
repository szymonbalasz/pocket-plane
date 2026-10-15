// Modifiers in words (FR-MOD-26, MOD §7): "+1d4 attack rolls, saving throws", "+2 weapon
// damage", "−1d4 WIS saving throws". Pure; both clients (sheet section, editor preview, dialogs).
import type { AnyModifier, Modifier, RollSel } from "@shared/effect-modifiers/schemas";

const abil = (a: readonly string[] | undefined) =>
  a?.length ? `${a.map((x) => x.toUpperCase()).join(", ")} ` : "";

/** What a selector covers: "attack rolls", "weapon damage", "DEX saving throws". */
export function selectorText(on: RollSel | { roll: "ac" }): string {
  if (on.roll === "ac") return "AC";
  const via = "via" in on && on.via ? `${on.via} ` : "";
  switch (on.roll) {
    case "attack":
      return `${via}attack rolls`;
    case "damage":
      return `${via}damage`;
    case "save":
      return `${abil(on.abilities)}saving throws`;
    case "check":
      return `${abil(on.abilities)}checks`;
    case "initiative":
      return "initiative";
  }
}

/** The signed amount: "+1d4", "−1d4", "+2", "−3"; "adv" / "dis"; "resist fire". */
export function amountText(m: AnyModifier): string {
  if (m.kind === "dice") return `${m.sign < 0 ? "−" : "+"}${m.dice}`;
  if (m.kind === "flat") return `${m.value < 0 ? "−" : "+"}${Math.abs(m.value)}`;
  if (m.kind === "mode") return m.mode === "advantage" ? "adv" : "dis";
  return `${m.level} ${m.types.join(", ")}`;
}

/** One modifier: "+1d4 attack rolls". */
export function modifierText(m: AnyModifier): string {
  if (m.kind === "defense") return amountText(m);
  return `${amountText(m)} ${selectorText(m.on)}`;
}

/**
 * A list in words, runs of the same amount merged: Bless → "+1d4 attack rolls, saving throws";
 * Rage (tier 1) → "+2 weapon damage". Empty → "".
 */
export function modifiersText(list: readonly Modifier[] | undefined): string {
  const groups: { amount: string; what: string[] }[] = [];
  for (const m of list ?? []) {
    const amount = amountText(m);
    const what = m.kind === "defense" ? "" : selectorText(m.on);
    const last = groups.at(-1);
    if (last && last.amount === amount && what) last.what.push(what);
    else groups.push({ amount, what: what ? [what] : [] });
  }
  return groups.map((g) => [g.amount, g.what.join(", ")].filter(Boolean).join(" ")).join("; ");
}

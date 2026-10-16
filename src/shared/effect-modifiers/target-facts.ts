// Target-side facts for the DM's attack popup (FR-MOD-24, -25; tier 2), pure, the client twin of
// MOD's apply-hook line (`target-facts.ts` on the server): a target row's effective AC with its
// parts ("AC 17 (15 + 2 Shield of Faith)") and the multiplier its defenses preset for a damage
// type ("Half (Rage)"). The server applies the DM's choice (FR-MOD-25).
import {
  type AcPart,
  type CreatureRef,
  DEFENSE_MULTIPLIER,
  defenseFor,
  effectiveAc,
  type ModEffect,
} from "./rules";

/** What the popup reads of a target combatant (a PC's effects sit on its character). */
export interface TargetLike {
  id: string;
  kind: "pc" | "monster";
  entityId?: string | null;
}

export const targetCreature = (c: TargetLike): CreatureRef =>
  c.kind === "pc" && c.entityId ? { characterId: c.entityId } : { combatantId: c.id };

export type PresetMultiplier = (typeof DEFENSE_MULTIPLIER)[keyof typeof DEFENSE_MULTIPLIER];

export interface TargetFacts {
  /** Effective AC (stored + `flat` on `ac`); null when the stored AC is unknown. */
  ac: { value: number; stored: number; parts: AcPart[] } | null;
  /** The defense against the card's damage type, its multiplier preset and hint ("Half (Rage)"). */
  defense: { level: string; label: string; multiplier: PresetMultiplier; hint: string } | null;
}

const MULT_LABEL: Record<PresetMultiplier, string> = {
  normal: "Normal",
  half: "Half",
  none: "None",
  double: "Double",
};

/** FR-MOD-25: the multiplier a defense presets for `type`, or null (none applies / untyped). */
export function defensePreset(
  effects: readonly ModEffect[],
  target: TargetLike,
  type: string | null,
): TargetFacts["defense"] {
  const d = defenseFor(effects, targetCreature(target), type);
  if (!d) return null;
  const multiplier = DEFENSE_MULTIPLIER[d.level];
  const hint = d.label ? `${MULT_LABEL[multiplier]} (${d.label})` : MULT_LABEL[multiplier];
  return { level: d.level, label: d.label, multiplier, hint };
}

/** FR-MOD-24, -25: one target row's facts for the card's damage type. */
export function targetFacts(
  effects: readonly ModEffect[],
  target: TargetLike,
  storedAc: number | null,
  damageType: string | null,
): TargetFacts {
  const ac =
    storedAc === null
      ? null
      : (() => {
          const e = effectiveAc(storedAc, effects, targetCreature(target));
          return { value: e.ac, stored: storedAc, parts: e.parts };
        })();
  return { ac, defense: defensePreset(effects, target, damageType) };
}

/** "AC 17 (15 + 2 Shield of Faith)"; no parts → "AC 15". */
export function acText(ac: NonNullable<TargetFacts["ac"]>): string {
  if (ac.parts.length === 0) return `AC ${ac.value}`;
  const parts = ac.parts
    .map((p) => `${p.value < 0 ? "−" : "+"} ${Math.abs(p.value)}${p.label ? ` ${p.label}` : ""}`)
    .join(" ");
  return `AC ${ac.value} (${ac.stored} ${parts})`;
}

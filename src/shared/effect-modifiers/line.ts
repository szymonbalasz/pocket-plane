// Roll-hook parts in log lines (FR-MOD-20): one shared formatter for the `roll` kind and
// combat's lines. "+ 3 Bless" / "− 2 Bane"; a part whose effect players don't receive reads
// "(DM)" unless the DM's names are given; "(rolled for you)" on server-rolled dice of a
// physical roll (FR-MOD-18). Mode hints: "adv: Rage".
import type { LineSegment } from "@shared/dice-roll-log/kind-types";
import type { DmModPart, RollModPart } from "@shared/dice-roll-log/schemas";

export const DM_PART_LABEL = "(DM)";
export const AUTO_PART_TEXT = "(rolled for you)";

/** Sum of the parts' values (the part of a payload `total` that is not the base roll). */
export const modsTotal = (mods: readonly Pick<RollModPart, "value">[] | undefined): number =>
  (mods ?? []).reduce((s, m) => s + m.value, 0);

/** Segments after the base dice and constant; `dm` = `dmPayload` names, same index. */
export function modSegments(
  mods: readonly RollModPart[] | undefined,
  dm?: readonly DmModPart[] | null,
): LineSegment[] {
  return (mods ?? []).flatMap((m, i) => {
    const label = dm?.[i]?.label ?? m.label;
    const out: LineSegment[] = [
      { text: m.value < 0 ? " − " : " + " },
      { text: String(Math.abs(m.value)) },
      { text: ` ${label ?? DM_PART_LABEL}`, style: "muted" },
    ];
    if (m.auto) out.push({ text: ` ${AUTO_PART_TEXT}`, style: "muted" });
    return out;
  });
}

/** "Rage, (DM)": mode-hint labels for "(adv: …)"; `dm` = `dmPayload` names, same index. */
export function modeLabels(
  modes: readonly (string | null)[] | undefined,
  dm?: readonly DmModPart[] | null,
): string {
  return (modes ?? []).map((l, i) => dm?.[i]?.label ?? l ?? DM_PART_LABEL).join(", ");
}

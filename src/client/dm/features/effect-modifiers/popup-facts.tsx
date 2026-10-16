// MOD tier 2 in the DM's attack popup (FR-MOD-24, -25): the effective AC a row's Hit preset is
// compared with (AC cell "17" with a "+2" marker and the parts in a Tooltip), the multiplier a
// target's defenses preset for the card's damage type, and MOD's `popupParts` line with the hint
// ("Half (Rage)"). Facts only: the DM changes any of them; the server applies the DM's choice.
import { EFFECT_TYPE, type EffectView } from "@shared/combat-extras/schemas";
import type { CombatantView } from "@shared/combat-tracker/schemas";
import { acText, type TargetFacts, targetFacts } from "@shared/effect-modifiers/target-facts";
import { Tooltip } from "@ui/components/ui/overlays";
import { useRecords } from "@ui/sync/store";
import { useMemo } from "react";
// Types only: `popup-parts.ts` imports this line (no runtime cycle).
import type { PopupPart, PopupPartProps } from "../combat-tracker/popup-parts";

const activeOnly = (effects: readonly EffectView[]) =>
  effects.filter((e) => (e.endedAt ?? null) === null);

/** The DM store's active effects (every effect: the DM receives all, FR-CBTX-31). */
export function useActiveEffects(): EffectView[] {
  const effects = useRecords<EffectView>(EFFECT_TYPE);
  return useMemo(() => activeOnly(effects), [effects]);
}

/** One target row's facts vs the card's damage type (FR-MOD-24, -25). */
export const rowFacts = (
  effects: readonly EffectView[],
  c: CombatantView,
  storedAc: number | null,
  damageType: string | null,
): TargetFacts =>
  targetFacts(effects, { id: c.id, kind: c.kind, entityId: c.entityId }, storedAc, damageType);

/**
 * FR-MOD-24: the row's AC cell: "vs AC 17 →" (or "AC 17" on a damage-only card) with a "+2"
 * marker and "AC 17 (15 + 2 Shield of Faith)" in its Tooltip when effects change it.
 */
export function AcCell({
  combatantId,
  facts,
  damageOnly,
}: {
  combatantId: string;
  facts: TargetFacts | undefined;
  damageOnly: boolean;
}) {
  const ac = facts?.ac ?? null;
  const text = damageOnly
    ? `AC ${ac?.value ?? "—"}`
    : ac === null
      ? "vs AC —"
      : `vs AC ${ac.value} →`;
  const delta = ac ? ac.value - ac.stored : 0;
  const cell = (
    <span
      data-testid="mod-popup-ac"
      data-record-id={combatantId}
      data-value={ac?.value ?? ""}
      className="text-xs text-muted-foreground tabular-nums"
    >
      {text}
      {ac && ac.parts.length > 0 && (
        <span className="ml-0.5 text-[10px] text-primary">
          {delta >= 0 ? "+" : "−"}
          {Math.abs(delta)}
        </span>
      )}
    </span>
  );
  return ac && ac.parts.length > 0 ? <Tooltip content={acText(ac)}>{cell}</Tooltip> : cell;
}

/** FR-MOD-25: the defense hint under a target row ("Half (Rage)"); nothing without one. */
function DefenseHint({ card, row }: PopupPartProps<undefined>) {
  const effects = useActiveEffects();
  const facts = useMemo(
    () => rowFacts(effects, row.combatant, null, card.damageType),
    [effects, row.combatant, card.damageType],
  );
  const d = facts.defense;
  if (!d) return null;
  const changed = row.multiplier !== d.multiplier;
  return (
    <p
      data-testid="mod-popup-defense"
      data-record-id={row.targetId}
      data-value={d.level}
      className="text-xs text-muted-foreground"
    >
      {d.hint}
      {changed && " · DM set"}
    </p>
  );
}

/** MOD's `popupParts` line (FR-MOD-25): the hint only; the multiplier itself is the row's. */
export const modDefensePart = {
  id: "effect-modifiers.defense",
  Chips: DefenseHint,
  toInput: () => ({}),
} as unknown as PopupPart; // type-erased as `definePopupPart` does

/** FR-MOD-25: the row's multiplier preset (the card's damage type vs its defenses), else normal. */
export const presetMultiplier = (facts: TargetFacts | undefined) =>
  facts?.defense?.multiplier ?? "normal";

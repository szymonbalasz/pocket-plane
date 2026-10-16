// MOD's line in dice-extras' `trayExtras` (FR-MOD-27, FR-DICEX-08 b; seams S4): a staged roll
// control with a `subject` shows its bonus-die groups ("Bless +1d4") and the trigger dice that
// may be offered ("Divine Fury (on a hit) +1d6") as labelled chips beside the base dice. The
// tray's two-d20 preview reads the control's preview mode (TrayWindow). Physical boxes are the
// same groups in `ManualForm` (FR-MOD-18).
import type { RollMode } from "@shared/dice-roll-log/schemas";
import type { TrayRequest } from "../dice-extras/store";
import type { TrayExtra, TrayExtraDice } from "../dice-extras/tray-extras";
import { useRollPreview } from "./roll-preview";

export const MOD_TRAY_EXTRA_KEY = "effect-modifiers";

function useModTrayDice(request: TrayRequest, mode: RollMode): TrayExtraDice[] {
  const options = request.kind === "control" ? request.options : null;
  const preview = useRollPreview(options?.subject, options?.expressions.length ?? 0, true);
  if (!options || !preview.active) return [];
  return options.expressions.flatMap((_, i) =>
    preview.groups(i, { crit: options.crit === true, toHitMode: mode }).flatMap((g) =>
      g.dice.map(
        (d): TrayExtraDice => ({
          label: g.onHit ? `${g.label} (on a hit)` : g.label,
          faces: d.faces,
          count: d.count,
          sign: g.sign * d.sign === -1 ? -1 : 1,
          key: g.key,
        }),
      ),
    ),
  );
}

export const modTrayExtra: TrayExtra = {
  key: MOD_TRAY_EXTRA_KEY,
  order: 10,
  useDice: useModTrayDice,
};

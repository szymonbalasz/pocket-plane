import type { RollKeys } from "@ui/features/dice-roll-log/roll-control";

/**
 * Modifier keys of a menu item's pointer-down, kept for the roll its `onSelect` runs later:
 * Shift / Ctrl pick the mode (FR-DICE-05), Alt stages the roll in the dice tray (FR-DICEX-06).
 */
export function rollKeys(e: RollKeys): RollKeys {
  return { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey };
}

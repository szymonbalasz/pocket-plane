// Attack / Damage roll buttons (#385, FR-CHARX-127, FR-DICEX-98): a click stages the Dice tray
// pre-filled; Alt+click (Option on macOS) rolls at once, as a click did before sprint 15. Sheet and
// NPC rows, the companion card, Initiative Attack ▸ and the kit stat block. Every other roll
// button keeps click = roll.
import type { Locator } from "@playwright/test";

/** Alt+click an Attack / Damage button: roll at once, no tray (physical dice → the popover). */
export const rollNow = (button: Locator, keys: ("Shift" | "Control")[] = []): Promise<void> =>
  button.click({ modifiers: ["Alt", ...keys] });

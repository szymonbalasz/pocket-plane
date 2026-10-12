// Event routing between shell and base layer (FR-SHELL-13).
// Windows, top bar and launcher carry `data-shell-zone`; key events from there, from dialogs /
// menus, or from any editable element never reach base-layer (canvas) key handlers.

export const SHELL_ZONE_ATTR = "data-shell-zone";

export const NON_BASE_KEY_SELECTOR = [
  `[${SHELL_ZONE_ATTR}]`,
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  "input",
  "textarea",
  "select",
  '[contenteditable=""]',
  '[contenteditable="true"]',
].join(", ");

interface TargetLike {
  closest?: (selector: string) => unknown;
  isContentEditable?: boolean;
}

/** True iff a key event with this target may reach base-layer key handlers. */
export function isBaseKeyTarget(target: EventTarget | TargetLike | null): boolean {
  if (!target) return true;
  const t = target as TargetLike;
  if (t.isContentEditable) return false;
  if (typeof t.closest !== "function") return true; // window / document
  return t.closest(NON_BASE_KEY_SELECTOR) === null;
}

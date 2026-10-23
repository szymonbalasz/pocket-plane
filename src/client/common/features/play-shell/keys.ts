// Event routing between shell and base layer (FR-SHELL-13).
// Windows, top bar and launcher carry `data-shell-zone`; key events from there, from dialogs /
// menus, or from any editable element never reach base-layer (canvas) key handlers. Space is the
// exception the map pans with (#199): `spaceAction` decides press vs pan (FR-SHELL-83).

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

// ---- Space: press or pan (FR-SHELL-83; keeps #199 / FR-FOG-17) ----

/** Controls Space activates in the browser (button, ARIA widgets, links, `summary`). */
export const CONTROL_SELECTOR = [
  "button",
  '[role="button"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  "a[href]",
  "summary",
  'input[type="checkbox"]',
  'input[type="radio"]',
].join(", ");

/** Where Space types (text fields): always the browser's. */
const TYPING_SELECTOR = [
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])',
  "textarea",
  "select",
  '[contenteditable=""]',
  '[contenteditable="true"]',
].join(", ");

/**
 * FR-SHELL-165 (the one helper granted to SP, seams S3): the key event's target is a typing
 * target: a text-like `input`, `textarea`, `select` or contenteditable (or inside one). Window
 * bodies, buttons and the canvas are not.
 */
export function isTypingTarget(target: EventTarget | TargetLike | null): boolean {
  const t = target as TargetLike | null;
  if (!t) return false;
  if (t.isContentEditable) return true;
  return typeof t.closest === "function" && t.closest(TYPING_SELECTOR) !== null;
}

/** Dialogs, popovers and menus: Space never reaches the map from inside them. */
const OVERLAY_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
].join(", ");

interface SpaceTargetLike extends TargetLike {
  matches?: (selector: string) => boolean;
}

/**
 * FR-SHELL-83: what a Space `keydown` with focus on `target` does. `browser` (no
 * `preventDefault`: a control activates, a field types): typing, inside a dialog / popover / menu,
 * or on a control or inside a shell zone (window, top bar, launcher) when that focus is
 * keyboard-driven (`keyboard`, `:focus-visible` when it landed) or the pointer is off the map.
 * `pan` (#199, FR-FOG-17): the map, the page, or a control / zone focused by the pointer while
 * the pointer is over the map.
 */
export function spaceAction(
  target: EventTarget | SpaceTargetLike | null,
  opts: { keyboard: boolean; overMap: boolean },
): "browser" | "pan" {
  const t = target as SpaceTargetLike | null;
  if (!t || typeof t.closest !== "function") return "pan"; // window / document
  if (t.isContentEditable || t.closest(TYPING_SELECTOR) !== null) return "browser";
  if (t.closest(OVERLAY_SELECTOR) !== null) return "browser";
  const control = t.closest(CONTROL_SELECTOR) !== null;
  const zone = t.closest(`[${SHELL_ZONE_ATTR}]`) !== null;
  if (!control && !zone) return "pan";
  return opts.keyboard || !opts.overMap ? "browser" : "pan";
}

interface FocusDoc {
  addEventListener(
    type: "focusin" | "pointerdown",
    fn: (e: { target: EventTarget | null }) => void,
    capture: true,
  ): void;
}

const keyboardFocused = new WeakSet<object>();
const tracking = new WeakSet<object>();

/**
 * FR-SHELL-83: remembers, for each element as it gains focus, whether that focus was keyboard-
 * driven (`:focus-visible` at that moment: Tab, arrows, a shortcut). Read at keydown time the
 * pseudo-class itself can't tell: pressing a key turns a clicked button `:focus-visible`. A
 * pointer press makes the pressed element and its ancestors pointer-focused again (a click on
 * the control that already has focus fires no `focusin`). Once per document.
 */
export function trackFocusModality(doc: FocusDoc): void {
  if (tracking.has(doc)) return;
  tracking.add(doc);
  doc.addEventListener(
    "focusin",
    (e) => {
      const el = e.target as SpaceTargetLike | null;
      if (!el || typeof el.matches !== "function") return;
      let visible = false;
      try {
        visible = el.matches(":focus-visible");
      } catch {
        visible = false;
      }
      if (visible) keyboardFocused.add(el);
      else keyboardFocused.delete(el);
    },
    true,
  );
  doc.addEventListener(
    "pointerdown",
    (e) => {
      for (let el = e.target as { parentElement?: unknown } | null; el; ) {
        keyboardFocused.delete(el);
        el = (el.parentElement ?? null) as { parentElement?: unknown } | null;
      }
    },
    true,
  );
}

/** The focus `target` holds was keyboard-driven (`trackFocusModality`). */
export function isKeyboardFocus(target: EventTarget | null): boolean {
  return target !== null && typeof target === "object" && keyboardFocused.has(target);
}

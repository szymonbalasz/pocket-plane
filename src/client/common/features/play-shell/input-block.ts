// The input block of a `blocksInput` overlay (FR-SHELL-112 (2), review-a rulings 4, 5): while it
// is up, every sibling of the overlay layer is `inert`, focus is trapped in the overlay, drags in
// progress are cancelled, and one capture-phase `keydown` / `wheel` / `pointerdown` guard on
// `window` stops every event whose target is outside the overlay (no Space-pan, Escape, tray / log
// shortcuts). The placer's settles queue meanwhile (`ShellController.setBlocked`). Client only:
// the server accepts intents as before (OQ-SHELL-70 A).

/** What a focus trap needs of an element. */
interface Focusable {
  focus(opts?: FocusOptions): void;
}

/** The overlay element: events and focus inside it pass. */
export interface BlockOverlay {
  contains(node: unknown): boolean;
  /** Its focusable elements, in tab order (the trap cycles them). */
  focusables(): readonly Focusable[];
  focus(opts?: FocusOptions): void;
}

export interface BlockEnv {
  overlay: BlockOverlay;
  /** The overlay layer's siblings: made `inert` while blocked. */
  siblings: readonly { inert: boolean }[];
  win: Pick<Window, "addEventListener" | "removeEventListener">;
  doc: { activeElement: unknown } & Pick<Document, "addEventListener" | "removeEventListener">;
}

const cancels = new Set<() => void>();

/** A drag / resize in progress: `cancel` ends it without a write (`ShellWindow`). */
export function onGestureCancel(cancel: () => void): () => void {
  cancels.add(cancel);
  return () => {
    cancels.delete(cancel);
  };
}

/** Cancels every drag in progress (a blocking overlay came up). */
export function cancelGestures(): void {
  for (const c of [...cancels]) c();
}

/** The selector of focusable elements a trap cycles. */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Blocks input outside `env.overlay` until the returned release is called. */
export function blockInput(env: BlockEnv): () => void {
  const { overlay, siblings, win, doc } = env;
  const was = siblings.map((s) => s.inert);
  for (const s of siblings) s.inert = true;
  cancelGestures();
  const first = () => overlay.focusables()[0] ?? overlay;
  const stop = (e: Event) => {
    e.stopImmediatePropagation();
    if (e.cancelable) e.preventDefault();
  };
  const onKey = (e: Event) => {
    if (!overlay.contains(e.target)) {
      stop(e);
      return;
    }
    const k = e as KeyboardEvent;
    if (k.key !== "Tab") return;
    // Focus trap: Tab and Shift+Tab cycle the overlay's focusables.
    const list = overlay.focusables();
    if (list.length === 0) {
      stop(e);
      return;
    }
    const at = list.indexOf(doc.activeElement as Focusable);
    const next = k.shiftKey
      ? at <= 0
        ? list.length - 1
        : at - 1
      : at < 0 || at === list.length - 1
        ? 0
        : at + 1;
    stop(e);
    list[next]?.focus();
  };
  const onOther = (e: Event) => {
    if (!overlay.contains(e.target)) stop(e);
  };
  const onFocus = (e: Event) => {
    if (!overlay.contains(e.target)) first().focus({ preventScroll: true });
  };
  const capture = { capture: true } as const;
  const wheel = { capture: true, passive: false } as const;
  win.addEventListener("keydown", onKey, capture);
  win.addEventListener("wheel", onOther, wheel);
  win.addEventListener("pointerdown", onOther, capture);
  doc.addEventListener("focusin", onFocus, capture);
  if (!overlay.contains(doc.activeElement)) first().focus({ preventScroll: true });
  return () => {
    win.removeEventListener("keydown", onKey, capture);
    win.removeEventListener("wheel", onOther, wheel);
    win.removeEventListener("pointerdown", onOther, capture);
    doc.removeEventListener("focusin", onFocus, capture);
    siblings.forEach((s, i) => {
      s.inert = was[i] ?? false;
    });
  };
}

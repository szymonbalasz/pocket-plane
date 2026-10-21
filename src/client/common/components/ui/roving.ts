// FR-SHELL-84: keyboard reach for Tooltip triggers whose meaning is only in the Tooltip. Inside a
// chip row (`[data-chip-row]`: an Initiative row's chips, a sheet's effects row) the row is one
// tab stop with a roving `tabIndex`: ←/→ (Home / End) move between its chips, Tab leaves the row.
// A trigger that can't take focus (a `span` badge) is made focusable; one inside a focusable
// element of the row (the DM's chip menu button) uses that element. DOM-only, no state stored.

/** A row whose Tooltip triggers share one tab stop. */
export const ROVING_ROW_SELECTOR = "[data-chip-row]";

/** Marks every shared Tooltip trigger (`overlays.tsx`). */
export const TIP_ATTR = "data-tip";

const FOCUSABLE =
  'button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), [data-roving]';

/** Roving moves for a key: next / previous / first / last stop, else null. */
export function rovingMove(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowRight") return Math.min(count - 1, index + 1);
  if (key === "ArrowLeft") return Math.max(0, index - 1);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/**
 * The stop each of a row's triggers is reached by, in order and once each: the trigger itself, or
 * the nearest focusable element around it inside the row. `focusable(el)`: natively focusable.
 */
export function rowStops<T>(triggers: readonly T[], hostOf: (trigger: T) => T): T[] {
  const out: T[] = [];
  for (const t of triggers) {
    const h = hostOf(t);
    if (!out.includes(h)) out.push(h);
  }
  return out;
}

/** Which stop holds the row's tab stop: the one last focused while still a stop, else the first. */
export function currentStop<T>(stops: readonly T[], last: T | undefined): number {
  const i = last === undefined ? -1 : stops.indexOf(last);
  return i < 0 ? 0 : i;
}

const lastFocused = new WeakMap<Element, Element>();
const wired = new WeakSet<Element>();
const pending = new Set<Element>();

const shown = (el: Element) =>
  el.closest('[aria-hidden="true"]') === null && el.getClientRects().length > 0;

/** The element a trigger is focused through: itself, or its focusable ancestor inside `row`. */
export function focusHost(trigger: Element, row: Element | null): Element {
  const up = trigger.parentElement?.closest(FOCUSABLE) ?? null;
  return up && row?.contains(up) ? up : trigger;
}

function stopsOf(row: Element): HTMLElement[] {
  const triggers = [...row.querySelectorAll(`[${TIP_ATTR}]`)].filter(shown);
  return rowStops(triggers, (t) => focusHost(t, row)) as HTMLElement[];
}

/** Gives the row's current stop `tabIndex` 0 and its other stops −1. */
function sync(row: Element): void {
  const stops = stopsOf(row);
  const cur = currentStop(stops, lastFocused.get(row));
  stops.forEach((s, i) => {
    s.tabIndex = i === cur ? 0 : -1;
  });
}

function wire(row: Element): void {
  if (wired.has(row)) return;
  wired.add(row);
  row.addEventListener("focusin", (e) => {
    const stops = stopsOf(row);
    const hit = stops.find((s) => s === e.target || s.contains(e.target as Node));
    if (!hit) return;
    lastFocused.set(row, hit);
    sync(row);
  });
  row.addEventListener("keydown", (e) => {
    const k = e as KeyboardEvent;
    const stops = stopsOf(row);
    const i = stops.indexOf(k.target as HTMLElement);
    if (i < 0) return;
    const next = rovingMove(k.key, i, stops.length);
    if (next === null || next === i) return;
    k.preventDefault();
    const to = stops[next] as HTMLElement;
    lastFocused.set(row, to);
    sync(row);
    to.focus();
  });
}

/**
 * Called by each Tooltip trigger on mount (and its cleanup on unmount): in a chip row, the row is
 * wired and its tab stops re-synced after the render; elsewhere, a trigger that can't take focus
 * becomes a tab stop of its own. Returns the element keyboard focus reaches the trigger through.
 */
export function enrollTrigger(trigger: HTMLElement): { host: Element; dispose: () => void } {
  const row = trigger.closest(ROVING_ROW_SELECTOR);
  const host = focusHost(trigger, row);
  if (host === trigger && !trigger.matches(FOCUSABLE)) {
    trigger.setAttribute("data-roving", "");
    if (!row) trigger.tabIndex = 0;
  }
  const schedule = () => {
    if (!row) return;
    wire(row);
    if (pending.has(row)) return;
    pending.add(row);
    queueMicrotask(() => {
      pending.delete(row);
      if (row.isConnected) sync(row);
    });
  };
  schedule();
  return { host, dispose: schedule };
}

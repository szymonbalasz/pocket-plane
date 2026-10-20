// Initiative rows below the fold (FR-CBT-77, G4), both clients: when combatant rows appear (Start,
// add, restore, reveal) or the Pending section first appears, the first new one scrolls into view
// if it is below the fold; while any row is below it, a "↓ N more" footer scrolls to them.
// FR-CBT-125 (BL-43): the row list is its own clipping viewport and the footer sits below it, in
// its own space; the window may grow to its content (FR-SHELL-39), so at its cap the body is
// capped too (`useListViewport`) and the list, not the window body, scrolls.
import { useGrowthCaps } from "@ui/features/play-shell/free-area";
import { growsToContent, windowRect } from "@ui/features/play-shell/geometry";
import { useViewport } from "@ui/features/play-shell/hooks";
import { windowId } from "@ui/features/play-shell/manager";
import { useRegistry, useShellState } from "@ui/features/play-shell/ShellContext";
import { ArrowDownIcon } from "lucide-react";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { INITIATIVE_KIND } from "./window";

/** Ids in `next` not in `prev`, in `next` order. */
export function newIds(prev: readonly string[], next: readonly string[]): string[] {
  const seen = new Set(prev);
  return next.filter((id) => !seen.has(id));
}

/** Rows not wholly above `viewBottom` (viewport px): below the fold. */
export function countBelow(rows: readonly { bottom: number }[], viewBottom: number): number {
  return rows.filter((r) => r.bottom > viewBottom + 1).length;
}

const ROW_SELECTOR = '[data-testid="cbt-init-row"]';

/** The nearest ancestor of `el` that scrolls vertically now. */
function scrollerOf(el: Element | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

/**
 * FR-CBT-125: the Initiative body's max height, px, so its row list clips and scrolls instead of
 * the window body: `natural` = the body's height with every row shown, `avail` = the window body's
 * content box. Null (no cap) while everything fits.
 */
export function listClip(natural: number, avail: number): number | null {
  return natural > avail + 1 ? Math.floor(avail) : null;
}

/**
 * FR-CBT-125: caps the Initiative body (`rootRef`) at the window body's height while its rows
 * (`listRef`, the scrolling list; `footerRef`, "↓ N more") don't fit, so the list is the clipping
 * viewport and the footer sits under it: no row paints in the body's padding or past the footer
 * (sim-9 c03). A growing window (FR-SHELL-39) is as tall as its content up to its cap, so the cap
 * comes from the height the window would take for the uncapped content (`windowRect`), never from
 * the capped one: the window still grows when the cap moves (another window, the viewport).
 */
export function useListViewport(
  rootRef: RefObject<HTMLElement | null>,
  listRef: RefObject<HTMLElement | null>,
  footerRef: RefObject<HTMLElement | null>,
  rowIds: readonly string[],
): number | null {
  // `h`: the body's content with every row shown; `frame`: title bar, borders, body padding.
  const [natural, setNatural] = useState<{ h: number; frame: number } | null>(null);
  const win = useShellState((s) =>
    s.windows.find((w) => windowId(w.kind, w.instance) === windowId(INITIATIVE_KIND)),
  );
  const def = useRegistry().get(INITIATIVE_KIND);
  const vp = useViewport();
  const caps = useGrowthCaps(windowId(INITIATIVE_KIND));
  const key = rowIds.join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the rows change
  useLayoutEffect(() => {
    const root = rootRef.current;
    const list = listRef.current;
    const section = root?.closest<HTMLElement>('[data-testid="ui-window"]');
    const body = root?.closest('[data-testid="ui-window-content"]')?.parentElement;
    if (!root || !list || !section || !body) return;
    const measure = () => {
      const cs = getComputedStyle(body);
      const pad = Number.parseFloat(cs.paddingTop) + Number.parseFloat(cs.paddingBottom);
      const f = footerRef.current;
      const footer =
        f && !f.hidden
          ? f.offsetHeight + Number.parseFloat(getComputedStyle(root).rowGap || "0")
          : 0;
      const h = root.offsetHeight + list.scrollHeight - list.clientHeight - footer;
      const frame = section.offsetHeight - body.clientHeight + pad;
      setNatural((n) => (n?.h === h && n.frame === frame ? n : { h, frame }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    for (const el of [section, root, list, ...list.children]) ro.observe(el);
    return () => ro.disconnect();
  }, [rootRef, listRef, footerRef, key]);
  if (!natural || !win || !def || !growsToContent(win, def)) return null;
  const rect = windowRect(win, def, vp, natural.h + natural.frame, caps);
  return listClip(natural.h, rect.h - natural.frame);
}

/**
 * Boxes whose size moves the fold: the root, its rows and row list, and every ancestor up to and
 * including the shell window (body, content wrapper, window section).
 */
export function foldBoxes(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  const out: HTMLElement[] = [root, ...root.querySelectorAll<HTMLElement>(ROW_SELECTOR)];
  const list = root.querySelector<HTMLElement>(ROW_SELECTOR)?.parentElement;
  if (list && list !== root) out.push(list);
  for (let p = root.parentElement; p; p = p.parentElement) {
    out.push(p);
    if (p.dataset.testid === "ui-window") break;
  }
  return out;
}

/**
 * `rootRef` = the Initiative body; `rowIds` = the rows in list order; `pendingShown` = the DM's
 * Pending section is there. Returns the count below the fold and the footer's scroll action.
 */
export function useBelowFold(
  rootRef: RefObject<HTMLElement | null>,
  footerRef: RefObject<HTMLElement | null>,
  rowIds: readonly string[],
  pendingShown = false,
) {
  const [more, setMore] = useState(0);
  const rowsOf = useCallback(
    () => [...(rootRef.current?.querySelectorAll<HTMLElement>(ROW_SELECTOR) ?? [])],
    [rootRef],
  );
  const foldOf = useCallback(() => {
    const scroller = scrollerOf(rootRef.current?.querySelector(ROW_SELECTOR) ?? null);
    if (!scroller) return null;
    // The footer sits under the list (FR-CBT-125); were it inside the scroller, its top would be
    // the fold.
    const bottom = scroller.getBoundingClientRect().bottom;
    const f = footerRef.current;
    if (!f || f.hidden || !scroller.contains(f)) return bottom;
    return Math.min(bottom, f.getBoundingClientRect().top);
  }, [rootRef, footerRef]);
  const below = useCallback(() => {
    const fold = foldOf();
    if (fold === null) return [];
    return rowsOf().filter((r) => r.getBoundingClientRect().bottom > fold + 1);
  }, [foldOf, rowsOf]);

  const measure = useCallback(() => {
    const fold = foldOf();
    setMore(
      fold === null
        ? 0
        : countBelow(
            rowsOf().map((r) => r.getBoundingClientRect()),
            fold,
          ),
    );
  }, [foldOf, rowsOf]);

  // Re-measure whenever any box between the rows and the window changes size: the window grows
  // to its content a frame after the rows change (FR-SHELL-39), which resizes the body / list but
  // not the root, so observing the root alone left the count stale (walkthrough G4).
  const key = rowIds.join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-observe when the rows change
  useEffect(() => {
    measure();
    const root = rootRef.current;
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    for (const el of foldBoxes(root)) ro?.observe(el);
    const frame = requestAnimationFrame(measure);
    // `scroll` doesn't bubble; capture sees the body's and the list's.
    document.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
      document.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [measure, rootRef, key]);

  // New rows (and the Pending section's first appearance) scroll into view when below the fold.
  const prev = useRef<readonly string[]>([]);
  const hadPending = useRef(pendingShown);
  // biome-ignore lint/correctness/useExhaustiveDependencies: on row-set and Pending changes
  useLayoutEffect(() => {
    const added = newIds(prev.current, rowIds);
    prev.current = rowIds;
    const pendingAppeared = pendingShown && !hadPending.current;
    hadPending.current = pendingShown;
    const root = rootRef.current;
    if (!root) return;
    if (pendingAppeared) {
      root.querySelector('[data-testid="cbt-init-pending-list"]')?.scrollIntoView?.({
        block: "nearest",
      });
    }
    const first = added[0];
    const el = first
      ? root.querySelector<HTMLElement>(`${ROW_SELECTOR}[data-record-id="${first}"]`)
      : null;
    const fold = foldOf();
    if (el && fold !== null && el.getBoundingClientRect().bottom > fold + 1) {
      el.scrollIntoView?.({ block: "center" });
    }
    measure();
  }, [key, pendingShown]);

  const scrollToMore = () => below()[0]?.scrollIntoView?.({ block: "center" });
  return { more, scrollToMore };
}

/**
 * Footer "↓ N more" (`cbt-init-more`, `data-value` = N) under the row list, in its own space
 * (FR-CBT-125); hidden while N = 0, so the list takes its room.
 */
export function MoreFooter({
  footerRef,
  more,
  onClick,
}: {
  footerRef: RefObject<HTMLButtonElement | null>;
  more: number;
  onClick(): void;
}) {
  return (
    <button
      ref={footerRef}
      type="button"
      data-testid="cbt-init-more"
      data-value={more}
      hidden={more === 0}
      className="flex w-full shrink-0 items-center justify-center gap-1 rounded-md border bg-card py-0.5 text-xs text-muted-foreground shadow-sm hover:text-foreground"
      onClick={onClick}
    >
      <ArrowDownIcon className="size-3" aria-hidden /> {more} more
    </button>
  );
}

// Initiative rows below the fold (FR-CBT-77, G4), both clients: when combatant rows appear (Start,
// add, restore, reveal) or the Pending section first appears, the first new one scrolls into view
// if it is below the fold; while any row is below it, a sticky "↓ N more" footer scrolls to them.
// The window may grow to its content (FR-SHELL-39), so the scroller is whichever ancestor scrolls:
// the window body while growing, the row list after a user resize.
import { ArrowDownIcon } from "lucide-react";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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
    // The sticky footer covers the scroller's bottom only when it scrolls with it (growing window).
    const f = footerRef.current;
    const footer = f && scroller.contains(f) ? f.getBoundingClientRect().height : 0;
    return scroller.getBoundingClientRect().bottom - footer;
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

  useEffect(() => {
    measure();
    const root = rootRef.current;
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (root) ro?.observe(root);
    // `scroll` doesn't bubble; capture sees the body's and the list's.
    document.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      document.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [measure, rootRef]);

  // New rows (and the Pending section's first appearance) scroll into view when below the fold.
  const prev = useRef<readonly string[]>([]);
  const hadPending = useRef(pendingShown);
  const key = rowIds.join();
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

/** Sticky footer "↓ N more" (`cbt-init-more`, `data-value` = N); hidden while N = 0. */
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
      className="sticky bottom-0 z-10 flex w-full shrink-0 items-center justify-center gap-1 rounded-md border bg-card py-0.5 text-xs text-muted-foreground shadow-sm hover:text-foreground"
      onClick={onClick}
    >
      <ArrowDownIcon className="size-3" aria-hidden /> {more} more
    </button>
  );
}

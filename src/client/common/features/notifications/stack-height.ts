// FR-NOTE-32: the DM stack's measured height, its own module so the runtime test can stub it (a
// static render runs no layout effect).
import { type RefObject, useLayoutEffect, useState } from "react";

/**
 * The stack's rendered height (DM), re-measured when it mounts (`shown` flips) and on resize
 * while mounted.
 */
export function useStackHeight(
  ref: RefObject<HTMLElement | null>,
  on: boolean,
  shown: boolean,
): number {
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !shown || !el) {
      setH(0);
      return;
    }
    const measure = () => setH(Math.ceil(el.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, on, shown]);
  return h;
}

// FR-NOTE-32: the DM stack's measured height, its own module so the runtime test can stub it (a
// static render runs no layout effect).
import { type RefObject, useLayoutEffect, useState } from "react";

/**
 * The stack's rendered height (DM), re-measured after every commit of its runtime and on resize
 * while mounted. BL-118: the commit's own measure is a layout effect, so each fold step's new
 * height (and the step after it) lands before the browser paints; `ResizeObserver` alone reported
 * it a frame later, and every step was drawn (4–5 stack states per arriving card).
 */
export function useStackHeight(
  ref: RefObject<HTMLElement | null>,
  on: boolean,
  shown: boolean,
): number {
  const [h, setH] = useState(0);
  // BL-118: after every commit (the same height again → no render).
  useLayoutEffect(() => {
    const el = ref.current;
    setH(on && shown && el ? Math.ceil(el.getBoundingClientRect().height) : 0);
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !shown || !el || typeof ResizeObserver === "undefined") return;
    // Content that changes outside the runtime's commits (a toast's own re-render, a font).
    const ro = new ResizeObserver(() => setH(Math.ceil(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, on, shown]);
  return h;
}

// FR-NOTE-50 (walkthrough T4): the open modal dialogs' rects, viewport px, followed live (a dialog
// opening, closing or resizing). The DM stack keeps off them like a hard keep-out (FR-NOTE-43), so
// no toast sits under or over a dialog. Non-modal popups (`aria-modal="false"`, the attack popup
// that opens over its toast, FR-CBT-75) don't count.
import { useEffect, useState } from "react";
import type { Rect } from "../play-shell/geometry";

export const OPEN_DIALOG_SELECTOR =
  '[role="dialog"][data-state="open"]:not([aria-modal="false"]), [role="alertdialog"][data-state="open"]';

const same = (a: readonly Rect[], b: readonly Rect[]) =>
  a.length === b.length &&
  a.every((r, i) => {
    const o = b[i] as Rect;
    return r.x === o.x && r.y === o.y && r.w === o.w && r.h === o.h;
  });

/** The rects of `OPEN_DIALOG_SELECTOR` elements now (none drawn → none). */
export function openDialogRects(root: ParentNode = document): Rect[] {
  const out: Rect[] = [];
  for (const el of root.querySelectorAll(OPEN_DIALOG_SELECTOR)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      out.push({
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    }
  }
  return out;
}

/** The open dialogs' rects while `on` (the DM stack), re-read on DOM and size changes. */
export function useDialogRects(on: boolean): Rect[] {
  const [rects, setRects] = useState<Rect[]>([]);
  useEffect(() => {
    if (!on || typeof document === "undefined" || typeof MutationObserver === "undefined") return;
    const read = () => {
      const next = openDialogRects();
      setRects((cur) => (same(cur, next) ? cur : next));
    };
    // One read per frame (coalesced); Radix animates in, so read once more after it settles.
    let raf = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          read();
        });
      }
      clearTimeout(settle);
      settle = setTimeout(read, 250);
    };
    const mo = new MutationObserver(later);
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });
    window.addEventListener("resize", later);
    read();
    return () => {
      mo.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(settle);
      window.removeEventListener("resize", later);
      setRects([]);
    };
  }, [on]);
  return rects;
}

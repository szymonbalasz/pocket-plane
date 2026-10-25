// FR-NOTE-50 (walkthrough T4): the open modal dialogs' rects, viewport px, followed live (a dialog
// opening, closing or resizing). The DM stack keeps off them like a hard keep-out (FR-NOTE-43), so
// no toast sits under or over a dialog. Non-modal popups (`aria-modal="false"`, the attack popup
// that opens over its toast, FR-CBT-75) don't count here. *(Sprint 11, F2)* FR-NOTE-78 (BL-108):
// they are followed apart (`usePopupRects`) and block the stack like Initiative.
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

/**
 * FR-NOTE-78 (BL-108): open non-modal popups (`role=dialog`, `aria-modal="false"`: the
 * damage-card popup, FR-CBT-75): drawn, not hidden while it measures its first layout.
 */
export const POPUP_SELECTOR = '[role="dialog"][aria-modal="false"]';

/** FR-NOTE-78: what counts as a popup's control (the stack covers the fewest when it must). */
const POPUP_CONTROLS =
  'button, input, select, textarea, a[href], [role="button"], [role="checkbox"], [role="combobox"]';

/** A popup as the DM stack sees it: its rect and its controls, viewport px. */
export type PopupRect = Rect & { controls: Rect[] };

const box = (r: DOMRect): Rect => ({
  x: Math.round(r.left),
  y: Math.round(r.top),
  w: Math.round(r.width),
  h: Math.round(r.height),
});

/** The drawn `POPUP_SELECTOR` elements now, with their controls. */
export function openPopupRects(root: ParentNode = document): PopupRect[] {
  const out: PopupRect[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(POPUP_SELECTOR)) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || el.style.visibility === "hidden") continue;
    const controls: Rect[] = [];
    for (const c of el.querySelectorAll(POPUP_CONTROLS)) {
      const b = c.getBoundingClientRect();
      if (b.width >= 4 && b.height >= 4) controls.push(box(b));
    }
    out.push({ ...box(r), controls });
  }
  return out;
}

const samePopups = (a: readonly PopupRect[], b: readonly PopupRect[]) =>
  same(a, b) && a.every((p, i) => same(p.controls, (b[i] as PopupRect).controls));

/**
 * FR-NOTE-78: the open non-modal popups while `on` (the DM stack), re-read once a frame on DOM,
 * style (a drag moves it) and size changes.
 */
export function usePopupRects(on: boolean): PopupRect[] {
  const [rects, setRects] = useState<PopupRect[]>([]);
  useEffect(() => {
    if (!on || typeof document === "undefined" || typeof MutationObserver === "undefined") return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const next = openPopupRects();
      setRects((cur) => (samePopups(cur, next) ? cur : next));
    };
    const later = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    const mo = new MutationObserver(later);
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "data-state"],
    });
    window.addEventListener("resize", later);
    read();
    return () => {
      mo.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", later);
      setRects([]);
    };
  }, [on]);
  return rects;
}

/** BL-120: the record ids the `POPUP_SELECTOR` elements show now (measuring ones too), sorted. */
export function openPopupIds(root: ParentNode = document): string[] {
  const ids = new Set<string>();
  for (const el of root.querySelectorAll(POPUP_SELECTOR)) {
    const id = el.getAttribute("data-record-id");
    if (id) ids.add(id);
  }
  return [...ids].sort();
}

/**
 * BL-120: the open non-modal popups' record ids while `on` (the DM), re-read once a frame on DOM
 * changes (a popup opens, closes or switches to another card), joined with ",".
 */
export function usePopupIds(on: boolean): string {
  const [ids, setIds] = useState("");
  useEffect(() => {
    if (!on || typeof document === "undefined" || typeof MutationObserver === "undefined") return;
    let raf = 0;
    const read = () => {
      raf = 0;
      setIds(openPopupIds().join(","));
    };
    const mo = new MutationObserver(() => {
      if (!raf) raf = requestAnimationFrame(read);
    });
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-record-id"],
    });
    read();
    return () => {
      mo.disconnect();
      cancelAnimationFrame(raf);
      setIds("");
    };
  }, [on]);
  return ids;
}

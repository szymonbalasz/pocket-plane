// FR-MAP-116: drag a Scenes list row. A primary press + 4 px lifts it; a line or a highlighted
// folder marks the spot (autoscroll at the list's edges). The drop sends one move (not optimistic:
// the row moves with the event frame); Esc, pointer cancel or going offline send nothing.
// Hand-rolled pointer events, as the Initiative's `reorder-drag.tsx`; a press that never moves stays
// a click.
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { autoscrollStep, DRAG_THRESHOLD } from "../combat-tracker/reorder";
import { type Drop, dropAt, type FlatRow, type RowBox } from "./list-drop";

export interface ListDrag {
  /** The entry being dragged and its landing spot (null = no valid spot under the pointer). */
  dragging: { id: string; drop: Drop | null } | null;
  start(e: ReactPointerEvent<HTMLElement>, row: FlatRow): void;
}

export function useListDrag({
  listRef,
  rows,
  disabled,
  subtreeOf,
  fits,
  onDrop,
}: {
  listRef: RefObject<HTMLElement | null>;
  rows: readonly FlatRow[];
  disabled: boolean;
  /** The entry and everything below it: not a valid spot. */
  subtreeOf(row: FlatRow): ReadonlySet<string>;
  fits(row: FlatRow, parentId: string | null): boolean;
  onDrop(row: FlatRow, drop: Drop): void;
}): ListDrag {
  const [dragging, setDragging] = useState<ListDrag["dragging"]>(null);
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (disabled) cancel.current?.();
  }, [disabled]);
  useEffect(() => () => cancel.current?.(), []);

  const start = (e: ReactPointerEvent<HTMLElement>, row: FlatRow) => {
    const list = listRef.current;
    const target = e.target as Element;
    // Portalled menus bubble here too; the row's own buttons keep their press.
    if (
      e.button !== 0 ||
      e.pointerType === "touch" ||
      disabled ||
      !list ||
      !e.currentTarget.contains(target) ||
      target.closest("[data-no-drag]")
    ) {
      return;
    }
    const { clientX: sx, clientY: sy, pointerId } = e;
    let y = sy;
    let lifted = false;
    let drop: Drop | null = null;
    let boxes: RowBox[] = [];
    let raf = 0;
    let done = false;

    const contentY = () => y - list.getBoundingClientRect().top + list.scrollTop;
    const measure = () => {
      const skip = subtreeOf(row);
      const top = list.getBoundingClientRect().top - list.scrollTop;
      const byId = new Map(
        [...list.querySelectorAll<HTMLElement>("[data-list-row]")].map((el) => [
          el.dataset.listRow as string,
          el.getBoundingClientRect(),
        ]),
      );
      boxes = rows.flatMap((r) => {
        const rect = byId.get(r.id);
        return rect && !skip.has(r.id)
          ? [{ ...r, top: rect.top - top, bottom: rect.bottom - top }]
          : [];
      });
    };
    const update = () => {
      if (!lifted) return;
      const next = dropAt(boxes, contentY(), (parent) => fits(row, parent));
      if (
        next?.parentId !== drop?.parentId ||
        next?.beforeId !== drop?.beforeId ||
        next?.into !== drop?.into ||
        next?.y !== drop?.y
      ) {
        drop = next;
        setDragging({ id: row.id, drop });
      }
    };
    const tick = () => {
      const r = list.getBoundingClientRect();
      const d = autoscrollStep(y, r.top, r.bottom);
      if (d !== 0) {
        const was = list.scrollTop;
        list.scrollTop = was + d;
        if (list.scrollTop !== was) update();
      }
      raf = requestAnimationFrame(tick);
    };
    const noSelect = (ev: Event) => ev.preventDefault();
    const finish = (send: boolean) => {
      if (done) return;
      done = true;
      cancel.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("selectstart", noSelect, true);
      cancelAnimationFrame(raf);
      document.documentElement.style.cursor = "";
      setDragging(null);
      if (!lifted) return;
      // The click this release ends in isn't a view.
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      if (send && drop) onDrop(row, drop);
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      y = ev.clientY;
      if (!lifted) {
        if (Math.hypot(ev.clientX - sx, y - sy) < DRAG_THRESHOLD) return;
        lifted = true;
        measure();
        document.documentElement.style.cursor = "grabbing";
        setDragging({ id: row.id, drop: null });
        raf = requestAnimationFrame(tick);
      }
      update();
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) finish(true);
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) finish(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || !lifted) return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    cancel.current = () => finish(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("selectstart", noSelect, true);
  };

  return { dragging, start };
}

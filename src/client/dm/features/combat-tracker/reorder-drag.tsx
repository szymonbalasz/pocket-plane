// Sprint 8 CB1 (FR-CBTX-62, -63, -69, FR-CBT-165): the DM Initiative's drag reorder. A grip on
// every movable row; a primary press + 4 px lifts the row's block, which follows the pointer inside
// the list (autoscroll at the edges) while a drop line marks the spot with the "→ n" hint. The drop
// sends one `cbtx.moveCombatant` (not optimistic: the row moves with the event frame); Esc,
// pointer cancel or the start spot send nothing. Hand-rolled pointer events with pointer capture,
// as `ShellWindow.tsx`. Move up / down (the row menu) share the intent and the crossing hint.
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import type { MovePlan } from "@shared/combat-tracker/rules";
import type { CombatantView, EncounterView } from "@shared/combat-tracker/schemas";
import { OVERLAY_OPEN_ATTR, Tooltip } from "@ui/components/ui/overlays";
import { deadPc } from "@ui/features/combat-extras/logic";
import { useCbtIntent } from "@ui/features/combat-tracker/store";
import { useSync } from "@ui/sync/store";
import { GripVerticalIcon } from "lucide-react";
import {
  createContext,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  autoscrollStep,
  type Block,
  blocksOf,
  crossingHint,
  DRAG_THRESHOLD,
  dropHint,
  dropSlots,
  nearestSlot,
  noInitiative,
  planOf,
  type Slot,
  stepAnchor,
} from "./reorder";

/** The drag shown: the moved row, the drop spot (null = its start spot) and the line's y. */
export interface DragView {
  id: string;
  slot: Slot | null;
  y: number;
}

export interface Reorder {
  blocks: Block[];
  drag: DragView | null;
  /** The row whose grip is pressed (before and during a drag): its tooltip stays shut. */
  held: string | null;
  /** In flight or not live (FR-CBTX-62, -69): grips and Move items disabled. */
  disabled: boolean;
  /** No movable row has a number: grips disabled, "Roll initiative first". */
  unranked: boolean;
  movable: (id: string) => boolean;
  start: (e: ReactPointerEvent<HTMLElement>, id: string) => void;
  /** FR-CBTX-63: Move up / down (null = disabled). */
  step: (id: string, dir: "up" | "down") => (() => void) | null;
}

export const ReorderContext = createContext<Reorder | null>(null);

/**
 * The DM list's reorder state. `listed`: the layout's rows in rank order; `listRef` the scrolling
 * list, `wrapRef` the positioned box around the rows' `ul` (the drop line's frame).
 */
export function useReorder(
  enc: EncounterView | null | undefined,
  rows: readonly CombatantView[],
  listed: readonly CombatantView[],
  listRef: RefObject<HTMLElement | null>,
  wrapRef: RefObject<HTMLElement | null>,
): Reorder {
  const { send, disabled } = useCbtIntent();
  const store = useSync((s) => s.store);
  const blocks = useMemo(() => blocksOf(listed, rows), [listed, rows]);
  const [drag, setDrag] = useState<DragView | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const unranked = noInitiative(blocks);
  const off = disabled || unranked;
  // Disconnected or busy mid-drag: the drag is dropped, nothing sent.
  useEffect(() => {
    if (off) cancel.current?.();
  }, [off]);
  useEffect(() => () => cancel.current?.(), []);

  const commit = async (id: string, afterId: string | null, plan: MovePlan) => {
    if (!enc) return;
    const hint = crossingHint(blocks, plan, id, enc.round, enc.turnCombatantId ?? null, (c) =>
      deadPc(store, c),
    );
    const r = await send(CBTX_INTENTS.moveCombatant, {
      encounterId: enc.id,
      combatantId: id,
      afterId,
    });
    // FR-CBT-165: a silent info toast once the server took the move.
    if (r !== undefined && hint) toast(<span data-testid="cbt-init-move-hint">{hint}</span>);
  };

  const start = (e: ReactPointerEvent<HTMLElement>, id: string) => {
    const list = listRef.current;
    const wrap = wrapRef.current;
    const m = blocks.findIndex((b) => b.head.id === id);
    if (e.button !== 0 || off || !list || !wrap || m < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const grip = e.currentTarget;
    const pid = e.pointerId;
    grip.setPointerCapture(pid);
    setHeld(id);
    const ul = wrap.querySelector("ul");
    const elsOf = (b: Block) =>
      b.rows
        .map((r) => ul?.querySelector<HTMLElement>(`:scope > li[data-record-id="${r.id}"]`))
        .filter((x): x is HTMLElement => x != null);
    const els = blocks.map(elsOf);
    const tops = els.map((x) => x[0]?.offsetTop ?? 0);
    const bottoms = els.map((x) => {
      const last = x.at(-1);
      return last ? last.offsetTop + last.offsetHeight : 0;
    });
    const n = blocks.length;
    const boundary = (i: number) =>
      i <= 0
        ? (tops[0] ?? 0) - 1
        : i >= n
          ? (bottoms[n - 1] ?? 0) + 1
          : ((bottoms[i - 1] ?? 0) + (tops[i] ?? 0)) / 2;
    const slots = dropSlots(blocks, id);
    const lifted = els[m] ?? [];
    const sy = e.clientY;
    const s0 = list.scrollTop;
    let y = sy;
    let dragging = false;
    let slot: Slot | null = null;
    let raf = 0;
    let done = false;
    let shown = false;

    const update = () => {
      if (!dragging) {
        if (Math.abs(y - sy) < DRAG_THRESHOLD) return;
        dragging = true;
        for (const el of lifted) el.setAttribute("data-lifted", "");
        raf = requestAnimationFrame(tick);
      }
      const dy = y - sy + (list.scrollTop - s0);
      const lo = (tops[0] ?? 0) - (tops[m] ?? 0);
      const hi = (bottoms[n - 1] ?? 0) - (bottoms[m] ?? 0);
      const t = Math.min(hi, Math.max(lo, dy));
      for (const el of lifted) el.style.transform = `translateY(${t}px)`;
      const next = nearestSlot(slots, boundary, m, y - wrap.getBoundingClientRect().top);
      if (next !== slot || !shown) {
        shown = true;
        slot = next;
        setDrag({ id, slot, y: next ? boundary(next.index) : 0 });
      }
    };
    // The zone starts below the sticky column header (the list's first child), as at the bottom.
    const header = list.firstElementChild instanceof HTMLElement ? list.firstElementChild : null;
    const tick = () => {
      const r = list.getBoundingClientRect();
      const d = autoscrollStep(y, r.top + (header?.offsetHeight ?? 0), r.bottom);
      if (d !== 0) {
        const was = list.scrollTop;
        list.scrollTop = was + d;
        if (list.scrollTop !== was) update();
      }
      raf = requestAnimationFrame(tick);
    };
    const finish = (send: boolean) => {
      if (done) return;
      done = true;
      cancel.current = null;
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", onUp);
      grip.removeEventListener("pointercancel", onCancel);
      grip.removeEventListener("lostpointercapture", onCancel);
      window.removeEventListener("keydown", onKey, true);
      cancelAnimationFrame(raf);
      for (const el of lifted) {
        el.style.transform = "";
        el.removeAttribute("data-lifted");
      }
      if (grip.hasPointerCapture(pid)) grip.releasePointerCapture(pid);
      setDrag(null);
      setHeld(null);
      if (send && dragging && slot) void commit(id, slot.afterId, slot.plan);
    };
    const onMove = (ev: PointerEvent) => {
      y = ev.clientY;
      update();
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    cancel.current = () => finish(false);
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onUp);
    grip.addEventListener("pointercancel", onCancel);
    grip.addEventListener("lostpointercapture", onCancel);
    window.addEventListener("keydown", onKey, true);
  };

  const step = (id: string, dir: "up" | "down") => {
    const a = disabled ? null : stepAnchor(blocks, id, dir);
    const plan = a ? planOf(blocks, id, a.afterId) : null;
    return a && plan ? () => void commit(id, a.afterId, plan) : null;
  };

  const movable = (id: string) => blocks.some((b) => b.movable && b.head.id === id);
  return { blocks, drag, held, disabled, unranked, movable, start, step };
}

/**
 * FR-CBTX-62: lucide `GripVertical` at a movable row's left (hidden rows too); none on a row riding
 * its owner. It sits in the 8 px gutter left of the turn marker (the list's and the row's padding),
 * so it costs the name line no width. `tabIndex -1`: keyboard users have Move up / down
 * (FR-CBTX-63), no new tab stop.
 */
export function Grip({ c }: { c: CombatantView }) {
  const r = useContext(ReorderContext);
  if (!r?.movable(c.id)) return null;
  return (
    <Tooltip content={r.unranked ? "Roll initiative first" : "Drag to reorder"}>
      {/* Pressed: the captured pointer's moves bubble here, so "overlay open" keeps the tip shut. */}
      <span
        className="absolute inset-y-0 -left-2 flex w-2"
        {...{ [OVERLAY_OPEN_ATTR]: r.held === c.id ? "true" : undefined }}
      >
        <button
          type="button"
          tabIndex={-1}
          data-testid="cbtx-init-row-grip"
          data-record-id={c.id}
          aria-label={`Drag ${c.name} to reorder`}
          disabled={r.disabled || r.unranked}
          className="flex w-full cursor-grab touch-none items-center justify-center text-muted-foreground/70 hover:text-foreground active:cursor-grabbing disabled:cursor-default disabled:opacity-40"
          onPointerDown={(e) => r.start(e, c.id)}
        >
          <GripVerticalIcon className="size-3.5 shrink-0" aria-hidden />
        </button>
      </span>
    </Tooltip>
  );
}

/**
 * FR-CBTX-62: the drop line between blocks (`data-after` = anchor id or `top`), "→ 15" when the
 * drop changes the row's number, and the rows the server rewrites ("Wolf → 17") in a Tooltip.
 */
export function DropLine() {
  const r = useContext(ReorderContext);
  const slot = r?.drag?.slot;
  if (!r?.drag || !slot) return null;
  const hint = dropHint(r.blocks, slot, r.drag.id);
  return (
    <div
      data-testid="cbtx-init-drop"
      data-after={slot.afterId ?? "top"}
      data-number={hint.number ?? undefined}
      className="pointer-events-none absolute inset-x-0 z-30 h-0.5 -translate-y-1/2 rounded bg-primary"
      style={{ top: r.drag.y }}
    >
      {hint.number !== null && (
        <span
          data-testid="cbtx-init-drop-number"
          className="absolute top-1/2 right-1 -translate-y-1/2 rounded bg-primary px-1 text-[11px] font-medium text-primary-foreground tabular-nums"
        >
          → {hint.number}
        </span>
      )}
      {hint.others.length > 0 && (
        <div
          role="tooltip"
          data-testid="cbtx-init-drop-tip"
          className="absolute top-2.5 right-1 max-w-64 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
        >
          {hint.others.join(", ")}
        </div>
      )}
    </div>
  );
}

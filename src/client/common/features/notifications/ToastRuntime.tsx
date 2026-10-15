// Always-mounted notifications runtime (FR-NOTE-13/14/15/18): watches sync changes, keeps the
// toast stack in the shell's toast region, sets the seen baseline, starts the DM's action cue
// (FR-NOTE-30). Toasts and timers are client
// memory only (per page, `ToastMemory`). Player: bottom-right. DM: top-centre below the top bar (#149): the DM's right
// column (`cbt.initiative`, protocol §24) reaches the bottom-right corner, and sticky damage-card
// toasts covered its lower rows; the map gap between the columns is free in the default layout.
// Wherever Initiative is, the DM stack keeps clear of it (FR-NOTE-32, `keep-out.ts`).
import type { NotificationRecord } from "@shared/notifications/schemas";
import { XIcon } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useStore } from "zustand";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { SyncContext, useSync } from "../../sync/store";
import { INITIATIVE_KIND } from "../combat-tracker/window";
import { renderedWindowRects, useContentHeights } from "../play-shell/free-area";
import { type Rect, TITLE_H } from "../play-shell/geometry";
import { useViewport } from "../play-shell/hooks";
import {
  useAvailableKinds,
  useOpenWindow,
  useRegistry,
  useShellState,
} from "../play-shell/ShellContext";
import { tokenScreenBoxes } from "../play-shell/token-boxes";
import { dmStackPlacement } from "./keep-out";
import {
  actionButton,
  classify,
  HISTORY_KIND,
  NOTIFICATION_TYPE,
  type SyncView,
  summaryText,
  viewerOf,
} from "./logic";
import type { NoteClient } from "./note-client";
import { NoteBody, useNoteActions } from "./parts";
import {
  advance,
  closeToast,
  nextExpiry,
  registerToastMemory,
  SUMMARY_KEY,
  setHidden,
  setHovered,
  syncToasts,
  type Toast,
  type ToastMemoryStore,
  type ToastState,
  visibleToasts,
} from "./toasts";
import { cueTriggers, startCues } from "./token-cue";
import { type NotificationViews, originOf } from "./views";

type Action = (s: ToastState, now: number) => ToastState;
const TOAST_SELECTOR = '[data-testid="note-toast"]';
const hiddenNow = () => typeof document !== "undefined" && document.visibilityState === "hidden";

function NoteToast({
  t,
  n,
  views,
  actions,
  onClose,
}: {
  t: Extract<Toast, { kind: "note" }>;
  n: NotificationRecord;
  views: NotificationViews;
  actions: ReturnType<typeof useNoteActions>;
  onClose: () => void;
}) {
  const you = useSync((s) => s.store.you);
  const live = useSync((s) => s.state === "live");
  const mode = you
    ? actionButton(n, { role: you.role, playerId: you.playerId }, live, views.get(n.kind))
    : "none";
  return (
    <div
      role="status"
      data-testid="note-toast"
      data-record-id={n.id}
      data-state={n.state}
      data-sticky={t.sticky}
      className="pointer-events-auto flex flex-col gap-2 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <NoteBody n={n} views={views} />
        </div>
        <button
          type="button"
          data-testid="note-toast-close"
          aria-label="Close"
          className="rounded-sm text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          <XIcon className="size-4" />
        </button>
      </div>
      {mode !== "none" && (
        <Button
          size="sm"
          className="self-end"
          data-testid="note-toast-action"
          disabled={mode === "disabled" || actions.busy.has(n.id)}
          onClick={(e) =>
            void actions.run(n, originOf("toast", e.currentTarget.closest(TOAST_SELECTOR)))
          }
        >
          {n.actionLabel}
        </Button>
      )}
    </div>
  );
}

/** FR-NOTE-32: the open, non-minimised `cbt.initiative` window's rendered rect (DM), else null. */
function useInitiativeRect(isDm: boolean): Rect | null {
  const registry = useRegistry();
  const windows = useShellState((s) => s.windows);
  const available = useAvailableKinds();
  const vp = useViewport();
  const measured = useContentHeights();
  return useMemo(() => {
    if (!isDm) return null;
    const win = windows.filter((w) => w.kind === INITIATIVE_KIND && w.state === "open");
    return renderedWindowRects(win, registry, available, vp, measured)[0] ?? null;
  }, [isDm, windows, registry, available, vp, measured]);
}

/** P3 retest: the title bars of the DM's open windows but Initiative (the stack never covers them). */
function useTitleBars(isDm: boolean): Rect[] {
  const registry = useRegistry();
  const windows = useShellState((s) => s.windows);
  const available = useAvailableKinds();
  const vp = useViewport();
  const measured = useContentHeights();
  return useMemo(() => {
    if (!isDm) return [];
    const win = windows.filter((w) => w.kind !== INITIATIVE_KIND && w.state === "open");
    return renderedWindowRects(win, registry, available, vp, measured).map((r) => ({
      ...r,
      h: TITLE_H,
    }));
  }, [isDm, windows, registry, available, vp, measured]);
}

interface KonvaLayerLike {
  on(evt: string, fn: () => void): void;
  off(evt: string): void;
}

/**
 * P3 E1: bumps 300 ms after the map canvas last redrew or the viewport last resized (a resize
 * refit, a pan, a zoom), so the stack re-reads the token boxes once the map has settled.
 */
function useMapSettled(on: boolean): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on || typeof window === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setN((x) => x + 1), 300);
    };
    const K = (
      window as unknown as {
        Konva?: { stages: { container(): HTMLElement; getLayers(): KonvaLayerLike[] }[] };
      }
    ).Konva;
    const layers = K?.stages.find((st) => st.container().isConnected)?.getLayers() ?? [];
    for (const l of layers) l.on("draw.noteStack", bump);
    window.addEventListener("resize", bump);
    return () => {
      clearTimeout(timer);
      for (const l of layers) l.off("draw.noteStack");
      window.removeEventListener("resize", bump);
    };
  }, [on]);
  return n;
}

/**
 * P3 glitch 2: the tokens the DM's stack keeps clear of: each toasted pending row's
 * `avoidTokens` (the summary toast: every pending row's), sorted, unique.
 */
function useAvoidTokens(
  isDm: boolean,
  toasts: readonly Toast[],
  rows: Record<string, NotificationRecord> | undefined,
  views: NotificationViews,
): string[] {
  const store = useSync((s) => s.store);
  return useMemo(() => {
    if (!isDm || !rows) return [];
    const summary = toasts.some((t) => t.kind === "summary");
    const ids = new Set(toasts.flatMap((t) => (t.kind === "note" ? [t.notificationId] : [])));
    const out = new Set<string>();
    for (const n of Object.values(rows)) {
      if (n.state !== "pending" || !(summary || ids.has(n.id))) continue;
      for (const t of views.get(n.kind)?.avoidTokens?.(n, store) ?? []) out.add(t);
    }
    return [...out].sort();
  }, [isDm, toasts, rows, views, store]);
}

/**
 * FR-NOTE-32: the stack's rendered height (DM), re-measured when it mounts (`shown` flips) and on
 * resize while mounted.
 */
function useStackHeight(ref: RefObject<HTMLElement | null>, on: boolean, shown: boolean): number {
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

export function ToastRuntime({
  views,
  note,
  memory,
}: {
  views: NotificationViews;
  note: NoteClient;
  memory: ToastMemoryStore;
}) {
  const sync = useContext(SyncContext);
  const openWindow = useOpenWindow();
  const state = useStore(memory, (m) => m.toasts);
  const dispatch = useCallback(
    (a: Action) => memory.setState((m) => ({ toasts: a(m.toasts, Date.now()) })),
    [memory],
  );
  const rows = useSync((s) => s.store.records[NOTIFICATION_TYPE]) as
    | Record<string, NotificationRecord>
    | undefined;
  const actions = useNoteActions(views);
  const isDm = useSync((s) => s.store.you?.role === "dm");

  // Sync changes, in order (zustand calls this synchronously for every applied frame).
  useEffect(() => {
    if (!sync) return;
    const onChange = (next: SyncView, prev: SyncView | null) => {
      const t = classify(prev, next);
      if (t === null) return;
      if (t === "connect") note.baseline(next.store);
      memory.setState((m) => syncToasts(m, prev, next, t, Date.now()));
      // FR-NOTE-30: the DM's 4 s action cue (live event frames only).
      startCues(cueTriggers(prev, next, t), (kind) => views.get(kind));
      note.markSeen(next.store);
    };
    // A remount keeps the stack: the pointer is gone and the tab may have changed visibility.
    dispatch((s, now) => setHidden(setHovered(s, false, now), hiddenNow(), now));
    const first = sync.getState();
    // Mounted after the first snapshot (loading screen first): treat it as the connect.
    if (first.state === "live" && viewerOf(first.store)) onChange(first, null);
    return sync.subscribe((next, prev) => onChange(next, prev));
  }, [sync, note, memory, dispatch, views]);

  // FR-NOTE-26: `hideToast(id)` reaches this page's stack.
  useEffect(() => registerToastMemory(memory), [memory]);

  // Info toast expiry.
  const wait = nextExpiry(state);
  useEffect(() => {
    if (wait === null) return;
    const h = setTimeout(() => dispatch(advance), Math.max(0, wait) + 10);
    return () => clearTimeout(h);
  }, [wait, dispatch]);

  // FR-NOTE-14: timers pause while the tab is hidden.
  useEffect(() => {
    const on = () => dispatch((s, now) => setHidden(s, hiddenNow(), now));
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, [dispatch]);

  // FR-NOTE-32: the DM's stack keeps clear of the rendered Initiative window.
  const stackRef = useRef<HTMLElement>(null);
  const initiative = useInitiativeRect(isDm);
  const vp = useViewport();
  const stackH = useStackHeight(stackRef, isDm, state.toasts.length > 0);
  // P3 glitch 2: and of the tokens its cards' likely targets are on (`avoidTokens`), measured
  // when the stack, Initiative or the viewport change (never on hover: the stack holds still).
  const avoidKey = useAvoidTokens(isDm, state.toasts, rows, views).join(",");
  const bars = useTitleBars(isDm);
  // P3 E1: token boxes re-read once the map settles (resize refit, pan, zoom), not while the
  // pointer is on the stack.
  const settled = useMapSettled(isDm && state.toasts.length > 0);
  const frozen = useRef(settled);
  if (!state.hovered) frozen.current = settled;
  const tick = frozen.current;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` re-reads the live token boxes
  const at = useMemo(
    () =>
      dmStackPlacement(
        vp,
        initiative,
        stackH,
        undefined,
        tokenScreenBoxes(avoidKey ? avoidKey.split(",") : []),
        bars,
      ),
    [vp, initiative, stackH, avoidKey, bars, tick],
  );

  const openHistory = () => openWindow(HISTORY_KIND);
  const { shown, more } = visibleToasts(state);
  if (state.toasts.length === 0) return null;
  return (
    <section
      ref={stackRef}
      aria-label="Notifications"
      data-testid="note-toasts"
      data-placement={isDm ? "top-center" : "bottom-right"}
      data-left={isDm ? at.left : undefined}
      data-top={isDm ? at.top : undefined}
      className={cn(
        "pointer-events-none fixed z-40 flex w-80 flex-col gap-2",
        !isDm && "right-4 bottom-4",
      )}
      style={isDm ? { left: at.left, top: at.top } : undefined}
      onMouseEnter={() => dispatch((s, now) => setHovered(s, true, now))}
      onMouseLeave={() => dispatch((s, now) => setHovered(s, false, now))}
    >
      {more > 0 && (
        <button
          type="button"
          data-testid="note-toast-more"
          className="pointer-events-auto self-end rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow"
          onClick={openHistory}
        >
          +{more} more
        </button>
      )}
      {shown.map((t) => {
        if (t.kind === "summary") {
          return (
            <div
              key={SUMMARY_KEY}
              role="status"
              data-testid="note-toast-pending-summary"
              data-count={t.count}
              className="pointer-events-auto flex items-center gap-2 rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
            >
              <span className="flex-1">{summaryText(t.count)}</span>
              <Button
                size="sm"
                data-testid="note-toast-open"
                onClick={() => {
                  openHistory();
                  dispatch((s, now) => closeToast(s, SUMMARY_KEY, now));
                }}
              >
                Open
              </Button>
              <button
                type="button"
                data-testid="note-toast-close"
                aria-label="Close"
                className="rounded-sm text-muted-foreground hover:text-foreground"
                onClick={() => dispatch((s, now) => closeToast(s, SUMMARY_KEY, now))}
              >
                <XIcon className="size-4" />
              </button>
            </div>
          );
        }
        const n = rows?.[t.notificationId];
        if (!n) return null;
        return (
          <NoteToast
            key={t.key}
            t={t}
            n={n}
            views={views}
            actions={actions}
            onClose={() => dispatch((s, now) => closeToast(s, t.key, now))}
          />
        );
      })}
    </section>
  );
}

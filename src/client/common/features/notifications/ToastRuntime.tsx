// Always-mounted notifications runtime (FR-NOTE-13/14/15/18): watches sync changes, keeps the
// toast stack in the shell's toast region, sets the seen baseline, starts the DM's action cue
// (FR-NOTE-30). Toasts and timers are client
// memory only (per page, `ToastMemory`). Player: bottom-right. DM: top-centre below the top bar (#149): the DM's right
// column (`cbt.initiative`, protocol §24) reaches the bottom-right corner, and sticky damage-card
// toasts covered its lower rows; the map gap between the columns is free in the default layout.
// Wherever Initiative is, the DM stack keeps clear of it (FR-NOTE-32, `keep-out.ts`), stays in
// its top-centre band (FR-NOTE-42) and off the active tool bar (FR-NOTE-43); it reports its
// rendered rect for the Fit (FR-SHELL-59). *(Sprint 8)* One stack per client (FR-NOTE-50): the
// summary, cards, alerts, info, then the callout, in that order from home (players: home is the
// bottom, so the column runs upwards); it re-places on every input change (FR-NOTE-51).
import type { NotificationRecord } from "@shared/notifications/schemas";
import { toastClassOf } from "@shared/notifications/toast-class";
import { XIcon } from "lucide-react";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { SyncContext, useSync } from "../../sync/store";
import { EDGE_GAP, LAUNCHER_CLEAR, TOP_BAR_H } from "../play-shell/geometry";
import { useViewport } from "../play-shell/hooks";
import { useOpenWindow } from "../play-shell/ShellContext";
import {
  DM_TOAST_TOP,
  NOTE_EDGE,
  PLAYER_TOAST_BOTTOM,
  reportShownStack,
} from "../play-shell/toast-region";
import { tokenScreenBoxes } from "../play-shell/token-boxes";
import { AlertToast, useAlertToasts } from "./alert-toasts";
import { useDialogRects } from "./dialog-rects";
import { dmStackSpot } from "./keep-out";
import {
  actionButton,
  classify,
  HISTORY_KIND,
  NOTIFICATION_TYPE,
  type SyncView,
  summaryText,
  viewerOf,
  waitingForPlayers,
} from "./logic";
import type { NoteClient } from "./note-client";
import { NoteBody, NoteStripe, useNoteActions, useNoteStripe } from "./parts";
import { useStackHeight } from "./stack-height";
import { useStackInputs } from "./stack-inputs";
import {
  advance,
  type Callout,
  type ClassOf,
  classOfToast,
  clearCallout,
  closeToast,
  MAX_VISIBLE,
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
  const stripe = useNoteStripe(n);
  return (
    <div
      role="status"
      data-testid="note-toast"
      data-record-id={n.id}
      data-state={n.state}
      data-sticky={t.sticky}
      data-class={classOfToast(t)}
      {...stripe.attrs}
      className="pointer-events-auto relative flex flex-col gap-2 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg"
    >
      <NoteStripe color={stripe.color} />
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

/** FR-NOTE-50: the one callout (`showCallout`), last in the stack; not a notification. */
function CalloutToast({ c, onClose }: { c: Callout; onClose: () => void }) {
  return (
    <div
      role="status"
      data-testid="note-callout"
      data-callout-id={c.id}
      data-class="callout"
      className="pointer-events-auto flex items-start gap-2 rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
    >
      <div className="min-w-0 flex-1">{c.content}</div>
      <button
        type="button"
        data-testid="note-callout-close"
        aria-label="Close"
        className="rounded-sm text-muted-foreground hover:text-foreground"
        onClick={onClose}
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}

/**
 * FR-NOTE-50 (sprint 8, DM ruling): the one stack's layer: above windows, dialogs (z-50) and
 * the alert flash (z-100), so an error stays readable while a dialog is open (as sonner's was);
 * below the overlay layer (play-shell `OVERLAY_LAYER_Z` 1000: a `blocksInput` overlay such as the
 * pause card sits above it) and the popups above every toast (`PRESENT_POPUP_Z`, the dice layer).
 */
export const TOAST_STACK_Z = 900;

/** Id of this stack's FR-SHELL-59 report. */
export const SHOWN_STACK_ID = "note.toasts";

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
  // FR-NOTE-52: a row's class from its kind's view (pending → card).
  const classOf = useCallback<ClassOf>(
    (n) => toastClassOf(views.get(n.kind)?.toastClass, n.state),
    [views],
  );

  // Sync changes, in order (zustand calls this synchronously for every applied frame).
  useEffect(() => {
    if (!sync) return;
    const onChange = (next: SyncView, prev: SyncView | null) => {
      const t = classify(prev, next);
      if (t === null) return;
      if (t === "connect") note.baseline(next.store);
      memory.setState((m) =>
        syncToasts(
          m,
          prev,
          next,
          t,
          Date.now(),
          (store) => waitingForPlayers(store, views),
          classOf,
          // FR-NOTE-60: kinds that re-toast their pending rows after a load / reconnect.
          (n) => views.get(n.kind)?.restoreToast === true,
        ),
      );
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
  }, [sync, note, memory, dispatch, views, classOf]);

  // FR-NOTE-50: the client's `toast()` calls as the alert class (this stack claims the region).
  const alerts = useAlertToasts(state.toasts, dispatch);

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

  // FR-NOTE-32: the DM's stack keeps clear of the rendered Initiative window. FR-NOTE-51: every
  // input is subscribed (windows, Initiative, hard keep-outs, first rows, height, viewport).
  const stackRef = useRef<HTMLElement>(null);
  const showing = state.toasts.length > 0 || !!state.callout;
  const { initiative, windows: windowRects, hard: bars, rows: firstRows } = useStackInputs(isDm);
  // Walkthrough T4: an open modal dialog keeps the DM stack off it like a hard keep-out.
  const dialogs = useDialogRects(isDm && showing);
  const hard = useMemo(() => (dialogs.length > 0 ? [...bars, ...dialogs] : bars), [bars, dialogs]);
  const vp = useViewport();
  const stackH = useStackHeight(stackRef, isDm, showing);
  // P3 glitch 2: and of the tokens its cards' likely targets are on (`avoidTokens`), measured
  // when the stack, Initiative or the viewport change (never on hover: the stack holds still).
  const avoidKey = useAvoidTokens(isDm, state.toasts, rows, views).join(",");
  // P3 E1: token boxes re-read once the map settles (resize refit, pan, zoom), not while the
  // pointer is on the stack (FR-NOTE-51: only while; every other input re-places at once).
  const settled = useMapSettled(isDm && showing);
  const frozen = useRef(settled);
  if (!state.hovered) frozen.current = settled;
  const tick = frozen.current;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` re-reads the live token boxes
  const at = useMemo(
    () =>
      dmStackSpot(
        vp,
        initiative,
        stackH,
        undefined,
        tokenScreenBoxes(avoidKey ? avoidKey.split(",") : []),
        windowRects,
        hard,
        firstRows,
      ),
    [vp, initiative, stackH, avoidKey, windowRects, hard, firstRows, tick],
  );

  // FR-SHELL-59: the DM's rendered stack rect for the Fit, null while nothing shows.
  useLayoutEffect(() => {
    const el = stackRef.current;
    if (!isDm || !el || stackH === 0) {
      reportShownStack(SHOWN_STACK_ID, null);
      return;
    }
    // Fixed at `at`; the width and measured height as rendered.
    const w = Math.round(el.getBoundingClientRect().width);
    reportShownStack(SHOWN_STACK_ID, { x: at.left, y: at.top, w, h: stackH });
  }, [isDm, at.left, at.top, stackH]);
  useEffect(() => () => reportShownStack(SHOWN_STACK_ID, null), []);

  // P3 E3: the stack always fits the viewport: while it is taller than the room (DM: below the
  // top row, above the launcher; player: above its corner, below the top bar), one more toast
  // folds into "+N more". The cap starts over when the toasts or the room change.
  // Walkthrough T4: with a dialog open, the DM's room is the larger band above or below it.
  const room = isDm
    ? dialogRoom(vp, dialogs, vp.h - LAUNCHER_CLEAR - DM_TOAST_TOP)
    : vp.h - PLAYER_TOAST_BOTTOM - TOP_BAR_H - EDGE_GAP;
  const [cap, setCap] = useState(MAX_VISIBLE);
  const count = state.toasts.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: start over on a new count or room
  useLayoutEffect(() => setCap(MAX_VISIBLE), [count, room]);
  // Walkthrough WF4: likewise while the DM stack can only sit on a window's body (its controls).
  const covers = isDm && at.covers > 0;
  useLayoutEffect(() => {
    if ((stackH > room || covers) && cap > 1) setCap((c) => Math.max(1, c - 1));
  }, [stackH, room, cap, covers]);

  const openHistory = () => openWindow(HISTORY_KIND);
  const { shown, more, callout } = visibleToasts(state, cap);
  if (!showing) return null;
  const stack = (
    <section
      ref={stackRef}
      aria-label="Notifications"
      data-testid="note-toasts"
      data-placement={isDm ? "top-center" : "bottom-right"}
      data-left={isDm ? at.left : undefined}
      data-top={isDm ? at.top : undefined}
      // FR-NOTE-50: DOM order = order from home; the players' home is the bottom.
      className={cn(
        "pointer-events-none fixed flex w-80 gap-2",
        isDm ? "flex-col" : "flex-col-reverse",
      )}
      // Player: bottom-right, above the launcher bar (never over its buttons).
      style={{
        zIndex: TOAST_STACK_Z,
        ...(isDm
          ? { left: at.left, top: at.top }
          : { right: NOTE_EDGE, bottom: PLAYER_TOAST_BOTTOM }),
      }}
      onMouseEnter={() => dispatch((s, now) => setHovered(s, true, now))}
      onMouseLeave={() => dispatch((s, now) => setHovered(s, false, now))}
    >
      {shown.map((t) => {
        if (t.kind === "summary") {
          return (
            <div
              key={SUMMARY_KEY}
              role="status"
              data-testid="note-toast-pending-summary"
              data-count={t.count}
              data-waiting={t.waiting ?? 0}
              className="pointer-events-auto flex items-center gap-2 rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
            >
              <span className="flex-1">{summaryText(t.count, t.waiting)}</span>
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
        if (t.kind === "alert") {
          const a = alerts.get(t.alertId);
          if (!a) return null;
          return (
            <AlertToast
              key={t.key}
              t={a}
              onClose={() => dispatch((s, now) => closeToast(s, t.key, now))}
            />
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
      {callout && (
        <CalloutToast
          c={callout}
          onClose={() => dispatch((s, now) => clearCallout(s, now, callout.id))}
        />
      )}
    </section>
  );
  // At the body (walkthrough T4): `TOAST_STACK_Z` holds against dialogs, not inside the shell's
  // stacking context. A static render (tests) has no body.
  return typeof document !== "undefined" && document.body
    ? createPortal(stack, document.body)
    : stack;
}

/**
 * Walkthrough T4: the DM stack's room with modal dialogs open: the larger band above their top
 * (below the home row) or below their bottom (above the launcher), never more than `full`.
 */
export function dialogRoom(
  vp: { w: number; h: number },
  dialogs: readonly { y: number; h: number }[],
  full: number,
): number {
  if (dialogs.length === 0) return full;
  const top = Math.min(...dialogs.map((d) => d.y));
  const bottom = Math.max(...dialogs.map((d) => d.y + d.h));
  const above = top - EDGE_GAP - DM_TOAST_TOP;
  const below = vp.h - LAUNCHER_CLEAR - (bottom + EDGE_GAP);
  return Math.min(full, Math.max(above, below, 0));
}

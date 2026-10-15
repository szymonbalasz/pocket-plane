// Always-mounted notifications runtime (FR-NOTE-13/14/15/18): watches sync changes, keeps the
// toast stack in the shell's toast region, sets the seen baseline. Toasts and timers are client
// memory only (per page, `ToastMemory`). Player: bottom-right. DM: top-centre below the top bar (#149): the DM's right
// column (`cbt.initiative`, protocol §24) reaches the bottom-right corner, and sticky damage-card
// toasts covered its lower rows; the map gap between the columns is free in the default layout.
import type { NotificationRecord } from "@shared/notifications/schemas";
import { XIcon } from "lucide-react";
import { useCallback, useContext, useEffect } from "react";
import { useStore } from "zustand";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { SyncContext, useSync } from "../../sync/store";
import { useOpenWindow } from "../play-shell/ShellContext";
import { DM_TOAST_TOP } from "../play-shell/toast-region";
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
      note.markSeen(next.store);
    };
    // A remount keeps the stack: the pointer is gone and the tab may have changed visibility.
    dispatch((s, now) => setHidden(setHovered(s, false, now), hiddenNow(), now));
    const first = sync.getState();
    // Mounted after the first snapshot (loading screen first): treat it as the connect.
    if (first.state === "live" && viewerOf(first.store)) onChange(first, null);
    return sync.subscribe((next, prev) => onChange(next, prev));
  }, [sync, note, memory, dispatch]);

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

  const openHistory = () => openWindow(HISTORY_KIND);
  const { shown, more } = visibleToasts(state);
  if (state.toasts.length === 0) return null;
  return (
    <section
      aria-label="Notifications"
      data-testid="note-toasts"
      data-placement={isDm ? "top-center" : "bottom-right"}
      className={cn(
        "pointer-events-none fixed z-40 flex w-80 flex-col gap-2",
        isDm ? "left-1/2 -translate-x-1/2" : "right-4 bottom-4",
      )}
      style={isDm ? { top: DM_TOAST_TOP } : undefined}
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

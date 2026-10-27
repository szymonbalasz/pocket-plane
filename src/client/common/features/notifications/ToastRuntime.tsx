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
// *(Sprint 9)* FR-NOTE-72: while this client's Notifications window is open (not minimised) the
// cards and the summary fold into it; they come back silently when it closes. FR-NOTE-73: each
// callout show is its own node (`data-callout-seq`). *(Sprint 10, H3)* FR-NOTE-75: the DM stack
// keeps off windows' drawn content, then their first rows (the content measured while it shows);
// FR-NOTE-76: an open modal dialog counts like Initiative and nothing under its overlay counts.
// FR-NOTE-77: it may slide beside a window off the PCs' tokens; over a body the cards fold into
// the summary. *(Sprint 11, F2)* BL-115: the stack settles: a layout change refolds once it held
// still, the stack holds its drawn spot while the fold steps, tokens are read as footprints.
// FR-NOTE-78 (BL-108): off windows' headings and first records first; off the damage-card popup.
// *(Kit parity K3)* FR-KIT-55–59: card rows (lead · text block · actions · close), the summary in
// the same row, "+N more" as a pill, the DM's turn card first in the stack.
import type { NotificationRecord } from "@shared/notifications/schemas";
import { toastClassOf } from "@shared/notifications/toast-class";
import { recordsOf } from "@shared/protocol/store";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { ListTodoIcon, XIcon } from "lucide-react";
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
import { pcBoxes } from "../play-shell/placement";
import { useOpenWindow } from "../play-shell/ShellContext";
import {
  DM_TOAST_TOP,
  NOTE_EDGE,
  PLAYER_TOAST_BOTTOM,
  reportShownStack,
} from "../play-shell/toast-region";
import { isPlacementPc, tokenScreenBoxes } from "../play-shell/token-boxes";
import { AlertToast, TurnCard, useAlertToasts } from "./alert-toasts";
import { useDialogRects, usePopupIds, usePopupRects } from "./dialog-rects";
import { dmStackSpot, MIN_SHIFT_LEFT, STACK_W } from "./keep-out";
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
import {
  CloseGem,
  NoteStripe,
  TOAST_CARD,
  ToastLead,
  ToastText,
  useCauserName,
  useMedallionName,
  useNoteActions,
  useNoteStripe,
} from "./parts";
import { useStackHeight } from "./stack-height";
import { useHistoryOpen, useStackInputs } from "./stack-inputs";
import {
  advance,
  type Callout,
  type ClassOf,
  classOfToast,
  clearCallout,
  closeToast,
  moreInSummary,
  nextExpiry,
  pruneToasts,
  REFOLD_QUIET_MS,
  refold,
  registerToastMemory,
  releaseHidden,
  SETTLE_HOLD_MS,
  SUMMARY_KEY,
  setHidden,
  setHovered,
  settleStack,
  syncToasts,
  type Toast,
  type ToastMemoryStore,
  type ToastState,
  UNSETTLED,
  unfold,
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
  const name = useCauserName(n);
  const lead = useMedallionName(n);
  // FR-KIT-55: medallion or icon · text block · actions · close; the stripe stays the left edge.
  return (
    <div
      role="status"
      data-testid="note-toast"
      data-slot="toast-card"
      data-record-id={n.id}
      data-state={n.state}
      data-sticky={t.sticky}
      data-class={classOfToast(t)}
      {...stripe.attrs}
      className={TOAST_CARD}
    >
      <NoteStripe color={stripe.color} />
      <ToastLead name={lead} color={stripe.color} icon={views.get(n.kind)?.icon} />
      {/* FR-KIT-57: the action sits right of the text; it wraps below only when too narrow. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
        <ToastText n={n} views={views} name={name} />
        {mode !== "none" && (
          <div data-slot="toast-actions" className="ml-auto flex shrink-0 gap-1.5">
            <Button
              size="sm"
              className="h-7 px-2.5"
              data-testid="note-toast-action"
              disabled={mode === "disabled" || actions.busy.has(n.id)}
              onClick={(e) =>
                void actions.run(n, originOf("toast", e.currentTarget.closest(TOAST_SELECTOR)))
              }
            >
              {n.actionLabel}
            </Button>
          </div>
        )}
      </div>
      <CloseGem testId="note-toast-close" onClose={onClose} />
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

/**
 * FR-NOTE-77: the player characters' token ids (a character with an owner, as play-shell's PC
 * rule counts them), sorted; a slide beside a window never covers one. DM only.
 */
function usePcTokens(isDm: boolean): string[] {
  const store = useSync((s) => s.store);
  return useMemo(() => {
    if (!isDm) return [];
    type Tok = { id: string; ownerPlayerId: string | null; characterId: string | null };
    return recordsOf<Tok>(store, TOKEN_TYPE)
      .filter((t) => isPlacementPc(t))
      .map((t) => t.id)
      .sort();
  }, [isDm, store]);
}

/**
 * FR-NOTE-50: the one callout (`showCallout`), last in the stack; not a notification. FR-NOTE-73:
 * the caller keys it by `seq`, so each show is a new node (re-announced, its own 4 s).
 */
export function CalloutToast({ c, onClose }: { c: Callout; onClose: () => void }) {
  return (
    <div
      role="status"
      data-testid="note-callout"
      data-callout-id={c.id}
      data-callout-seq={c.seq ?? 0}
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

  // FR-NOTE-72: this client's Notifications window open (not minimised) folds the cards and the
  // summary into it; closing or minimising it brings them back silently (no cue starts here).
  const folded = useHistoryOpen();
  const wasFolded = useRef(folded);
  useEffect(() => {
    if (wasFolded.current && !folded && sync) {
      const store = sync.getState().store;
      dispatch((s, now) => unfold(s, store, now, (st) => waitingForPlayers(st, views)));
    }
    wasFolded.current = folded;
  }, [folded, sync, dispatch, views]);

  // BL-120 (X1 walkthrough 3): a row hidden by its popup (FR-NOTE-26) leaves the summary's count
  // before the paint. `hideToast` has no store: a row the summary counted (no toast of its own,
  // e.g. a card from the snapshot) stayed in it while its popup showed it too.
  const hiddenKey = state.hiddenIds?.join(",") ?? "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: recount when a row is hidden
  useLayoutEffect(() => {
    if (!sync || !hiddenKey) return;
    const store = sync.getState().store;
    dispatch((s, now) => pruneToasts(s, store, now, (st) => waitingForPlayers(st, views)));
  }, [hiddenKey]);

  // BL-120: a hidden card whose popup closed while still pending (Later, another card opened)
  // counts in the summary (FR-NOTE-26: no toast of its own again).
  const popupIds = usePopupIds(isDm);
  const heldIds = useRef("");
  useEffect(() => {
    const was = heldIds.current;
    heldIds.current = popupIds;
    const open = new Set(popupIds ? popupIds.split(",") : []);
    const gone = (was ? was.split(",") : []).filter((id) => !open.has(id));
    if (gone.length === 0 || !sync) return;
    const store = sync.getState().store;
    dispatch((s, now) => releaseHidden(s, gone, store, now, (st) => waitingForPlayers(st, views)));
  }, [popupIds, sync, dispatch, views]);

  // FR-NOTE-32: the DM's stack keeps clear of the rendered Initiative window. FR-NOTE-51: every
  // input is subscribed (windows, Initiative, hard keep-outs, first rows, height, viewport).
  const stackRef = useRef<HTMLElement>(null);
  const showing =
    !!state.callout ||
    !!state.turn ||
    state.toasts.some((t) => !folded || (t.kind !== "summary" && classOfToast(t) !== "card"));
  const { initiative, windows: windowRects, hard, rows: firstRows } = useStackInputs(isDm, showing);
  // Walkthrough T4, FR-NOTE-76: an open modal dialog keeps the DM stack off it like Initiative.
  const dialogs = useDialogRects(isDm && showing);
  // FR-NOTE-78 (BL-108): and off an open non-modal popup (the damage-card popup) like Initiative.
  const popups = usePopupRects(isDm && showing);
  const vp = useViewport();
  const stackH = useStackHeight(stackRef, isDm, showing);
  // P3 glitch 2: and of the tokens its cards' likely targets are on (`avoidTokens`), measured
  // when the stack, Initiative or the viewport change (never on hover: the stack holds still).
  // BL-115: as footprints (play-shell's PC rule), not drawn boxes: a pulsing cue ring, a turn
  // ring or a label grows a token's drawn box frame by frame, and each re-read moved the stack.
  const avoidKey = useAvoidTokens(isDm, state.toasts, rows, views).join(",");
  const pcKey = usePcTokens(isDm).join(",");
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
        tokenScreenBoxes(avoidKey ? avoidKey.split(",") : [], sync?.getState().store),
        windowRects,
        hard,
        firstRows,
        dialogs,
        pcBoxes(
          tokenScreenBoxes(pcKey ? pcKey.split(",") : [], sync?.getState().store).map((b) => ({
            ...b,
            pc: true,
          })),
        ),
        popups,
      ),
    [
      vp,
      initiative,
      stackH,
      avoidKey,
      pcKey,
      windowRects,
      hard,
      firstRows,
      dialogs,
      popups,
      tick,
      sync,
    ],
  );

  // P3 E3: the stack always fits the viewport: while it is taller than the room (DM: below the
  // top row, above the launcher; player: above its corner, below the top bar), one more toast
  // folds into "+N more". The cap starts over when the toasts or the room change.
  // Walkthrough T4: with a dialog open, the DM's room is the larger band above or below it.
  const room = isDm
    ? dialogRoom(vp, dialogs, vp.h - LAUNCHER_CLEAR - DM_TOAST_TOP)
    : vp.h - PLAYER_TOAST_BOTTOM - TOP_BAR_H - EDGE_GAP;
  // BL-115: the fold and the spot drawn (`settleStack`): while the fold steps the stack holds
  // where it was drawn, then moves once.
  const [settle, setSettle] = useState(UNSETTLED);
  const cap = settle.fold.cap;
  const count = state.toasts.length;
  // FR-NOTE-77 (walkthrough H3 re-test): the fold starts over when what places the stack changes
  // (windows moved, a tool bar or dialog shown), not only on a new count or room. BL-115: once
  // that layout held still for `REFOLD_QUIET_MS` (a window that grows or a dialog that animates
  // restarted the fold every frame, and the stack hopped while it re-folded).
  const placeKey = useMemo(
    () =>
      JSON.stringify([
        initiative,
        windowRects.map(({ x, y, w, h }) => [x, y, w, h]),
        hard,
        dialogs,
        popups.map(({ x, y, w, h }) => [x, y, w, h]),
      ]),
    [initiative, windowRects, hard, dialogs, popups],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: start over on a new count or room
  useLayoutEffect(() => setSettle(refold), [count, room]);
  const placedKey = useRef(placeKey);
  useEffect(() => {
    if (placedKey.current === placeKey) return;
    const t = setTimeout(() => {
      placedKey.current = placeKey;
      setSettle(refold);
    }, REFOLD_QUIET_MS);
    return () => clearTimeout(t);
  }, [placeKey]);
  // Walkthrough WF4: likewise while the DM stack can only sit on a window's body (its controls).
  // FR-NOTE-77: down to no card at all while the summary shows (its Open stays one click away);
  // one step per measured height (`foldCap`), so a card that fits the chosen spot stays.
  const covers = isDm && at.covers > 0;
  const minCap = isDm && !folded && state.toasts.some((t) => t.kind === "summary") ? 0 : 1;
  const { shown, more, inSummary, callout } = visibleToasts(state, cap, folded);
  const foldable = shown.filter((t) => t.kind !== "summary" && classOfToast(t) !== "alert").length;
  // BL-115: a hold that never sees a new height ends after `SETTLE_HOLD_MS`.
  const [holdOver, setHoldOver] = useState(0);
  useEffect(() => {
    if (!settle.hold) return;
    const t = setTimeout(() => setHoldOver((n) => n + 1), SETTLE_HOLD_MS);
    return () => clearTimeout(t);
  }, [settle.hold]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `holdOver` re-steps an expired hold
  useLayoutEffect(() => {
    const need = stackH > room || covers;
    const spot = { left: at.left, top: at.top };
    const now = performance.now();
    setSettle((s) => settleStack(s, { need, min: minCap, stackH, shown: foldable, spot, now }));
  }, [stackH, room, covers, minCap, foldable, at.left, at.top, holdOver]);
  // FR-NOTE-70: the drawn spot (`data-left` / `data-top`, the style and the FR-SHELL-59 report).
  const pos = settle.hold && settle.drawn ? settle.drawn : { left: at.left, top: at.top };
  // BL-118: the fold is done: no hold, and no step due on this height (`foldCap`).
  const resting =
    !settle.hold && !((stackH > room || covers) && cap > minCap && settle.fold.foldedAt !== stackH);

  // FR-SHELL-59: the DM's rendered stack rect for the Fit, null while nothing shows. BL-118: only
  // the resting stack (the roll popups keep clear of it, FR-DICEX-55), never a fold step's.
  useLayoutEffect(() => {
    const el = stackRef.current;
    if (!isDm || !el || stackH === 0) {
      reportShownStack(SHOWN_STACK_ID, null);
      return;
    }
    if (!resting) return;
    // Fixed at `pos`; the width and measured height as rendered.
    const w = Math.round(el.getBoundingClientRect().width);
    reportShownStack(SHOWN_STACK_ID, { x: pos.left, y: pos.top, w, h: stackH });
  }, [isDm, pos.left, pos.top, stackH, resting]);
  useEffect(() => () => reportShownStack(SHOWN_STACK_ID, null), []);

  const openHistory = () => openWindow(HISTORY_KIND);
  // FR-NOTE-78 (walkthrough F2 1b, 2a): folded to the summary alone, "+N more" sits in its row.
  const inRow = moreInSummary(shown, more);
  // FR-KIT-58: "+N more" is a centred pill (in the summary's row when folded to it).
  const moreButton = (
    <button
      type="button"
      data-testid="note-toast-more"
      data-in-summary={inRow}
      className={cn(
        "pointer-events-auto rounded-full border bg-popover px-3 py-0.5 text-xs text-muted-foreground",
        inRow ? "shrink-0" : "self-center shadow",
      )}
      onClick={openHistory}
    >
      +{more} more
    </button>
  );
  if (!showing) return null;
  const stack = (
    <section
      ref={stackRef}
      aria-label="Notifications"
      data-testid="note-toasts"
      data-placement={isDm ? "top-center" : "bottom-right"}
      data-left={isDm ? pos.left : undefined}
      data-top={isDm ? pos.top : undefined}
      // BL-118: the fold rests (the FR-SHELL-59 report carries only a resting stack).
      data-settled={isDm ? resting : undefined}
      // FR-NOTE-50: DOM order = order from home; the players' home is the bottom.
      className={cn(
        "pointer-events-none fixed flex w-80 gap-2",
        isDm ? "flex-col" : "flex-col-reverse",
      )}
      // Player: bottom-right, above the launcher bar (never over its buttons).
      style={{
        zIndex: TOAST_STACK_Z,
        ...(isDm
          ? { left: pos.left, top: pos.top }
          : { right: NOTE_EDGE, bottom: PLAYER_TOAST_BOTTOM }),
      }}
      onMouseEnter={() => dispatch((s, now) => setHovered(s, true, now))}
      onMouseLeave={() => dispatch((s, now) => setHovered(s, false, now))}
    >
      {/* FR-KIT-59 (OQ-KIT-03 A): the DM's turn card heads the stack (home first). */}
      {state.turn && <TurnCard key={`turn:${state.turn.seq}`} text={state.turn.text} />}
      {shown.map((t) => {
        if (t.kind === "summary") {
          return (
            <div
              key={SUMMARY_KEY}
              role="status"
              data-testid="note-toast-pending-summary"
              data-slot="toast-card"
              // BL-120: with the cards folded into it (`inSummary`).
              data-count={t.count + inSummary}
              data-waiting={t.waiting ?? 0}
              // FR-KIT-60: the summary keeps its 58-px row (FR-NOTE-78's folded stack height; the
              // roll popups and the Fit read the stack rect).
              className={cn(TOAST_CARD, "py-3")}
            >
              {/* FR-KIT-58: the card row: icon · text · actions · close. */}
              <ToastLead icon={ListTodoIcon} />
              <span data-slot="toast-text" className="min-w-0 flex-1">
                {summaryText(t.count + inSummary, t.waiting)}
              </span>
              <span data-slot="toast-actions" className="flex shrink-0 items-center gap-1.5">
                {inRow && moreButton}
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
              </span>
              <CloseGem
                testId="note-toast-close"
                onClose={() => dispatch((s, now) => closeToast(s, SUMMARY_KEY, now))}
              />
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
      {more > 0 && !inRow && moreButton}
      {callout && (
        <CalloutToast
          key={callout.seq ?? 0}
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
 * FR-NOTE-76: `full` when the stack fits left of them (the shift, `dmStackLefts`).
 */
export function dialogRoom(
  vp: { w: number; h: number },
  dialogs: readonly { x: number; y: number; h: number }[],
  full: number,
): number {
  if (dialogs.length === 0) return full;
  const shift = Math.round(Math.min(...dialogs.map((d) => d.x)) - EDGE_GAP - STACK_W);
  if (shift >= MIN_SHIFT_LEFT && shift < Math.round((vp.w - STACK_W) / 2)) return full;
  const top = Math.min(...dialogs.map((d) => d.y));
  const bottom = Math.max(...dialogs.map((d) => d.y + d.h));
  const above = top - EDGE_GAP - DM_TOAST_TOP;
  const below = vp.h - LAUNCHER_CLEAR - (bottom + EDGE_GAP);
  return Math.min(full, Math.max(above, below, 0));
}

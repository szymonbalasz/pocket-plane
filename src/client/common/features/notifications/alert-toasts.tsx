// FR-NOTE-50 (sprint 8, WF4): the client's `toast()` calls (alert Toasts FR-SHELL-22, errors,
// confirmations) shown as the one stack's **alert** class. The runtime claims the toast region
// (sonner's Toaster steps aside, `claimToastStack`) and mirrors sonner's store (`useSonner`, which
// replays what is already showing): a new toast joins with its own duration, else 6 s; the
// stack's timer (paused on hover) ends it and dismisses it in sonner's store; a toast dismissed
// elsewhere leaves. A re-fired id is a new toast. Kit parity K3 (FR-KIT-55, -57, -59): the card
// row (type icon · text · action · close), and the player's turn alert as the turn card.

import { CircleAlertIcon, CircleCheckIcon, InfoIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { type ToastT, toast, useSonner } from "sonner";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { claimToastStack } from "../play-shell/ShellToaster";
import { CloseGem, TOAST_CARD, ToastLead } from "./parts";
import { syncAlerts, type Toast, type ToastState } from "./toasts";

type Dispatch = (a: (s: ToastState, now: number) => ToastState) => void;

const alertIds = (toasts: readonly Toast[]) =>
  new Set(toasts.flatMap((t) => (t.kind === "alert" ? [t.alertId] : [])));

/**
 * Keeps the stack's alert toasts in line with sonner's store while mounted; returns the showing
 * `toast()`s by id, for rendering.
 */
export function useAlertToasts(
  toasts: readonly Toast[],
  dispatch: Dispatch,
): ReadonlyMap<string | number, ToastT> {
  useEffect(() => claimToastStack(), []);
  const { toasts: list } = useSonner();
  // Toasts this stack ended (timer, close): ignored until sonner drops them or re-fires the id
  // (a new object).
  const gone = useRef(new WeakSet<ToastT>());
  const live = useMemo(
    () => list.filter((t) => t.toasterId === undefined && !t.delete && !gone.current.has(t)),
    [list],
  );
  const byId = useMemo(() => new Map(live.map((t) => [t.id, t])), [live]);
  useEffect(() => {
    dispatch((s, now) =>
      syncAlerts(
        s,
        live.map((t) => ({ id: t.id, ms: t.duration })),
        now,
      ),
    );
  }, [live, dispatch]);
  // An alert the stack dropped (expired, closed, campaign switch) is dismissed in sonner's store.
  const shown = useRef(new Set<string | number>());
  useEffect(() => {
    const now = alertIds(toasts);
    for (const id of shown.current) {
      if (now.has(id)) continue;
      const t = byId.get(id);
      if (!t) continue;
      gone.current.add(t);
      toast.dismiss(id);
    }
    shown.current = now;
  }, [toasts, byId]);
  return byId;
}

const textOf = (v: ToastT["title"]) => (typeof v === "function" ? v() : v);

/**
 * FR-KIT-59: the turn alert's Toast (FR-SHELL-22, `alert:` + the turn alert's id `cbt.turn`,
 * FR-CBT-41) is drawn as the turn card.
 */
export const TURN_ALERT_TOAST_ID = "alert:cbt.turn";

/**
 * FR-KIT-59: the turn card: centred text between two gem marks, no close (its toast times out).
 * Simple Dark draws the marks as `primary` diamonds; a theme styles `data-slot="turn-card"`.
 */
export function TurnCard({ text }: { text: ReactNode }) {
  return (
    <div
      role="status"
      data-testid="cbt-turn-card"
      data-slot="turn-card"
      className="pointer-events-auto flex items-center justify-center gap-2.5 rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-lg"
    >
      <span
        aria-hidden
        data-slot="turn-card-gem"
        className="size-2 shrink-0 rotate-45 bg-primary"
      />
      <span className="min-w-0 truncate text-base font-semibold">{text}</span>
      <span
        aria-hidden
        data-slot="turn-card-gem"
        className="size-2 shrink-0 rotate-45 bg-primary"
      />
    </div>
  );
}

const TYPE_ICON = { error: CircleAlertIcon, success: CircleCheckIcon } as const;

/**
 * One alert toast: the toast surface (FR-SHELL-01, #159), its title, description, action.
 * FR-KIT-55: the card row with the type's icon as its lead; the turn alert → the turn card inside
 * the toast's own (box-less) element, so `ui-alert-toast` keeps its meaning.
 */
export function AlertToast({ t, onClose }: { t: ToastT; onClose: () => void }) {
  const action = t.action && typeof t.action === "object" && "label" in t.action ? t.action : null;
  if (t.id === TURN_ALERT_TOAST_ID) {
    return (
      <div
        data-testid={t.testId ?? "ui-toast"}
        data-class="alert"
        data-type={t.type ?? "default"}
        className="contents"
      >
        <TurnCard text={textOf(t.title)} />
      </div>
    );
  }
  const icon = t.type === "error" || t.type === "success" ? TYPE_ICON[t.type] : InfoIcon;
  return (
    <div
      role={t.type === "error" ? "alert" : "status"}
      data-testid={t.testId ?? "ui-toast"}
      data-slot="toast-card"
      data-class="alert"
      data-type={t.type ?? "default"}
      className={TOAST_CARD}
    >
      <ToastLead icon={icon} />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
        <div
          data-slot="toast-text"
          className={cn(
            "min-w-0 flex-[1_1_9rem] break-words",
            t.type === "error" && "text-destructive",
          )}
        >
          {textOf(t.title)}
          {t.description ? (
            <div className="text-xs text-muted-foreground">{textOf(t.description)}</div>
          ) : null}
        </div>
        {action && (
          <div data-slot="toast-actions" className="ml-auto flex shrink-0 gap-1.5">
            <Button
              size="sm"
              className="h-7 px-2.5"
              data-testid="ui-toast-action"
              onClick={(e) => {
                action.onClick(e);
                onClose();
              }}
            >
              {action.label}
            </Button>
          </div>
        )}
      </div>
      <CloseGem testId="ui-toast-close" onClose={onClose} />
    </div>
  );
}

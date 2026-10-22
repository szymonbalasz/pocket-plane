// FR-NOTE-50 (sprint 8, WF4): the client's `toast()` calls (alert Toasts FR-SHELL-22, errors,
// confirmations) shown as the one stack's **alert** class. The runtime claims the toast region
// (sonner's Toaster steps aside, `claimToastStack`) and mirrors sonner's store (`useSonner`, which
// replays what is already showing): a new toast joins with its own duration, else 6 s; the
// stack's timer (paused on hover) ends it and dismisses it in sonner's store; a toast dismissed
// elsewhere leaves. A re-fired id is a new toast.

import { XIcon } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { type ToastT, toast, useSonner } from "sonner";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { claimToastStack } from "../play-shell/ShellToaster";
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

/** One alert toast: the toast surface (FR-SHELL-01, #159), its title, description, action. */
export function AlertToast({ t, onClose }: { t: ToastT; onClose: () => void }) {
  const action = t.action && typeof t.action === "object" && "label" in t.action ? t.action : null;
  return (
    <div
      role={t.type === "error" ? "alert" : "status"}
      data-testid={t.testId ?? "ui-toast"}
      data-class="alert"
      data-type={t.type ?? "default"}
      className="pointer-events-auto flex items-start gap-2 rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
    >
      <div className={cn("min-w-0 flex-1 break-words", t.type === "error" && "text-destructive")}>
        {textOf(t.title)}
        {t.description ? (
          <div className="text-xs text-muted-foreground">{textOf(t.description)}</div>
        ) : null}
      </div>
      {action && (
        <Button
          size="sm"
          className="h-6 px-2 text-xs"
          data-testid="ui-toast-action"
          onClick={(e) => {
            action.onClick(e);
            onClose();
          }}
        >
          {action.label}
        </Button>
      )}
      <button
        type="button"
        data-testid="ui-toast-close"
        aria-label="Close"
        className="rounded-sm text-muted-foreground hover:text-foreground"
        onClick={onClose}
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}

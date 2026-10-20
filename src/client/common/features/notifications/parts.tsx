// Shared pieces of rows and toasts: body (icon + text or the kind's renderer), action runner,
// the causer's colour stripe (FR-NOTE-39, -41).
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { BellIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useRecords, useSync } from "../../sync/store";
import { colorHex } from "../campaign-management/colors";
import { useColorKeyOf } from "../dice-roll-log/name-color";
import { useOpenWindow } from "../play-shell/ShellContext";
import { byAttr, causerOf, rejectMessage } from "./logic";
import { hideToast } from "./toasts";
import type {
  NotificationActionContext,
  NotificationActionOrigin,
  NotificationViews,
} from "./views";

/** Icon + text (rendered as text, never HTML: FR-NOTE-21) or the kind's renderer (FR-NOTE-19). */
export function NoteBody({ n, views }: { n: NotificationRecord; views: NotificationViews }) {
  const view = views.get(n.kind);
  const Icon = view?.icon ?? BellIcon;
  const Render = view?.render;
  return (
    <div className="flex min-w-0 items-start gap-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 break-words text-sm" data-testid="note-text">
        {Render ? <Render notification={n} /> : n.text}
      </div>
    </div>
  );
}

/**
 * FR-NOTE-39, -41 (OQ-NOTE-22, -24 A): the causer's palette key for a toast / row (null: no
 * stamp, an old row, or no `player` record → no stripe) and its `data-by` / `data-color`.
 * Re-renders on a colour change (restripe, OQ-CAMP-21).
 */
export function useNoteStripe(n: NotificationRecord): {
  color: string | null;
  attrs: { "data-by"?: string; "data-color"?: string };
} {
  const keyOf = useColorKeyOf();
  const by = causerOf(n);
  const color = by ? keyOf(by) : null;
  return { color, attrs: { "data-by": byAttr(n), "data-color": color ?? undefined } };
}

/**
 * The 3 px left stripe, inside the box's border (the parent is `relative`; a pending row's accent
 * border stays). Decoration only: the text names the person where it matters (OQ-CAMP-25).
 */
export function NoteStripe({ color }: { color: string | null }) {
  if (!color) return null;
  return (
    <span
      aria-hidden
      data-testid="note-stripe"
      className="pointer-events-none absolute inset-y-0 left-0 w-[3px] rounded-l-[inherit]"
      style={{ backgroundColor: colorHex(color) }}
    />
  );
}

/** Player names by id, for "Resolved by ‹name›" and audience tags. */
export function usePlayerNames(): (id: string | null) => string {
  const players = useRecords<PlayerRecord>("player");
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p.name])), [players]);
  return useCallback((id) => (id ? (byId.get(id) ?? "A player") : "A player"), [byId]);
}

/**
 * Runs a notification's action (FR-NOTE-16): the kind's `onAction`, else `note.resolve`, with the
 * clicked toast's / row's `origin` and `closeToast()` (FR-NOTE-26).
 * One click in flight per notification; a reject toasts (FR-NOTE-20), the row keeps the
 * server's state.
 */
export function useNoteActions(views: NotificationViews) {
  const connection = useSync((s) => s.connection);
  const openWindow = useOpenWindow();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const track = useCallback((id: string, p: Promise<unknown>) => {
    setBusy((b) => new Set(b).add(id));
    return p
      .catch((err) => {
        toast.error(rejectMessage(err));
      })
      .finally(() =>
        setBusy((b) => {
          const next = new Set(b);
          next.delete(id);
          return next;
        }),
      );
  }, []);
  const run = useCallback(
    (n: NotificationRecord, origin: NotificationActionOrigin) => {
      if (busy.has(n.id)) return Promise.resolve();
      const ctx: NotificationActionContext = {
        send: (name, payload) => connection.sendIntent(name, payload),
        openWindow,
        origin,
        closeToast: () => hideToast(n.id),
      };
      const view = views.get(n.kind);
      let p: Promise<unknown>;
      try {
        p = Promise.resolve(
          view?.onAction
            ? view.onAction(n, ctx)
            : connection.sendIntent("note.resolve", { id: n.id }),
        );
      } catch (err) {
        p = Promise.reject(err);
      }
      return track(n.id, p);
    },
    [busy, connection, openWindow, views, track],
  );
  const dismiss = useCallback(
    (n: NotificationRecord) => {
      if (busy.has(n.id)) return Promise.resolve();
      return track(n.id, connection.sendIntent("note.dismiss", { id: n.id }));
    },
    [busy, connection, track],
  );
  return { run, dismiss, busy };
}

/** Local hh:mm; full date in the title. */
export function timeOf(iso: string): { short: string; full: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { short: "", full: "" };
  return {
    short: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    full: d.toLocaleString(),
  };
}

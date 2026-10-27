// Shared pieces of rows and toasts: body (icon + text or the kind's renderer), action runner,
// the causer's colour stripe (FR-NOTE-39, -41). Kit parity K3 (FR-KIT-55, -56): the toast card's
// lead (the causing player's Medallion, else the kind's icon) and its two-line text block.
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { BellIcon, XIcon } from "lucide-react";
import { type ComponentType, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { MEDALLION_PX, Medallion } from "../../components/kit/medallion";
import { useRecords, useSync } from "../../sync/store";
import { colorHex } from "../campaign-management/colors";
import { useColorKeyOf } from "../dice-roll-log/name-color";
import { useOpenWindow } from "../play-shell/ShellContext";
import { byAttr, causerOf, leadName, rejectMessage, relativeTime } from "./logic";
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
 * FR-KIT-55: the toast card's row (`data-slot="toast-card"`): lead · text block · actions · close,
 * centred on one line; Simple Dark's popover surface, a theme frames the slot.
 */
export const TOAST_CARD =
  "pointer-events-auto relative flex items-center gap-2.5 rounded-lg border bg-popover py-2 pr-2.5 pl-3 text-sm text-popover-foreground shadow-lg";

/** FR-KIT-57: a toast's close, the gem in a theme (styled by its test ID). */
export function CloseGem({ testId, onClose }: { testId: string; onClose: () => void }) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label="Close"
      className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
      onClick={onClose}
    >
      <XIcon className="size-4" />
    </button>
  );
}

/**
 * FR-KIT-55: a toast card's lead, the size of a `md` Medallion (28 px): the causing player's
 * initial on their colour, else the kind's icon (`icon`, default the bell). Decorative.
 */
export function ToastLead({
  name,
  color,
  icon: Icon = BellIcon,
}: {
  /** The causing player's name; null → the icon. */
  name?: string | null;
  /** Their palette key (`useNoteStripe`); null → neutral. */
  color?: string | null;
  icon?: ComponentType<{ className?: string }> | undefined;
}) {
  if (name) return <Medallion name={name} colour={color ? colorHex(color) : null} size="md" />;
  return (
    <span
      aria-hidden
      data-testid="note-toast-icon"
      className="inline-flex shrink-0 items-center justify-center text-muted-foreground"
      style={{ width: MEDALLION_PX.md, height: MEDALLION_PX.md }}
    >
      <Icon className="size-4" />
    </span>
  );
}

/** FR-KIT-55: the name of the player who caused a row, when it is a player the client holds. */
export function useCauserName(n: NotificationRecord): string | null {
  const players = useRecords<PlayerRecord>("player");
  if (n.byRole !== "player" || !n.byPlayerId) return null;
  return players.find((p) => p.id === n.byPlayerId)?.name ?? null;
}

/**
 * FR-KIT-56: the card's text block: line 1 the text (`note-text`; the causing player's name in
 * bold when it starts a plain text; a kind's renderer as it is), line 2 the relative time.
 */
export function ToastText({
  n,
  views,
  name,
}: {
  n: NotificationRecord;
  views: NotificationViews;
  name: string | null;
}) {
  const Render = views.get(n.kind)?.render;
  const { lead, rest } = leadName(n.text, name);
  return (
    <div data-slot="toast-text" className="min-w-0 flex-[1_1_9rem] break-words text-sm">
      <div data-testid="note-text">
        {Render ? (
          <Render notification={n} />
        ) : lead ? (
          <>
            <b className="font-medium">{lead}</b>
            {rest}
          </>
        ) : (
          n.text
        )}
      </div>
      <NoteTime iso={n.createdAt} />
    </div>
  );
}

/** FR-KIT-56: "just now", "2 min ago", … (`note-time`), re-read every 30 s while shown. */
export function NoteTime({ iso }: { iso: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(h);
  }, []);
  return (
    <time data-testid="note-time" dateTime={iso} className="block text-xs text-muted-foreground">
      {relativeTime(iso, now)}
    </time>
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

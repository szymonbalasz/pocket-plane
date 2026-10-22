// `note.history` body (FR-NOTE-17): Pending, then History, newest first; DM audience tags and
// Dismiss; test-mode send form (FR-NOTE-22). Marks notifications seen while open (FR-NOTE-18).
// *(Sprint 8, WF4)* Compact rows (FR-SHELL-100: pending + 3 rows whole at the useful 360 × 412):
// the row's time, badges and buttons share one line with small buttons; the test form comes last.
import type { NotificationRecord } from "@shared/notifications/schemas";
import { useContext, useEffect, useLayoutEffect } from "react";
import { Button } from "../../components/ui/button";
import { Tooltip } from "../../components/ui/overlays";
import { Badge, Skeleton } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { SyncContext, useSync } from "../../sync/store";
import { colorHex } from "../campaign-management/colors";
import { useColorKeyOf } from "../dice-roll-log/name-color";
import { useWindowShown } from "../play-shell/ShellWindow";
import { isTestMode } from "../play-shell/test-windows";
import {
  actionButton,
  audienceLabel,
  closerOf,
  dismissButton,
  historySections,
  stateLabel,
  viewerOf,
} from "./logic";
import type { NoteClient } from "./note-client";
import {
  NoteBody,
  NoteStripe,
  timeOf,
  useNoteActions,
  useNoteStripe,
  usePlayerNames,
} from "./parts";
import { TestSendForm } from "./TestSendForm";
import { type NotificationViews, originOf } from "./views";

const ROW_SELECTOR = '[data-testid="note-history-row"]';
/** Compact row buttons (sprint 8, FR-SHELL-100): on the badges' line. */
const ROW_BUTTON = "h-6 px-2 text-xs";

/**
 * FR-NOTE-17 state badge; FR-NOTE-40 (OQ-CAMP-27 A): "Resolved by ‹name›" draws the name in the
 * closer's colour, on an outline badge so it sits on the window surface (every key ≥ 4.5 : 1
 * there, CAMP §7; the secondary fill drops vermillion / bronze below 4). "Closed" unchanged.
 */
function StateBadge({ n, label }: { n: NotificationRecord; label: string }) {
  const keyOf = useColorKeyOf();
  const nameOf = usePlayerNames();
  const closer = closerOf(n);
  if (!closer) {
    return (
      <Badge
        variant={n.state === "pending" ? "default" : "secondary"}
        data-testid="note-history-state"
      >
        {label}
      </Badge>
    );
  }
  const color = keyOf(closer);
  return (
    <Badge variant="outline" data-testid="note-history-state">
      Resolved by{" "}
      <span
        data-testid="note-history-closed-by"
        data-color={color ?? undefined}
        className="font-semibold"
        style={color ? { color: colorHex(color) } : undefined}
      >
        {closer.role === "player" ? nameOf(closer.playerId) : "DM"}
      </span>
    </Badge>
  );
}

function Row({
  n,
  views,
  actions,
}: {
  n: NotificationRecord;
  views: NotificationViews;
  actions: ReturnType<typeof useNoteActions>;
}) {
  const you = useSync((s) => s.store.you);
  const live = useSync((s) => s.state === "live");
  const nameOf = usePlayerNames();
  const stripe = useNoteStripe(n);
  if (!you) return null;
  const v = { role: you.role, playerId: you.playerId };
  const action = actionButton(n, v, live, views.get(n.kind));
  const dismiss = dismissButton(n, v, live);
  const state = stateLabel(n, nameOf);
  const time = timeOf(n.createdAt);
  const busy = actions.busy.has(n.id);
  return (
    <li
      data-testid="note-history-row"
      data-record-id={n.id}
      data-state={n.state}
      {...stripe.attrs}
      className={cn(
        "relative flex flex-col gap-1 rounded-md border px-2 py-1.5",
        n.state === "pending" ? "border-primary" : "text-muted-foreground",
      )}
    >
      <NoteStripe color={stripe.color} />
      <NoteBody n={n} views={views} />
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Tooltip content={time.full}>
          <time dateTime={n.createdAt} className="text-muted-foreground">
            {time.short}
          </time>
        </Tooltip>
        {you.role === "dm" && (
          <Badge variant="outline" data-testid="note-history-audience">
            {audienceLabel(n, nameOf)}
          </Badge>
        )}
        {state && <StateBadge n={n} label={state} />}
        <div className="ml-auto flex gap-1">
          {action !== "none" && (
            <Button
              size="sm"
              className={ROW_BUTTON}
              data-testid="note-history-action"
              disabled={action === "disabled" || busy}
              onClick={(e) =>
                void actions.run(n, originOf("history", e.currentTarget.closest(ROW_SELECTOR)))
              }
            >
              {n.actionLabel}
            </Button>
          )}
          {dismiss !== "none" && (
            <Button
              size="sm"
              variant="outline"
              className={ROW_BUTTON}
              data-testid="note-history-dismiss"
              disabled={dismiss === "disabled" || busy}
              onClick={() => void actions.dismiss(n)}
            >
              Dismiss
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

function Section({
  title,
  rows,
  views,
  actions,
  testId,
}: {
  title: string;
  rows: NotificationRecord[];
  views: NotificationViews;
  actions: ReturnType<typeof useNoteActions>;
  testId: string;
}) {
  if (rows.length === 0) return null;
  return (
    <section aria-label={title} data-testid={testId} className="flex flex-col gap-1">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h4>
      <ul className="flex flex-col gap-1">
        {rows.map((n) => (
          <Row key={n.id} n={n} views={views} actions={actions} />
        ))}
      </ul>
    </section>
  );
}

export function HistoryBody({ views, note }: { views: NotificationViews; note: NoteClient }) {
  const store = useSync((s) => s.store);
  const everLive = useSync((s) => s.everLive);
  const sync = useContext(SyncContext);
  const actions = useNoteActions(views);
  const { pending, history } = historySections(store);
  const testMode = isTestMode(store);

  // FR-NOTE-18: open → mark seen now (layout effect: the launcher badge clears with this paint).
  // A minimised window stays mounted (FR-SHELL-36) but isn't open to the user: nothing is seen
  // until it is shown again.
  const shown = useWindowShown();
  useLayoutEffect(() => {
    if (!shown) return;
    const read = () => sync?.getState().store;
    const s = read();
    if (s) note.setHistoryOpen(true, s);
    const onVisible = () => {
      const cur = read();
      if (cur) note.markSeen(cur);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      const cur = read();
      if (cur) note.setHistoryOpen(false, cur);
    };
  }, [note, sync, shown]);
  useEffect(() => {
    if (shown) note.markSeen(store);
  }, [note, store, shown]);

  if (!viewerOf(store) || !everLive) {
    return (
      <div className="flex flex-col gap-2" data-testid="note-history">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-col gap-2" data-testid="note-history">
      {pending.length === 0 && history.length === 0 ? (
        <p
          data-testid="note-history-empty"
          className="py-6 text-center text-sm text-muted-foreground"
        >
          No notifications yet
        </p>
      ) : (
        <>
          <Section
            title="Pending"
            rows={pending}
            views={views}
            actions={actions}
            testId="note-history-pending"
          />
          <Section
            title="History"
            rows={history}
            views={views}
            actions={actions}
            testId="note-history-closed"
          />
        </>
      )}
      {testMode && <TestSendForm />}
    </div>
  );
}

// `note.history` body (FR-NOTE-17): Pending, then History, newest first; DM audience tags and
// Dismiss; test-mode send form (FR-NOTE-22). Marks notifications seen while open (FR-NOTE-18).
import type { NotificationRecord } from "@shared/notifications/schemas";
import { useContext, useEffect, useLayoutEffect } from "react";
import { Button } from "../../components/ui/button";
import { Badge, Skeleton } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { SyncContext, useSync } from "../../sync/store";
import { isTestMode } from "../play-shell/test-windows";
import {
  actionButton,
  audienceLabel,
  dismissButton,
  historySections,
  stateLabel,
  viewerOf,
} from "./logic";
import type { NoteClient } from "./note-client";
import { NoteBody, timeOf, useNoteActions, usePlayerNames } from "./parts";
import { TestSendForm } from "./TestSendForm";
import type { NotificationViews } from "./views";

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
      className={cn(
        "flex flex-col gap-1.5 rounded-md border p-2",
        n.state === "pending" ? "border-primary" : "text-muted-foreground",
      )}
    >
      <NoteBody n={n} views={views} />
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <time dateTime={n.createdAt} title={time.full} className="text-muted-foreground">
          {time.short}
        </time>
        {you.role === "dm" && (
          <Badge variant="outline" data-testid="note-history-audience">
            {audienceLabel(n, nameOf)}
          </Badge>
        )}
        {state && (
          <Badge
            variant={n.state === "pending" ? "default" : "secondary"}
            data-testid="note-history-state"
          >
            {state}
          </Badge>
        )}
        <div className="ml-auto flex gap-1">
          {action !== "none" && (
            <Button
              size="sm"
              data-testid="note-history-action"
              disabled={action === "disabled" || busy}
              onClick={() => void actions.run(n)}
            >
              {n.actionLabel}
            </Button>
          )}
          {dismiss !== "none" && (
            <Button
              size="sm"
              variant="outline"
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
    <section aria-label={title} data-testid={testId} className="flex flex-col gap-1.5">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h4>
      <ul className="flex flex-col gap-1.5">
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
  useLayoutEffect(() => {
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
  }, [note, sync]);
  useEffect(() => {
    note.markSeen(store);
  }, [note, store]);

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
    <div className="flex min-h-0 flex-col gap-3" data-testid="note-history">
      {testMode && <TestSendForm />}
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
    </div>
  );
}

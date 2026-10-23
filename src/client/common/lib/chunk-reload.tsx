// FR-SHELL-175 (BL-91): the reload panel a stale chunk shows instead of "This window failed to
// render.", and the page's one stale notice for parts without a panel of their own. Copy per
// client (the store's role; outside a store, the URL). Everything else on the page stays live.
import { Component, type ReactNode, useContext, useState } from "react";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Tooltip } from "../components/ui/overlays";
import { SyncContext } from "../sync/store";
import {
  type ChunkClient,
  clientFromPath,
  failedCopy,
  isStaleChunk,
  pressReload,
  staleCopy,
} from "./chunk-stale";
import { cn } from "./utils";

/**
 * Where a stale chunk's part falls back (play-shell §14 site list): a window body's panel, an
 * inline panel in its section / popover / prompt card, a compact top-bar Reload, a panel over the
 * map area, or nothing drawn + the stale notice.
 */
export type ChunkFallback = "window" | "inline" | "compact" | "map" | "notice";

function useChunkClient(): ChunkClient {
  const sync = useContext(SyncContext);
  const role = sync?.getState().store.you?.role;
  return role === "dm" || role === "player" ? role : clientFromPath();
}

/** The reload panel for one stale chunk; `ui-window-reload` in a window body, else `ui-chunk-reload`. */
export function ChunkReloadPanel({
  chunk,
  fallback,
}: {
  chunk: string;
  fallback: Exclude<ChunkFallback, "notice">;
}) {
  const client = useChunkClient();
  const [failed, setFailed] = useState(false);
  const copy = failed ? failedCopy(client) : staleCopy(client);
  const onReload = () => setFailed(pressReload(chunk) === "failed");
  const testId = fallback === "window" ? "ui-window-reload" : "ui-chunk-reload";
  if (fallback === "compact") {
    return (
      <Tooltip content={copy}>
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-full"
          data-testid={testId}
          data-variant={fallback}
          data-failed={failed || undefined}
          aria-label={copy}
          onClick={onReload}
        >
          Reload
        </Button>
      </Tooltip>
    );
  }
  return (
    <div
      role="alert"
      data-testid="ui-chunk-reload-panel"
      data-variant={fallback}
      data-chunk={chunk}
      className={cn(
        "flex flex-col items-center justify-center gap-2 text-center text-sm",
        fallback === "window" && "h-full p-4",
        fallback === "inline" && "rounded-md border p-3",
        fallback === "map" && "absolute inset-0 bg-background p-4",
      )}
    >
      <p data-testid="ui-chunk-reload-copy" data-failed={failed || undefined}>
        {copy}
      </p>
      <Button size="sm" data-testid={testId} onClick={onReload}>
        Reload
      </Button>
    </div>
  );
}

let noticeShown = false;
const NOTICE_ID = "ui-chunk-reload-toast";

/**
 * FR-SHELL-175: the stale notice, one sticky alert toast per page, at the first chunk failure
 * without a panel of its own. Its Reload follows FR-SHELL-176's guard.
 */
export function showStaleNotice(chunk = "chunk", client: ChunkClient = clientFromPath()): void {
  if (noticeShown) return;
  noticeShown = true;
  const show = (title: string, id: string) =>
    toast(title, {
      id,
      testId: NOTICE_ID,
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: "Reload",
        // The stack closes a toast on its action: a failed press shows the failed copy anew.
        onClick: () => {
          if (pressReload(chunk) === "failed") show(failedCopy(client), `${NOTICE_ID}-failed`);
        },
      },
    });
  show(staleCopy(client), NOTICE_ID);
}

/** Tests: the page's notice state. */
export function resetStaleNotice(): void {
  noticeShown = false;
}

/**
 * Catches a stale chunk below it and draws the fallback; any other error goes on up (a window's
 * own boundary: "This window failed to render.").
 */
export class ChunkBoundary extends Component<
  { fallback: ChunkFallback; children: ReactNode },
  { error: unknown }
> {
  override state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override componentDidCatch(error: unknown) {
    if (isStaleChunk(error)) console.warn("stale chunk", error.chunk, error.original);
  }
  override render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (!isStaleChunk(error)) throw error;
    const { fallback } = this.props;
    if (fallback === "notice") return null;
    return <ChunkReloadPanel chunk={error.chunk} fallback={fallback} />;
  }
}

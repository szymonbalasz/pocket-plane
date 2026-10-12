// The play page frame (FR-SHELL-01/02/05). Stacking, bottom → top:
// base layer (z-0) < windows (z-10) < chrome: top bar, tool rail, launcher (z-20)
// < reconnect banner (z-30) < dialogs, menus, tooltips (z-50, portalled).
import { useState } from "react";
import { ConnectionIndicator, ReconnectBanner } from "../live-sync/ConnectionStatus";
import { TOP_BAR_H } from "./geometry";
import { useBaseKeyDown, useViewport } from "./hooks";
import { SHELL_ZONE_ATTR } from "./keys";
import { Launcher } from "./Launcher";
import { topWindow } from "./manager";
import type { ShellClient } from "./registry";
import { useAvailableKinds, useRegistry, useShellState, useWindowDispatch } from "./ShellContext";
import { ShellWindow } from "./ShellWindow";
import { SHELL_TEST_DRAG_MIME, SHELL_TEST_KIND } from "./test-windows";

const EMPTY_TEXT: Record<ShellClient, string> = {
  dm: "No scenes yet",
  player: "Waiting for the DM to show a scene",
};

/** The one empty state of the base layer (FR-SHELL-02). Base-layer features render it too. */
export function BaseEmpty({ client }: { client: ShellClient }) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <p data-testid="ui-base-empty" className="text-sm text-muted-foreground">
        {EMPTY_TEXT[client]}
      </p>
    </div>
  );
}

export interface PlayFrameProps {
  client: ShellClient;
  /** Top bar, left: campaign (DM switcher / player "Playing as …"). */
  topLeft: React.ReactNode;
  /** Top bar, right, before the connection indicator. */
  topRight?: React.ReactNode;
  /** Top bar, far right, after the connection indicator. */
  topEnd?: React.ReactNode;
  /** Base layer (scenes-map canvas). Omitted → the empty state. */
  base?: React.ReactNode;
  /** Tool rail content (scenes-map). Empty slot otherwise. */
  toolRail?: React.ReactNode;
}

export function PlayFrame({ client, topLeft, topRight, topEnd, base, toolRail }: PlayFrameProps) {
  const registry = useRegistry();
  const windows = useShellState((s) => s.windows);
  const available = useAvailableKinds();
  const dispatch = useWindowDispatch();
  const viewport = useViewport();
  const top = topWindow(windows, available);
  const testMode = available.has(SHELL_TEST_KIND);

  return (
    // overflow-clip (not hidden): a clipped box can't be scrolled at all, so focusing something
    // in an off-screen part of a window never shifts the page. The scroll reset is a fallback.
    <div
      className="fixed inset-0 overflow-clip bg-background"
      data-testid="ui-play-page"
      onScroll={(e) => {
        e.currentTarget.scrollTop = 0;
        e.currentTarget.scrollLeft = 0;
      }}
    >
      <BaseLayer testMode={testMode}>{base ?? <BaseEmpty client={client} />}</BaseLayer>

      <div
        className="pointer-events-none absolute inset-0 isolate z-10 overflow-clip"
        data-testid="ui-windows"
      >
        {windows.map((w) => {
          const def = registry.get(w.kind);
          if (!def || w.state !== "open" || !available.has(w.kind)) return null;
          return (
            <ShellWindow
              key={`${w.kind}:${w.instance}`}
              win={w}
              def={def}
              viewport={viewport}
              focused={top === w}
              dispatch={dispatch}
            />
          );
        })}
      </div>

      <header
        {...{ [SHELL_ZONE_ATTR]: "topbar" }}
        data-testid="ui-topbar"
        tabIndex={-1}
        className="outline-none absolute inset-x-0 top-0 z-20 flex items-center gap-3 border-b bg-background/85 px-3 backdrop-blur"
        style={{ height: TOP_BAR_H }}
      >
        <div className="flex min-w-0 items-center gap-2">{topLeft}</div>
        <div className="ml-auto flex items-center gap-2">
          {topRight}
          <ConnectionIndicator />
          {topEnd}
        </div>
      </header>

      <aside
        data-testid="ui-tool-rail"
        className="absolute left-0 z-20 flex flex-col gap-1 empty:hidden"
        style={{ top: TOP_BAR_H + 8 }}
      >
        {toolRail}
      </aside>

      <Launcher
        defs={registry.defs.filter((d) => available.has(d.kind))}
        windows={windows}
        dispatch={dispatch}
      />

      {/* Companions: mounted while their kind is available, open or not (e.g. toasts). */}
      {registry.defs.map((d) => {
        const Companion = d.companion;
        return Companion && available.has(d.kind) ? (
          <Companion key={`companion:${d.kind}`} />
        ) : null;
      })}

      <div className="absolute inset-x-0 z-30 bg-background/90" style={{ top: TOP_BAR_H }}>
        <ReconnectBanner />
      </div>
    </div>
  );
}

/**
 * Base layer container. In test mode it records the last base key and the last window-origin
 * drop of the `shell.test` chip, so a walkthrough / E2E can check FR-SHELL-13 end to end.
 */
function BaseLayer({ testMode, children }: { testMode: boolean; children: React.ReactNode }) {
  const [lastKey, setLastKey] = useState("");
  const [lastDrop, setLastDrop] = useState("");
  useBaseKeyDown((e) => {
    if (testMode) setLastKey(`${e.ctrlKey ? "Ctrl+" : ""}${e.key}`);
  });
  return (
    <div
      data-testid="ui-base"
      role="application"
      aria-label="Map"
      className="absolute inset-0 z-0 overflow-clip"
      {...(testMode && { "data-test-last-key": lastKey, "data-test-last-drop": lastDrop })}
      onDragOver={(e) => {
        if (testMode && e.dataTransfer.types.includes(SHELL_TEST_DRAG_MIME)) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!testMode) return;
        const data = e.dataTransfer.getData(SHELL_TEST_DRAG_MIME);
        if (data) {
          e.preventDefault();
          setLastDrop(data);
        }
      }}
    >
      {children}
    </div>
  );
}

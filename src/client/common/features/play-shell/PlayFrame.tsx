// The play page frame (FR-SHELL-01/02/05). Stacking, bottom → top:
// base layer (z-0) < windows (z-10) < chrome: top bar (with the launcher, FR-KIT-14), tool rail (z-20)
// < reconnect banner (z-30) < dialogs (z-50, portalled) < alert flash (z-100, portalled,
// FR-SHELL-22) < toast stack (900) < popovers, menus, Select lists, tooltips (`POPOVER_Z` 950,
// portalled; `components/ui/layers.ts`) < overlay layer (FR-SHELL-112 (2), -135) < dice layer.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ConnectionIndicator, ReconnectBanner } from "../live-sync/ConnectionStatus";
import { AlertFlash } from "./AlertLayer";
import { testSoundAttr } from "./alerts";
import { TOP_BAR_H } from "./geometry";
import { useBaseKeyDown, useViewport } from "./hooks";
import { IdentityChip } from "./IdentityChip";
import { keepOutsAttr, useKeepOuts } from "./keep-outs";
import { SHELL_ZONE_ATTR } from "./keys";
import { Launcher, sansFamily, textWidth } from "./Launcher";
import { LAUNCHER_MIN_ZONE } from "./launcher-fit";
import { mountedWindows, topWindow, type WindowAction } from "./manager";
import { OverlayLayer } from "./OverlayLayer";
import type { ShellClient } from "./registry";
import {
  useAlertState,
  useAvailableKinds,
  useRegistry,
  useShellState,
  useWindowDispatch,
} from "./ShellContext";
import { ShellWindow } from "./ShellWindow";
import { SHELL_TEST_DRAG_MIME, SHELL_TEST_KIND } from "./test-windows";
import { topBarItemsFor, topBarItemWidth } from "./top-bar-items";
import { launcherRoom, topBarRuns, truncated } from "./topbar-room";

/**
 * FR-SHELL-95: the `viewport` settle runs this long after the last resize event: before the map's
 * resize refit (200 ms, FR-MAP-47), so the refit frames the settled windows (FR-MAP-98).
 */
export const VIEWPORT_SETTLE_MS = 150;

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
  /** Top bar, left: the campaign title (DM: its menu; player: "· playing as …", FR-KIT-11/12). */
  topLeft: React.ReactNode;
  /** In the status pill, after the connection state (DM: presence, FR-KIT-13). */
  topStatus?: React.ReactNode;
  /** Top bar, after the connection indicator, before the identity chip (FR-SHELL-70). */
  topEnd?: React.ReactNode;
  /** Base layer (scenes-map canvas). Omitted → the empty state. */
  base?: React.ReactNode;
  /** Tool rail content (scenes-map). Empty slot otherwise. */
  toolRail?: React.ReactNode;
}

/**
 * The launcher's fit width, px (FR-KIT-14): the top bar's centre zone, measured, with the title
 * zone and right cluster counted at their theme-independent widths (BL-136, `launcherRoom`); null
 * before it is laid out (the launcher then fits the viewport). Measured again when a zone resizes
 * (a theme or web font changes the text) and when web fonts finish loading.
 */
function useLauncherRoom(centreRef: React.RefObject<HTMLElement | null>): number | null {
  const [w, setW] = useState<number | null>(null);
  useLayoutEffect(() => {
    const centre = centreRef.current;
    const bar = centre?.parentElement;
    const left = bar?.querySelector<HTMLElement>('[data-testid="ui-topbar-left"]');
    const right = bar?.querySelector<HTMLElement>('[data-testid="ui-topbar-right"]');
    if (!centre || !bar || !left || !right) return;
    const measure = () => {
      const cs = getComputedStyle(bar);
      const content =
        bar.clientWidth - Number.parseFloat(cs.paddingLeft) - Number.parseFloat(cs.paddingRight);
      const sans = sansFamily();
      setW(
        launcherRoom({
          centre: centre.getBoundingClientRect().width,
          left: left.getBoundingClientRect().width,
          leftCap: (content * Number.parseFloat(TOP_TITLE_MAX)) / 100,
          leftTruncated: truncated(left),
          leftRuns: topBarRuns(left, textWidth, sans),
          rightRuns: topBarRuns(right, textWidth, sans),
        }),
      );
    };
    measure();
    document.fonts?.addEventListener("loadingdone", measure);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    for (const el of [centre, left, right]) ro?.observe(el);
    return () => {
      ro?.disconnect();
      document.fonts?.removeEventListener("loadingdone", measure);
    };
  }, [centreRef]);
  return w;
}

/** The title zone's widest share of the top bar, so the launcher keeps room (FR-KIT-10). */
export const TOP_TITLE_MAX = "30%";

export function PlayFrame({ client, topLeft, topStatus, topEnd, base, toolRail }: PlayFrameProps) {
  const registry = useRegistry();
  const windows = useShellState((s) => s.windows);
  const placed = useShellState((s) => s.placed);
  const settling = useShellState((s) => s.settling);
  const autoMinimised = useShellState((s) => s.autoMinimised);
  const autoCause = useShellState((s) => s.autoMinimisedCause);
  const autoMinimiseLog = useShellState((s) => s.autoMinimiseLog);
  const settleLog = useShellState((s) => s.settleLog);
  const regions = useKeepOuts(client);
  const available = useAvailableKinds();
  const dispatch = useWindowDispatch();
  const viewport = useViewport();
  const top = topWindow(windows, available);
  const testMode = available.has(SHELL_TEST_KIND);
  const lastSound = useAlertState((s) => s.lastSound);
  const centre = useRef<HTMLDivElement | null>(null);
  const room = useLauncherRoom(centre);
  useAppearPlacement(available, dispatch);
  // FR-SHELL-95, -103: while the viewport changes windows only render-fit; one `viewport` settle
  // runs, and writes, after the last resize event. Timed from the event itself (not a render), so
  // it always lands before the map's resize refit (FR-MAP-98).
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = () => {
      clearTimeout(t);
      t = setTimeout(() => dispatch({ type: "viewport" }), VIEWPORT_SETTLE_MS);
    };
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("resize", on);
      clearTimeout(t);
    };
  }, [dispatch]);

  return (
    // overflow-clip (not hidden): a clipped box can't be scrolled at all, so focusing something
    // in an off-screen part of a window never shifts the page. The scroll reset is a fallback.
    <div
      className="fixed inset-0 overflow-clip bg-background"
      data-testid="ui-play-page"
      data-keep-outs={keepOutsAttr(regions)}
      // FR-SHELL-88: the last placement's auto-minimise moves (test mode only).
      data-auto-minimise-log={testMode ? autoMinimiseLog : undefined}
      // FR-SHELL-110: the last settle's steps, "trigger:kind>rung;…" (test mode only).
      data-settle-log={testMode ? settleLog : undefined}
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
        {/* FR-SHELL-36: minimised windows stay mounted (hidden), so they keep their state. */}
        {mountedWindows(windows, available).map((w) => {
          const def = registry.get(w.kind);
          if (!def) return null;
          return (
            <ShellWindow
              key={`${w.kind}:${w.instance}`}
              win={w}
              def={def}
              placed={placed.get(`${w.kind}:${w.instance}`)}
              settling={settling.has(`${w.kind}:${w.instance}`)}
              autoMinimised={autoMinimised.has(`${w.kind}:${w.instance}`)}
              autoMinimisedCause={autoCause.get(`${w.kind}:${w.instance}`)}
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
        {...testSoundAttr(testMode, lastSound)}
        tabIndex={-1}
        className="outline-none absolute inset-x-0 top-0 z-20 flex items-center border-b bg-background/85 px-3 backdrop-blur"
        style={{ height: TOP_BAR_H }}
      >
        {/* FR-KIT-10: three zones. FR-SHELL-109 (BL-53): the title shrinks (to at most 30 % of the
            bar) and its text ellipsises; the right cluster never shrinks, so nothing runs under
            it (its items have fixed widths). The centre takes the rest: the launcher's fit width
            (FR-KIT-14, ≥ 8 px gutters inside it). */}
        <div
          data-testid="ui-topbar-left"
          className="flex min-w-0 shrink items-center gap-2 overflow-hidden whitespace-nowrap *:min-w-0 *:truncate"
          style={{ maxWidth: TOP_TITLE_MAX }}
        >
          {topLeft}
        </div>
        <div
          ref={centre}
          data-testid="ui-topbar-centre"
          className="flex h-full flex-1 items-center justify-center overflow-hidden"
          style={{ minWidth: LAUNCHER_MIN_ZONE }}
        >
          <Launcher
            defs={registry.defs.filter((d) => available.has(d.kind))}
            windows={windows}
            viewport={viewport}
            room={room}
            dispatch={dispatch}
          />
        </div>
        <div data-testid="ui-topbar-right" className="flex shrink-0 items-center gap-2">
          {/* FR-KIT-13: one status group, the connection state then (DM) presence; K13 (DM
              #363): plain muted text as the kit's `.live` ("● Live · 3 players"), no pill. */}
          <div
            data-testid="ui-topbar-status"
            data-slot="topbar-status"
            className="inline-flex shrink-0 items-center gap-1.5 text-[13px] whitespace-nowrap text-muted-foreground"
          >
            <ConnectionIndicator />
            {topStatus}
          </div>
          {topEnd}
          {/* FR-SHELL-112 (3): registered top-bar items, fixed width each, before the chip. */}
          {topBarItemsFor(client).map((t) => (
            <div
              key={t.id}
              data-testid="ui-topbar-item"
              data-record-id={t.id}
              className="flex shrink-0 items-center"
              style={{ width: topBarItemWidth(t, viewport) }}
            >
              <t.Component />
            </div>
          ))}
          {/* FR-SHELL-70: opens Preferences; the players' sound state moved here (FR-SHELL-73). */}
          <IdentityChip client={client} />
        </div>
      </header>

      <aside
        data-testid="ui-tool-rail"
        className="absolute left-0 z-20 flex flex-col gap-1 empty:hidden"
        style={{ top: TOP_BAR_H + 8 }}
      >
        {toolRail}
      </aside>

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

      <AlertFlash />

      <OverlayLayer client={client} />
    </div>
  );
}

/**
 * A kind that becomes available while the page shows a layout (not on restore) gets an
 * `appear` (FR-SHELL-107: a protected one takes its zone); one that goes ends what it displaced
 * (FR-SHELL-102: a `return`).
 */
function useAppearPlacement(available: ReadonlySet<string>, dispatch: (a: WindowAction) => void) {
  const key = useShellState((s) => s.key);
  const prev = useRef<{ key: string | null; kinds: ReadonlySet<string> } | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = { key, kinds: available };
    if (!p || key === null || p.key !== key) return;
    if ([...p.kinds].some((kind) => !available.has(kind))) dispatch({ type: "return" });
    for (const kind of available) if (!p.kinds.has(kind)) dispatch({ type: "appear", kind });
  }, [available, key, dispatch]);
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

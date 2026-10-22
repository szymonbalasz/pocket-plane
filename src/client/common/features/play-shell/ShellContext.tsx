// Shell provider: one window manager per play page, restored from browser storage after the
// first snapshot and after `you.campaignId` changes (FR-SHELL-16). Stays mounted across the
// waiting / reconnect screens so windows come back as they were (FR-SHELL-04). Also owns the
// page's alert controller (FR-SHELL-22–25): one per play page, both clients.
import { layoutKey } from "@shared/play-shell/layout";
import { type RecordStore, recordsOf } from "@shared/protocol/store";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { createStore, useStore } from "zustand";
import { SyncContext, useSync } from "../../sync/store";
import { showAlertToast } from "./alert-toast";
import {
  type AlertController,
  type AlertState,
  createAlertController,
  createTitleMarker,
  type ShellAlert,
} from "./alerts";
import { browserAudioContext, createAudioEngine } from "./audio";
import { chromeKeepOuts } from "./chrome-keep-outs";
import { contentHeights } from "./content-heights";
import { requestFit } from "./free-area";
import type { Rect, Viewport } from "./geometry";
import { keepOuts, reportedKeepOuts, subscribeKeepOuts } from "./keep-outs";
import type { OpenBy, WindowAction } from "./manager";
import { availableKinds, type WindowRegistry } from "./registry";
import { createShellController, type ShellController, type ShellState } from "./shell-store";
import { browserSoundSettingsStorage, soundKey } from "./sound-settings";
import { browserLayoutStorage } from "./storage";
import { isPlacementPc, tokenScreenBoxes } from "./token-boxes";

const ShellContext = createContext<ShellController | null>(null);
const AlertContext = createContext<AlertController | null>(null);

const browserViewport = () => ({ w: window.innerWidth, h: window.innerHeight });

/** The map canvas's element (`data-camera`, `data-fit-reason`, FR-MAP-44 (b), -82). */
const mapCanvas = () =>
  typeof document === "undefined" ? null : document.querySelector('[data-testid="map-canvas"]');

/** FR-SHELL-96: the camera mode the placer sees (`moved`: zones yield to PCs, FR-SHELL-99). */
const cameraMode = () =>
  mapCanvas()?.getAttribute("data-camera") === "moved" ? ("moved" as const) : ("fitted" as const);

/**
 * The drawn tokens' footprints for auto placement (FR-SHELL-40, -45, -57, -77): `pc` = a player
 * character's token (a character, with an owner, in this client's store). Pets, summons and other
 * owned companions rank like any other token (sprint 7 ruling: #310 says PCs).
 */
function placementTokens(store: RecordStore | undefined) {
  const pcs = new Set(
    store
      ? recordsOf<{ id: string; ownerPlayerId: string | null; characterId: string | null }>(
          store,
          TOKEN_TYPE,
        )
          .filter((t) => isPlacementPc(t))
          .map((t) => t.id)
      : [],
  );
  return tokenScreenBoxes("all", store).map((b) => ({
    ...b,
    pc: b.id !== undefined && pcs.has(b.id),
  }));
}

export function ShellProvider({
  registry,
  children,
}: {
  registry: WindowRegistry;
  children: React.ReactNode;
}) {
  const sync = useContext(SyncContext);
  const [controller] = useState(
    (): ShellController =>
      createShellController({
        registry,
        storage: browserLayoutStorage(),
        viewport: browserViewport,
        avoid: () => placementTokens(sync?.getState().store),
        // FR-SHELL-48, -113: the toast box, reported tool bars, the shown chrome keep-outs.
        keepOuts: (vp: Viewport) =>
          keepOuts(
            registry.client,
            vp,
            reportedKeepOuts(),
            chromeKeepOuts(registry.client, vp, sync?.getState().store),
          ),
        heights: (id) => contentHeights().get(id),
        available: () => availableIn(registry, sync),
        camera: cameraMode,
        // FR-SHELL-80: the map refits once on the client that reset.
        onReset: requestFit,
      }),
  );
  // FR-SHELL-81: a reported region (the active tool bar) going returns the windows it pushed.
  useEffect(() => {
    let before = new Set(reportedKeepOuts().keys());
    return subscribeKeepOuts(() => {
      const now = new Set(reportedKeepOuts().keys());
      const gone = [...before].some((id) => !now.has(id));
      before = now;
      if (gone) controller.dispatch({ type: "return" }, availableNow(controller, sync));
    });
  }, [controller, sync]);
  useChromePushes(controller, sync);
  const you = useSync((s) => s.store.you);
  const key = you
    ? layoutKey(
        you.campaignId,
        you.role === "player" && you.playerId ? { playerId: you.playerId } : { role: "dm" },
      )
    : null;
  // Layout effect: the restored windows paint with the first frame of the new snapshot.
  useLayoutEffect(() => {
    if (key) controller.restore(key);
  }, [controller, key]);
  useLoadAfterDraw(controller, sync, key);
  const alerts = useAlertRuntime(
    you?.role === "player" && you.playerId ? soundKey(you.campaignId, you.playerId) : null,
  );
  return (
    <ShellContext.Provider value={controller}>
      <AlertContext.Provider value={alerts}>{children}</AlertContext.Provider>
    </ShellContext.Provider>
  );
}

/** How long the second `load` settle waits for the map's first draw before it gives up. */
const DRAW_WAIT_MS = 10_000;

/**
 * FR-SHELL-95: `load` settles once more after the first token draw, so PCs count. After a layout
 * is applied (`key`), each animation frame looks at the map canvas: once its load fit ran
 * (`data-fit-reason` past `open`) and tokens are drawn, one `load` settle runs. No map within
 * 10 s: nothing more (no PCs to count).
 */
function useLoadAfterDraw(
  controller: ShellController,
  sync: React.ContextType<typeof SyncContext>,
  key: string | null,
) {
  useEffect(() => {
    if (!key || typeof requestAnimationFrame === "undefined") return;
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const fitted = (mapCanvas()?.getAttribute("data-fit-reason") ?? "open") !== "open";
      if (fitted && placementTokens(sync?.getState().store).length > 0) {
        controller.dispatch({ type: "load" }, availableNow(controller, sync));
        return;
      }
      if (performance.now() - t0 < DRAW_WAIT_MS) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [controller, sync, key]);
}

/**
 * FR-SHELL-113: a chrome keep-out showing (or changing its rect) pushes the windows under it; one
 * going returns what it pushed.
 */
function useChromePushes(controller: ShellController, sync: React.ContextType<typeof SyncContext>) {
  useEffect(() => {
    if (!sync) return;
    const client = controller.registry.client;
    let before = new Map<string, string>();
    const check = () => {
      const now = new Map(
        chromeKeepOuts(client, browserViewport(), sync.getState().store).map((k) => [k.id, k.rect]),
      );
      const keyOf = (r: Rect) => `${r.x},${r.y},${r.w},${r.h}`;
      const available = availableNow(controller, sync);
      for (const [id, r] of now) {
        if (before.get(id) !== keyOf(r)) controller.dispatch({ type: "push", rect: r }, available);
      }
      if ([...before.keys()].some((id) => !now.has(id))) {
        controller.dispatch({ type: "return" }, available);
      }
      before = new Map([...now].map(([id, r]) => [id, keyOf(r)]));
    };
    check();
    return sync.subscribe(check);
  }, [controller, sync]);
}

/**
 * The page's alert controller: sound settings of `soundOwner` (player key; DM null → defaults,
 * no control), audio unlocked by the first `pointerdown` / `keydown` (FR-SHELL-25), title mark
 * cleared when the page is visible again (FR-SHELL-23).
 */
function useAlertRuntime(soundOwner: string | null): AlertController {
  const [rt] = useState(() => {
    const title = createTitleMarker(document);
    const alerts = createAlertController({
      audio: createAudioEngine({ create: browserAudioContext }),
      storage: browserSoundSettingsStorage(),
      toast: showAlertToast,
      title,
    });
    return { alerts, title };
  });
  const { alerts, title } = rt;
  useLayoutEffect(() => alerts.setOwner(soundOwner), [alerts, soundOwner]);
  useEffect(() => {
    const opts = { capture: true } as const;
    const off = () => {
      window.removeEventListener("pointerdown", on, opts);
      window.removeEventListener("keydown", on, opts);
    };
    const on = () => {
      alerts.unlock();
      off();
    };
    window.addEventListener("pointerdown", on, opts);
    window.addEventListener("keydown", on, opts);
    return off;
  }, [alerts]);
  useEffect(() => {
    const on = () => {
      if (!document.hidden) title.visible();
    };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, [title]);
  return alerts;
}

function useController(): ShellController {
  const c = useContext(ShellContext);
  if (!c) throw new Error("play-shell hook outside ShellProvider");
  return c;
}

export function useAlertController(): AlertController {
  const c = useContext(AlertContext);
  if (!c) throw new Error("play-shell hook outside ShellProvider");
  return c;
}

export function useAlertState<T>(selector: (s: AlertState) => T): T {
  return useStore(useAlertController().store, selector);
}

/**
 * Feature API (FR-SHELL-22): `useShellAlert()({id, title, detail?, sound?})` flashes the screen,
 * shows a Toast, plays the sound (if unlocked and not muted) and marks the title while hidden.
 * Call it only for live events the client received, never on a snapshot.
 */
export function useShellAlert(): (alert: ShellAlert) => void {
  const c = useAlertController();
  return useCallback((a: ShellAlert) => c.alert(a), [c]);
}

export function useShellState<T>(selector: (s: ShellState) => T): T {
  return useStore(useController().store, selector);
}

export function useRegistry(): WindowRegistry {
  return useController().registry;
}

/** FR-SHELL-112 (2): a `blocksInput` overlay is up → the placer's settles queue until it goes. */
export function useSetShellBlocked(): (blocked: boolean) => void {
  const c = useController();
  return useCallback((blocked: boolean) => c.setBlocked(blocked), [c]);
}

/** Kinds this client renders right now (registered + available), as a stable Set. */
export function useAvailableKinds(): ReadonlySet<string> {
  const registry = useRegistry();
  const joined = useSync((s) => [...availableKinds(registry, s.store)].join(","));
  return useMemo(() => new Set(joined ? joined.split(",") : []), [joined]);
}

/** Kinds available in the synced store now (every registered kind before a store exists). */
function availableNow(
  controller: ShellController,
  sync: React.ContextType<typeof SyncContext>,
): ReadonlySet<string> {
  const store = sync?.getState().store;
  return store
    ? availableKinds(controller.registry, store)
    : new Set(controller.registry.defs.map((d) => d.kind));
}

/** Dispatch a window action against the current availability. */
export function useWindowDispatch(): (action: WindowAction) => void {
  const controller = useController();
  const sync = useContext(SyncContext);
  return useCallback(
    (action: WindowAction) => {
      controller.dispatch(action, availableNow(controller, sync));
    },
    [controller, sync],
  );
}

/**
 * Feature API (SHELL §9): open a window by kind (and instance, `main` in MVP), or bring it to
 * front / restore it. Passes no data; the window reads the synced store itself. `by` (FR-SHELL-08)
 * defaults to `"user"` (click-driven: the stored spot); a feature opening a window on its own
 * passes `"feature"` (never over another window, FR-SHELL-41).
 */
export function useOpenWindow(): (kind: string, instance?: string, opts?: { by?: OpenBy }) => void {
  const dispatch = useWindowDispatch();
  return useCallback(
    (kind: string, instance?: string, opts?: { by?: OpenBy }) =>
      dispatch({ type: "open", kind, instance, by: opts?.by ?? "user" }),
    [dispatch],
  );
}

/**
 * Feature API (FR-SHELL-55): `push(rect)` moves every open window overlapping a map tool bar at
 * `rect` (viewport px) right of it; call it when the bar appears or changes size, never on window
 * changes; the windows go back when the bar's keep-out report goes (FR-SHELL-81, `ShellProvider`).
 * `layoutKey` changes when a layout is applied (first snapshot, campaign switch): a bar shown then
 * pushes again. Outside a ShellProvider: a no-op and null.
 */
export function usePushWindows(): { push: (rect: Rect) => void; layoutKey: string | null } {
  const controller = useContext(ShellContext);
  const sync = useContext(SyncContext);
  const layoutKey = useStore(controller?.store ?? NO_SHELL, (s) => s.key);
  const push = useCallback(
    (rect: Rect) => {
      if (controller) controller.dispatch({ type: "push", rect }, availableNow(controller, sync));
    },
    [controller, sync],
  );
  return { push, layoutKey };
}

const NO_SHELL = createStore<Pick<ShellState, "key">>()(() => ({ key: null }));

/** Kinds available in the synced store now (every registered kind before a store exists). */
function availableIn(
  registry: WindowRegistry,
  sync: React.ContextType<typeof SyncContext>,
): ReadonlySet<string> {
  const store = sync?.getState().store;
  return store ? availableKinds(registry, store) : new Set(registry.defs.map((d) => d.kind));
}

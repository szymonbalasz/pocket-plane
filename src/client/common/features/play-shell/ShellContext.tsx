// Shell provider: one window manager per play page, restored from browser storage after the
// first snapshot and after `you.campaignId` changes (FR-SHELL-16). Stays mounted across the
// waiting / reconnect screens so windows come back as they were (FR-SHELL-04). Also owns the
// page's alert controller (FR-SHELL-22–25): one per play page, both clients.
import { layoutKey } from "@shared/play-shell/layout";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { useStore } from "zustand";
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
import type { WindowAction } from "./manager";
import { availableKinds, type WindowRegistry } from "./registry";
import { createShellController, type ShellController, type ShellState } from "./shell-store";
import { browserSoundSettingsStorage, soundKey } from "./sound-settings";
import { browserLayoutStorage } from "./storage";
import { tokenScreenBoxes } from "./token-boxes";

const ShellContext = createContext<ShellController | null>(null);
const AlertContext = createContext<AlertController | null>(null);

const browserViewport = () => ({ w: window.innerWidth, h: window.innerHeight });

export function ShellProvider({
  registry,
  children,
}: {
  registry: WindowRegistry;
  children: React.ReactNode;
}) {
  const [controller] = useState(() =>
    createShellController({
      registry,
      storage: browserLayoutStorage(),
      viewport: browserViewport,
      avoid: () => tokenScreenBoxes("all"),
    }),
  );
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
  const alerts = useAlertRuntime(
    you?.role === "player" && you.playerId ? soundKey(you.campaignId, you.playerId) : null,
  );
  return (
    <ShellContext.Provider value={controller}>
      <AlertContext.Provider value={alerts}>{children}</AlertContext.Provider>
    </ShellContext.Provider>
  );
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

/** Kinds this client renders right now (registered + available), as a stable Set. */
export function useAvailableKinds(): ReadonlySet<string> {
  const registry = useRegistry();
  const joined = useSync((s) => [...availableKinds(registry, s.store)].join(","));
  return useMemo(() => new Set(joined ? joined.split(",") : []), [joined]);
}

/** Dispatch a window action against the current availability. */
export function useWindowDispatch(): (action: WindowAction) => void {
  const controller = useController();
  const sync = useContext(SyncContext);
  return useCallback(
    (action: WindowAction) => {
      const store = sync?.getState().store;
      const available = store
        ? availableKinds(controller.registry, store)
        : new Set(controller.registry.defs.map((d) => d.kind));
      controller.dispatch(action, available);
    },
    [controller, sync],
  );
}

/**
 * Feature API (SHELL §9): open a window by kind (and instance, `main` in MVP), or bring it to
 * front / restore it. Passes no data; the window reads the synced store itself.
 */
export function useOpenWindow(): (kind: string, instance?: string) => void {
  const dispatch = useWindowDispatch();
  return useCallback(
    (kind: string, instance?: string) => dispatch({ type: "open", kind, instance }),
    [dispatch],
  );
}

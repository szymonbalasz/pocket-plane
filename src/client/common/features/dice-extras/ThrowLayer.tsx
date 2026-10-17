// Dice-extras runtime, the `dicex.tray` companion (mounted while the kind is available, open or
// not): opens the tray on a stage, drops the request when the tray closes, preloads the 3D chunk
// at idle (FR-DICEX-37) and turns live `roll` entries into roll popups (FR-DICEX-39) and throws
// (FR-DICEX-11, -32, -38, -43) in the stores, which run their timelines (FR-DICEX-18, -35). The
// views that draw them (dice layer, zone) and the popup stack (`RollPopup.tsx`, portalled into the
// shell's toast region) are lazy chunks loaded at idle too.

import type { PlayerRecord } from "@shared/campaign-management/schemas";
import {
  DICE_LOOK_TYPE,
  type DiceLook,
  type DiceLookRecord,
  lookOf,
} from "@shared/dice-extras/looks";
import { type DiceThrow, throwDice } from "@shared/dice-extras/throw";
import { recordsOf } from "@shared/protocol/store";
import { lazy, Suspense, useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useSync } from "../../sync/store";
import { useOpenWindow, useRegistry, useShellState } from "../play-shell/ShellContext";
import { useRollPopupMount } from "../play-shell/ShellToaster";
import { popupHost, type ThrowPlan } from "./display";
import { onRollFrame } from "./frame-handler";
import { createChunkLoader, dice3d, loadAtIdle, preloadAtIdle, whenChunk } from "./lazy3d";
import { rollPopups, setThreeDReady, useRollPopups } from "./popups";
import { is3dDisplay, useDiceSettings } from "./settings";
import { diceExtras, useDiceExtras } from "./store";
import { useRollFrames } from "./throw-source";
import { DICEX_TRAY_KIND } from "./window-kind";

/** The throw views (zone, dice layer, 3D runs): a small lazy chunk, preloaded at idle. */
const views = createChunkLoader(() => import("./ThrowViews"));
const LazyViews = lazy(() => {
  views.load();
  return import("./ThrowViews").then((m) => ({ default: m.ThrowViews }));
});

/** FR-DICEX-39: the popup UI, a lazy chunk (≤ 8 KB gz) preloaded at idle in every display mode. */
const popupUi = createChunkLoader(() => import("./RollPopup"));
const LazyPopups = lazy(() => {
  popupUi.load();
  return import("./RollPopup").then((m) => ({ default: m.RollPopupStack }));
});

// A miniature can play once the 3D chunk is in (FR-DICEX-41 b).
setThreeDReady(() => dice3d.state() === "ready");

/**
 * Each entry's roller look (FR-DICEX-20): the roller's stored `dice-look` row (D2), else the
 * derived default. Read when the throw starts, so a look changed mid-throw shows from the next.
 */
export function looksOf(
  t: DiceThrow,
  entries: readonly { id: string; rollerRole: string; rollerPlayerId: string | null }[],
  playerIds: readonly string[],
  rows: readonly DiceLookRecord[],
): Record<string, DiceLook> {
  const out: Record<string, DiceLook> = {};
  for (const e of entries) {
    if (!t.entryIds.includes(e.id)) continue;
    out[e.id] = lookOf(e.rollerRole === "dm" ? null : e.rollerPlayerId, rows, playerIds);
  }
  return out;
}

function useTrayWindowSync() {
  const open = useOpenWindow();
  const staged = useDiceExtras((s) => s.staged);
  const seen = useRef(staged);
  useEffect(() => {
    if (staged === seen.current) return;
    seen.current = staged;
    open(DICEX_TRAY_KIND); // FR-DICEX-01: open / restore + front (FR-SHELL-08)
  }, [staged, open]);
  // FR-DICEX-03: closing the window drops the staged request; minimising keeps it.
  const status = useShellState(
    (s) => s.windows.find((w) => w.kind === DICEX_TRAY_KIND)?.state ?? "closed",
  );
  const prev = useRef(status);
  useEffect(() => {
    if (prev.current !== "closed" && status === "closed") diceExtras.clear();
    prev.current = status;
  }, [status]);
}

export function DiceExtrasRuntime() {
  useTrayWindowSync();
  const { settings, display, set } = useDiceSettings();
  const you = useSync((s) => s.store.you);
  const current = useDiceExtras((s) => s.current);
  const leaving = useDiceExtras((s) => s.leaving);
  const pending = useDiceExtras((s) => s.pending);
  const cfg = useRef({ settings, display });
  cfg.current = { settings, display };
  const waiting = useRef<(() => void) | null>(null);

  // FR-DICEX-37: the 3D chunk loads at idle after the first snapshot when the display draws 3D;
  // the views chunk then too, in every display but `off`.
  const snapshot = you !== null;
  useEffect(() => {
    if (!snapshot) return;
    return preloadAtIdle(dice3d, display);
  }, [snapshot, display]);
  useEffect(() => {
    if (!snapshot) return;
    return loadAtIdle(views);
  }, [snapshot]);
  useEffect(() => {
    if (!snapshot) return;
    return loadAtIdle(popupUi);
  }, [snapshot]);
  const viewsState = useSyncExternalStore(views.subscribe, views.state, views.state);
  useEffect(() => () => waiting.current?.(), []);

  useRollFrames((entries, store) => {
    const tabHidden = globalThis.document?.hidden === true;
    const playerIds = recordsOf<PlayerRecord>(store, "player").map((p) => p.id);
    const looks = (t: DiceThrow) =>
      looksOf(t, entries, playerIds, recordsOf<DiceLookRecord>(store, DICE_LOOK_TYPE));
    const popups = popupHost(cfg.current.settings);
    onRollFrame(
      entries,
      store,
      { ...cfg.current, tabHidden },
      {
        ownRolled: (own) => diceExtras.ownRolled(own),
        // FR-DICEX-39: every received entry, the roller's too, in one popup.
        popup: (all, big) => {
          if (!popups) return;
          const t = throwDice(all);
          if (!t) return;
          rollPopups.add({
            entries: all,
            looks: looks(t),
            big: big && big.plan.draw === "3d" ? { id: big.t.id, entryIds: big.t.entryIds } : null,
            threeD: is3dDisplay(cfg.current.display) && !tabHidden,
          });
        },
        play: (t, plan) => {
          const start = (p: ThrowPlan) => diceExtras.play(t, p, looks(t));
          // A newer frame replaces a throw still waiting for the chunk.
          waiting.current?.();
          waiting.current = null;
          if (plan.draw === "flat") return start(plan);
          // Set before the wait: a chunk already in calls back at once and clears it.
          waiting.current = () => {};
          // FR-DICEX-37: a throw during the load waits ≤ 1.5 s, then 3D, else flat: in the zone,
          // or with popups on as chips in its popup (FR-DICEX-41 c), as when a newer frame
          // replaces it while it waits.
          const toChips = () => {
            const p = popups ? rollPopups.ofBig(t.id) : null;
            if (p) rollPopups.fallback(p.id, "handoff", "chips");
            return p !== null;
          };
          const cancel = whenChunk(dice3d, (ready) => {
            waiting.current = null;
            if (ready) return start(plan);
            if (!toChips()) start({ ...plan, arena: "zone", draw: "flat" });
          });
          if (waiting.current === null) return; // ready at once: started
          waiting.current = () => {
            cancel();
            toChips();
          };
        },
      },
    );
  });

  // FR-DICEX-23 / -44: slow 3D → flat on this device (switched back in the tray settings).
  const onSlow = () => {
    set({ display: "flat" });
    toast("Dice set to flat: 3D was slow on this device");
  };

  // FR-DICEX-39: the popup stack in the toast region (its chunk loads at idle, or with the
  // first popup / pending before that).
  const client = useRegistry().client;
  const mount = useRollPopupMount();
  const popupCount = useRollPopups((s) => s.popups.length);
  const popupsState = useSyncExternalStore(popupUi.subscribe, popupUi.state, popupUi.state);
  const popupsShown =
    popupHost(settings) && mount !== null && (popupCount > 0 || pending || popupsState !== "idle");

  // The views chunk loads at idle (or with the first throw / pending before that).
  const busy = current !== null || leaving !== null || pending;
  const viewsShown = display !== "off" && (viewsState !== "idle" || busy);
  return (
    <>
      {viewsShown && (
        <Suspense fallback={null}>
          <LazyViews settings={settings} display={display} onSlow={onSlow} />
        </Suspense>
      )}
      {popupsShown &&
        createPortal(
          <Suspense fallback={null}>
            <LazyPopups client={client} display={display} />
          </Suspense>,
          mount,
        )}
    </>
  );
}

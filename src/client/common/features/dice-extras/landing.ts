// FR-DICEX-49 (ADR-0051): the landing. `holding` = entry id → deadline (arrival + 6 s), filled
// **only** by the live-throw path (`hold`, from the runtime's frame handler): every entry never
// put in (snapshot, resync-only, undo upserts, rows below the window floor) is shown. A held entry
// leaves when no presentation of its dice on this client still moves (§6.1 table D): the big
// throw (its run `moving`; an interrupted run snaps to rest), a popup part (`moving`, the popup
// not closing: miniature, hand-off, chip fade-in) or a throw waiting for the 3D chunk; else at its
// deadline. A resync touches none of these, so a held entry stays held across it; a reload starts
// empty. Client memory only: the server and the frames are unchanged.
import type { GameLogEntryView } from "@shared/dice-roll-log/schemas";
import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { z } from "zod";
import { createStore, type StoreApi } from "zustand";
import { type RollPopups, rollPopups } from "./popups";
import type { DisplaySetting } from "./settings";
import { type DiceExtrasStore, diceExtras } from "./store";
import { POPUP_ROLLING_MAX_MS } from "./timing";

/** A held entry is shown by this long after its arrival at the latest (a stuck animation). */
export const LANDING_MAX_MS = POPUP_ROLLING_MAX_MS;
/** At the landing the numbers fade in over this (§6.1 table E). */
export const LANDING_FADE_MS = 150;

export interface LandingState {
  /** Held entry id → deadline (`timers.now()` ms). */
  holding: ReadonlyMap<string, number>;
}

export interface LandingTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  now(): number;
}

export interface Landing {
  api: StoreApi<LandingState>;
  /** A live frame's entries this client presents (`heldOnArrival`); those nothing moves land now. */
  hold(ids: readonly string[]): void;
  /** A throw of these entries waits for the 3D chunk (FR-DICEX-37): held through the wait. */
  wait(ids: readonly string[]): void;
  /** The wait ended (started, flat, chips or replaced). */
  unwait(ids: readonly string[]): void;
  landed(id: string): boolean;
}

const browserTimers: LandingTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  now: () => performance.now(),
};

export function createLanding(
  throws: Pick<DiceExtrasStore, "api">,
  popups: Pick<RollPopups, "api">,
  timers: LandingTimers = browserTimers,
): Landing {
  const api = createStore<LandingState>()(() => ({ holding: new Map() }));
  const waiting = new Map<string, number>();

  /** Entry ids whose dice still move somewhere on this client. */
  const moving = () => {
    const out = new Set(waiting.keys());
    const t = throws.api.getState();
    for (const r of [t.current, t.leaving]) {
      if (r?.phase === "moving") for (const id of r.t.entryIds) out.add(id);
    }
    for (const p of popups.api.getState().popups) {
      if (p.state === "closing") continue;
      for (const part of Object.values(p.parts)) {
        if (part?.state === "moving") for (const id of part.ids) out.add(id);
      }
    }
    return out;
  };
  const drop = (keep: (id: string) => boolean) => {
    const held = api.getState().holding;
    if (held.size === 0) return;
    const next = new Map([...held].filter(([id]) => keep(id)));
    if (next.size !== held.size) api.setState({ holding: next });
  };
  const sweep = () => {
    if (api.getState().holding.size === 0) return;
    const busy = moving();
    drop((id) => busy.has(id));
  };
  throws.api.subscribe(sweep);
  popups.api.subscribe(sweep);

  return {
    api,
    hold(ids) {
      if (ids.length === 0) return;
      const due = timers.now() + LANDING_MAX_MS;
      const next = new Map(api.getState().holding);
      for (const id of ids) next.set(id, due);
      api.setState({ holding: next });
      const mine = new Set(ids);
      timers.setTimeout(() => drop((id) => !mine.has(id)), LANDING_MAX_MS);
      sweep();
    },
    wait(ids) {
      for (const id of ids) waiting.set(id, (waiting.get(id) ?? 0) + 1);
    },
    unwait(ids) {
      for (const id of ids) {
        const n = (waiting.get(id) ?? 0) - 1;
        if (n > 0) waiting.set(id, n);
        else waiting.delete(id);
      }
      sweep();
    },
    landed: (id) => !api.getState().holding.has(id),
  };
}

const ManualItems = z.array(z.looseObject({ manual: z.boolean() })).min(1);

/** §6.1 table D: every item typed in from physical dice (flat dice, no tumble) → lands on arrival. */
export function manualOnly(e: Pick<GameLogEntryView, "payload">): boolean {
  const items = ManualItems.safeParse(e.payload);
  return items.success && items.data.every((i) => i.manual);
}

/**
 * The live frame's entries to hold (§6.1 table D): none while nothing animates on this device
 * (display `off`, tab hidden) and never a manual-only entry. Reduced motion changes nothing
 * (#247). An entry no presentation picks up (popups off, `others` off) lands at once in `hold`.
 */
export function heldOnArrival(
  entries: readonly GameLogEntryView[],
  display: DisplaySetting,
  tabHidden: boolean,
): string[] {
  if (display === "off" || tabHidden) return [];
  return entries.filter((e) => !manualOnly(e)).map((e) => e.id);
}

/** The page's landing (client memory; a reload starts with nothing held). */
export const landing = createLanding(diceExtras, rollPopups);

export function useHolding(): ReadonlyMap<string, number> {
  const read = () => landing.api.getState().holding;
  return useSyncExternalStore(landing.api.subscribe, read, read);
}

/** FR-DICEX-49: this client's dice of `entryId` have landed (it was never held, or it left). */
export function useLanded(entryId: string): boolean {
  const read = () => !landing.api.getState().holding.has(entryId);
  return useSyncExternalStore(landing.api.subscribe, read, read);
}

/** Every one of `ids` landed (`dicex-popup` `data-landed`). */
export function useAllLanded(ids: readonly string[]): boolean {
  const key = ids.join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `ids`
  const read = useCallback(() => {
    const held = landing.api.getState().holding;
    return ids.every((id) => !held.has(id));
  }, [key]);
  return useSyncExternalStore(landing.api.subscribe, read, read);
}

/**
 * §6.1 table E: at the landing the numbers (`[data-landing]` inside the returned ref's element)
 * fade in over 150 ms. No CSS keyframes: the Web Animations API, skipped where it is missing.
 */
export function useLandingFade<T extends HTMLElement>(landed: boolean) {
  const ref = useRef<T>(null);
  const was = useRef(landed);
  useLayoutEffect(() => {
    if (landed && !was.current) {
      for (const el of ref.current?.querySelectorAll<HTMLElement>("[data-landing]") ?? []) {
        el.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: LANDING_FADE_MS });
      }
    }
    was.current = landed;
  }, [landed]);
  return ref;
}

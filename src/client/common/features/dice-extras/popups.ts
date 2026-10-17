// Roll popups, client memory (FR-DICEX-39–41): one popup per live frame with new `roll` entries,
// on every client that received them (the roller too), ≤ 3 (the oldest closes), "Rolling…" until
// its dice rest, then 6 s (hover / focus pauses), ✕ closes. Its PiP parts: `handoff` = the big
// throw's dice, flown in at its hand-off (the run in `diceExtras` tells when they rest); `play` =
// a miniature on the one canvas; either falls back to chips. Never stored or sent; in the initial
// chunk (the UI is the lazy `RollPopup` chunk).
import type { DiceLook } from "@shared/dice-extras/looks";
import { type DiceThrow, isMeshDie, throwDice } from "@shared/dice-extras/throw";
import type { GameLogEntryView } from "@shared/dice-roll-log/schemas";
import { useSyncExternalStore } from "react";
import { createStore, type StoreApi } from "zustand";
import { ROLL_POPUPS_MAX } from "../play-shell/toast-region";
import { type DiceExtrasStore, diceExtras, type ThrowRun } from "./store";
import { FLAT_IN_MS, POPUP_CLOSE_MS, POPUP_MS, POPUP_ROLLING_MAX_MS } from "./timing";

/**
 * FR-DICEX-41 PiP modes: `handoff` (the big throw's dice fly in), `play` (a miniature on the one
 * canvas: DM-only, FR-DICEX-38; others off, FR-DICEX-43), `chips` (flat, off,
 * no WebGL, tab hidden).
 */
export type PipMode = "handoff" | "play" | "chips";

export interface PipPlan {
  mode: PipMode;
  /** Entries whose dice the big throw hands in. */
  handoff: string[];
  /** Entries whose dice play in miniature (a mixed DM frame: beside the hand-off). */
  play: string[];
}

/**
 * The PiP of a frame's `entryIds`: `big` = the entries of the big 3D throw on this device (null =
 * none plays big); `threeD` = this device draws 3D now (effective display `screen` / `zone`, tab
 * visible).
 */
export function pipPlan(
  entryIds: readonly string[],
  big: readonly string[] | null,
  threeD: boolean,
): PipPlan {
  if (!threeD) return { mode: "chips", handoff: [], play: [] };
  const handoff = entryIds.filter((id) => big?.includes(id));
  const play = entryIds.filter((id) => !big?.includes(id));
  return { mode: play.length > 0 ? "play" : "handoff", handoff, play };
}

export type PartName = "handoff" | "play";

/** One PiP part: its entries' dice, moving until they rest; `chips` = drawn flat instead. */
export interface PipPart {
  ids: string[];
  state: "moving" | "rest";
  chips: boolean;
}

export interface RollPopup {
  /** The frame's first entry id (`data-record-id`). */
  id: string;
  seq: number;
  /** The frame's `roll` entries this client received (rows: `popupRows`, FR-DICEX-40). */
  entries: readonly GameLogEntryView[];
  /** Every received entry's dice (FR-DICEX-41: the throw's list and count). */
  t: DiceThrow;
  looks: Record<string, DiceLook>;
  /** Holds a DM-only entry (DM client only). */
  hidden: boolean;
  /** The big throw's id (its first entry) when its dice hand off here. */
  bigId: string | null;
  parts: Partial<Record<PartName, PipPart>>;
  /** The PiP's still per part: copied pixels (FR-DICEX-41). */
  stills: Partial<Record<PartName, HTMLCanvasElement>>;
  state: "rolling" | "rest" | "closing";
  hovered: boolean;
}

/** `data-mode` of a popup's PiP. */
export function pipModeOf(p: Pick<RollPopup, "parts">): PipMode {
  const { handoff, play } = p.parts;
  if (play && !play.chips) return "play";
  if (handoff && !handoff.chips) return "handoff";
  return "chips";
}

export interface PopupInput {
  /** The frame's new `roll` entries this client received. */
  entries: readonly GameLogEntryView[];
  looks: Record<string, DiceLook>;
  /** The big 3D throw of the frame on this device (null = none). */
  big: { id: string; entryIds: readonly string[] } | null;
  /** This device draws 3D now (`screen` / `zone`, tab visible). */
  threeD: boolean;
}

export interface PopupTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  now(): number;
}

export interface RollPopupsState {
  /** Oldest first. */
  popups: RollPopup[];
}

export interface RollPopups {
  api: StoreApi<RollPopupsState>;
  /** A live frame's popup; returns its id (null: no `roll` entry). */
  add(input: PopupInput): string | null;
  rested(id: string, part: PartName): void;
  /** A part can't draw as planned: its dice play in miniature, or show as chips. */
  fallback(id: string, part: PartName, to: "play" | "chips"): void;
  still(id: string, part: PartName, canvas: HTMLCanvasElement): void;
  hover(id: string, on: boolean): void;
  close(id: string): void;
  /** The popup the big throw `bigId` hands its dice to. */
  ofBig(bigId: string): RollPopup | null;
}

const browserTimers: PopupTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => performance.now(),
};

/**
 * `throws` = the dice-extras store whose runs are the big throws; `threeDReady()` = a miniature
 * can play now (the 3D chunk is loaded).
 */
export function createRollPopups(
  throws: Pick<DiceExtrasStore, "api">,
  threeDReady: () => boolean,
  timers: PopupTimers = browserTimers,
): RollPopups {
  const api = createStore<RollPopupsState>()(() => ({ popups: [] }));
  let seq = 0;
  /** Each popup's close timer and the time it is due (paused: `left` ms). */
  const clocks = new Map<string, { h: unknown; due: number; left: number | null }>();

  const get = (id: string) => api.getState().popups.find((p) => p.id === id) ?? null;
  const patch = (id: string, fn: (p: RollPopup) => RollPopup) =>
    api.setState((s) => ({ popups: s.popups.map((p) => (p.id === id ? fn(p) : p)) }));
  const stop = (id: string) => {
    const c = clocks.get(id);
    if (c) timers.clearTimeout(c.h);
    clocks.delete(id);
  };
  const remove = (id: string) => {
    stop(id);
    api.setState((s) => ({ popups: s.popups.filter((p) => p.id !== id) }));
  };
  const close = (id: string) => {
    const p = get(id);
    if (!p || p.state === "closing") return;
    stop(id);
    patch(id, (x) => ({ ...x, state: "closing" }));
    timers.setTimeout(() => remove(id), POPUP_CLOSE_MS);
  };
  /** The 6 s after rest; `ms` = what is left after a pause. */
  const arm = (id: string, ms: number) => {
    stop(id);
    clocks.set(id, {
      h: timers.setTimeout(() => close(id), ms),
      due: timers.now() + ms,
      left: null,
    });
  };
  const settle = (id: string) => {
    const p = get(id);
    if (p?.state !== "rolling") return;
    if (Object.values(p.parts).some((x) => x?.state === "moving")) return;
    patch(id, (x) => ({ ...x, state: "rest" }));
    if (!p.hovered) arm(id, POPUP_MS);
    else clocks.set(id, { h: null, due: 0, left: POPUP_MS });
  };
  const rested = (id: string, part: PartName) => {
    const p = get(id);
    if (p?.parts[part]?.state !== "moving") return;
    patch(id, (x) => ({
      ...x,
      parts: { ...x.parts, [part]: { ...x.parts[part], state: "rest" } },
    }));
    settle(id);
  };
  const ofBig = (bigId: string) =>
    api.getState().popups.find((p) => p.bigId === bigId && p.state !== "closing") ?? null;

  const fallback = (id: string, part: PartName, to: "play" | "chips") => {
    const p = get(id);
    const from = p?.parts[part];
    if (!p || !from || from.chips) return;
    const chipsLater = () =>
      timers.setTimeout(() => {
        const q = get(id);
        if (q?.parts[part]?.chips) rested(id, part);
      }, FLAT_IN_MS);
    if (to === "chips") {
      patch(id, (x) => ({ ...x, parts: { ...x.parts, [part]: { ...from, chips: true } } }));
      chipsLater();
      return;
    }
    if (part === "play") return;
    // The big throw didn't play here: its dice join the miniature.
    const play = p.parts.play;
    patch(id, (x) => ({
      ...x,
      parts: {
        play: { ids: [...from.ids, ...(play?.ids ?? [])], state: "moving", chips: false },
      },
    }));
  };

  // The big throws: a run at rest → its popup's `handoff` part rests; a run gone while still
  // moving (no zone room, WebGL lost, display changed) → its dice play in miniature, else chips.
  const tracked = new Set<string>();
  const runs = (s: { current: ThrowRun | null; leaving: ThrowRun | null }) =>
    [s.leaving, s.current].filter((r): r is ThrowRun => r !== null);
  throws.api.subscribe((s) => {
    const live = new Set<string>();
    for (const r of runs(s)) {
      const p = ofBig(r.t.id);
      if (!p) continue;
      live.add(r.t.id);
      tracked.add(r.t.id);
      if (r.phase !== "moving" && r.plan.draw === "3d") rested(p.id, "handoff");
    }
    for (const bigId of [...tracked]) {
      if (live.has(bigId)) continue;
      tracked.delete(bigId);
      const p = ofBig(bigId);
      if (p?.parts.handoff?.state === "moving") {
        fallback(p.id, "handoff", threeDReady() ? "play" : "chips");
      }
    }
  });

  return {
    api,
    add({ entries, looks, big, threeD }) {
      const t = throwDice(entries);
      if (!t) return null;
      seq += 1;
      const ids = t.entryIds;
      const plan = pipPlan(ids, big?.entryIds ?? null, threeD);
      const meshOf = (of: string[]) => t.dice.some((d) => of.includes(d.entryId) && isMeshDie(d));
      const parts: RollPopup["parts"] = {};
      if (plan.mode === "chips") parts.play = { ids, state: "moving", chips: true };
      if (plan.handoff.length > 0)
        parts.handoff = { ids: plan.handoff, state: "moving", chips: false };
      if (plan.play.length > 0) {
        // Nothing to tumble (d3, sums): the part is at rest from the start.
        const moving = meshOf(plan.play);
        parts.play = { ids: plan.play, state: moving ? "moving" : "rest", chips: !moving };
      }
      const popup: RollPopup = {
        id: t.id,
        seq,
        entries,
        t,
        looks,
        hidden: t.hidden,
        bigId: plan.handoff.length > 0 ? (big?.id ?? null) : null,
        parts,
        stills: {},
        state: "rolling",
        hovered: false,
      };
      api.setState((s) => ({ popups: [...s.popups.filter((p) => p.id !== t.id), popup] }));
      // FR-DICEX-39: ≤ 3 popups; the oldest closes.
      const open = api.getState().popups.filter((p) => p.state !== "closing");
      for (const old of open.slice(0, Math.max(0, open.length - ROLL_POPUPS_MAX))) remove(old.id);
      if (plan.mode === "chips") {
        timers.setTimeout(() => rested(t.id, "play"), FLAT_IN_MS);
      }
      timers.setTimeout(() => {
        rested(t.id, "handoff");
        rested(t.id, "play");
      }, POPUP_ROLLING_MAX_MS);
      settle(t.id);
      return t.id;
    },
    rested,
    fallback,
    still(id, part, canvas) {
      patch(id, (x) => ({ ...x, stills: { ...x.stills, [part]: canvas } }));
    },
    hover(id, on) {
      const p = get(id);
      if (!p || p.hovered === on) return;
      patch(id, (x) => ({ ...x, hovered: on }));
      if (p.state !== "rest") return;
      const c = clocks.get(id);
      if (on && c && c.left === null) {
        timers.clearTimeout(c.h);
        clocks.set(id, { h: null, due: 0, left: Math.max(0, c.due - timers.now()) });
      } else if (!on) {
        arm(id, c?.left ?? POPUP_MS);
      }
    },
    close,
    ofBig,
  };
}

let readyCheck: () => boolean = () => false;

/** The page's popups (client memory; a reload starts with none, DICEX §11). */
export const rollPopups = createRollPopups(diceExtras, () => readyCheck());
/** The runtime tells the store whether a miniature can play (the 3D chunk is ready). */
export const setThreeDReady = (fn: () => boolean) => {
  readyCheck = fn;
};

export function useRollPopups<T>(selector: (s: RollPopupsState) => T): T {
  const read = () => selector(rollPopups.api.getState());
  return useSyncExternalStore(rollPopups.api.subscribe, read, read);
}

// The PiP slots (FR-DICEX-41): where a popup's hand-off still lands; the throw's flight reads
// the slot's rect when it starts.
const slots = new Map<string, HTMLElement>();
const slotKey = (id: string, part: PartName) => `${id}|${part}`;

export function registerPipSlot(id: string, part: PartName, el: HTMLElement | null): void {
  if (el) slots.set(slotKey(id, part), el);
  else slots.delete(slotKey(id, part));
}

/** The hand-off slot of the popup the big throw `bigId` flies into, or null (none on screen). */
export function handoffSlot(bigId: string): { id: string; el: HTMLElement } | null {
  const p = rollPopups.ofBig(bigId);
  const el = p ? slots.get(slotKey(p.id, "handoff")) : undefined;
  return p && el ? { id: p.id, el } : null;
}

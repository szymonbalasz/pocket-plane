// Roll popups, client memory (FR-DICEX-39–41): one popup per live frame with new `roll` entries,
// on every client that received them (the roller too), ≤ 3 (the oldest closes), "Rolling…" until
// its dice rest, then 6 s, ✕ closes. FR-DICEX-94 (BL-89): at 6 s it closes unless **held** then:
// the pointer moved on it after it showed (and is over it now) or focus went into it; a held
// popup re-checks shortly after a leave / blur and every 1 s; the card's flags clear when it
// unmounts. Root cause (BL-89): the old hover pause trusted `mouseenter` / `focus` to be followed
// by `mouseleave` / `blur` on the same node; a popup that opened under the resting pointer, or
// whose card was replaced (the portal remounting) or moved away while hovered, kept `hovered`
// with its 6 s parked as `left` forever. Its PiP parts: `handoff` = the big throw's dice, flown in
// at its hand-off (the run in `diceExtras` tells when they rest); `play` = a miniature on the one
// canvas; either falls back to chips. Never stored or sent; in the initial chunk (the UI is the
// lazy `RollPopup` chunk).
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
  /** FR-DICEX-46 a: each handed-off die's still (copied pixels) by die key, kept by its cell. */
  stills: Record<string, HTMLCanvasElement>;
  state: "rolling" | "rest" | "closing";
}

/** FR-DICEX-94: while held after its 6 s, a popup re-checks this often. */
export const HOLD_CHECK_MS = 1000;
/**
 * FR-DICEX-94: after a leave / blur an expired popup re-checks this much later (≤ 1 s), so a card
 * that slides from under a following pointer (the stack lifting) isn't lost on the way.
 */
export const LEAVE_CHECK_MS = 300;

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
  /** Hand-off stills by die key (FR-DICEX-46 a). */
  still(id: string, stills: Record<string, HTMLCanvasElement>): void;
  /**
   * FR-DICEX-94: the pointer moved on the card (`true`, a real `pointermove` after it showed) or
   * left it (`false`).
   */
  pointer(id: string, on: boolean): void;
  /** FR-DICEX-94: focus went into the card (`true`) or out of it (`false`). */
  focus(id: string, on: boolean): void;
  /**
   * FR-DICEX-94: the card mounted with its `:hover` check, or unmounted (`null`): either way its
   * pointer and focus flags start clear, so a stale flag never holds it.
   */
  mounted(id: string, over: (() => boolean) | null): void;
  /** FR-DICEX-94: is the popup held now? */
  held(id: string): boolean;
  close(id: string): void;
  /** FR-DICEX-47 short screens: these popups don't fit the toast region; gone at once. */
  drop(ids: readonly string[]): void;
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
  /** Each popup's close timer; `expired` = its 6 s ran out while it was held. */
  const clocks = new Map<string, { h: unknown; expired: boolean }>();
  /** FR-DICEX-94: each card's hold flags and its `:hover` check (client memory, not state). */
  const holds = new Map<string, { pointer: boolean; focus: boolean; over: () => boolean }>();

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
    holds.delete(id);
    api.setState((s) => ({ popups: s.popups.filter((p) => p.id !== id) }));
  };
  const close = (id: string) => {
    const p = get(id);
    if (!p || p.state === "closing") return;
    stop(id);
    patch(id, (x) => ({ ...x, state: "closing" }));
    timers.setTimeout(() => remove(id), POPUP_CLOSE_MS);
  };
  const held = (id: string) => {
    const h = holds.get(id);
    return !!h && ((h.pointer && h.over()) || h.focus);
  };
  /** FR-DICEX-94: the time is up: close, unless held (then check again in 1 s). */
  const expire = (id: string) => {
    const p = get(id);
    if (p?.state !== "rest") return;
    if (!held(id)) {
      close(id);
      return;
    }
    clocks.set(id, { h: timers.setTimeout(() => expire(id), HOLD_CHECK_MS), expired: true });
  };
  /** The 6 s after rest (FR-DICEX-39), whatever the pointer does meanwhile. */
  const arm = (id: string, ms: number) => {
    stop(id);
    clocks.set(id, { h: timers.setTimeout(() => expire(id), ms), expired: false });
  };
  /** FR-DICEX-94: on leave / blur / unmount: an expired popup re-checks shortly (then closes). */
  const recheck = (id: string) => {
    const c = clocks.get(id);
    if (!c?.expired || held(id)) return;
    timers.clearTimeout(c.h);
    clocks.set(id, { h: timers.setTimeout(() => expire(id), LEAVE_CHECK_MS), expired: true });
  };
  const settle = (id: string) => {
    const p = get(id);
    if (p?.state !== "rolling") return;
    if (Object.values(p.parts).some((x) => x?.state === "moving")) return;
    patch(id, (x) => ({ ...x, state: "rest" }));
    arm(id, POPUP_MS);
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
    still(id, stills) {
      patch(id, (x) => ({ ...x, stills: { ...x.stills, ...stills } }));
    },
    pointer(id, on) {
      const h = holds.get(id);
      if (!h || !get(id)) return;
      h.pointer = on;
      if (!on) recheck(id);
    },
    focus(id, on) {
      const h = holds.get(id);
      if (!h || !get(id)) return;
      h.focus = on;
      if (!on) recheck(id);
    },
    mounted(id, over) {
      if (over) holds.set(id, { pointer: false, focus: false, over });
      else holds.delete(id);
      recheck(id);
    },
    held,
    close,
    drop(ids) {
      for (const id of ids) remove(id);
    },
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

// The popup cells (FR-DICEX-46 a): where each handed-off die lands (by die key) and the "+N"
// cell the dice past cell 11 fly into; the throw's flight reads their rects when it starts.
/**
 * A handed-off die's still is its box: the die and a margin (the renderer's crop, 1.25 × its
 * circumradius), so the box is this much bigger than the die; a cell's still overhangs it so.
 */
export const CELL_STILL_PAD = 1.25;
/** The "+N" cell's key. */
export const MORE_CELL = "+N";
const cells = new Map<string, Map<string, HTMLElement>>();

export function registerPopupCell(id: string, key: string, el: HTMLElement | null): void {
  const of = cells.get(id) ?? new Map<string, HTMLElement>();
  if (el) of.set(key, el);
  else of.delete(key);
  if (of.size > 0) cells.set(id, of);
  else cells.delete(id);
}

/** The cells of the popup the big throw `bigId` flies into, or null (none on screen). */
export function handoffCells(
  bigId: string,
): { id: string; cells: ReadonlyMap<string, HTMLElement> } | null {
  const p = rollPopups.ofBig(bigId);
  const of = p ? cells.get(p.id) : undefined;
  return p && of ? { id: p.id, cells: of } : null;
}

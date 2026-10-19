// Pointer overlays of one canvas (ruler, drag target, box select, pings, laser trails): a small store per
// canvas so 20 laser frames/s re-render only the pointer layer. Pings and trails keep their sender
// (FR-MAP-69), so colour and name chip resolve at draw time (FR-MAP-68, -73). DOM-free (testable).

import type { RecordStore } from "@shared/protocol/store";
import { createStore, type StoreApi } from "zustand";
import type { ReadVar } from "../campaign-management/colors";
import type { DragState } from "./drag-preview";
import { LASER_FADE_MS } from "./laser";
import { byAttr, type MarkPerson, markColor, personName } from "./mark-colors";
import type { Box } from "./selection-logic";

/** A ping pulse lasts 2 s (FR-MAP-23). */
export const PING_MS = 2000;

export type SignalRole = "dm" | "player";

/** Store key of this client's own laser trail. */
export const SELF_KEY = "self";

export interface Ping {
  id: number;
  x: number;
  y: number;
  /** The sender (FR-MAP-69): its colour and chip resolve at draw time (FR-MAP-73). */
  from: MarkPerson;
  /** This client's own ping: own colour, no chip. */
  own: boolean;
  at: number;
}

export interface Trail {
  /** Sender key: `dm` or `player:<id>` (or `self`). */
  key: string;
  /** The sender (FR-MAP-68); the own trail (`self`) has no chip. */
  from: MarkPerson;
  points: { x: number; y: number; at: number }[];
  ended: boolean;
}

export interface RulerState {
  from: { col: number; row: number };
  to: { col: number; row: number };
}

export type { DragState } from "./drag-preview";

export interface PointerState {
  ruler: RulerState | null;
  drag: DragState | null;
  /** DM box select in progress (FR-MAP-32), map px. */
  box: Box | null;
  pings: Ping[];
  trails: Record<string, Trail>;
}

export type PointerStore = StoreApi<PointerState>;

export const createPointerStore = (): PointerStore =>
  createStore<PointerState>()(() => ({
    ruler: null,
    drag: null,
    box: null,
    pings: [],
    trails: {},
  }));

let pingSeq = 1;

export function addPing(
  s: PointerStore,
  x: number,
  y: number,
  from: MarkPerson,
  at: number,
  own = false,
) {
  s.setState((st) => ({ pings: [...st.pings, { id: pingSeq++, x, y, from, own, at }] }));
}

export function addTrailPoints(
  s: PointerStore,
  key: string,
  from: MarkPerson,
  points: readonly (readonly [number, number])[],
  end: boolean,
  at: number,
) {
  s.setState((st) => {
    const prev = st.trails[key];
    const base = prev && !prev.ended ? prev.points : [];
    const next: Trail = {
      key,
      from,
      points: [...base, ...points.map(([x, y]) => ({ x, y, at }))],
      ended: end,
    };
    return { trails: { ...st.trails, [key]: next } };
  });
}

/** Drops pings older than 2 s and trail points older than the fade; true if anything is left. */
export function prune(s: PointerStore, now: number): boolean {
  const st = s.getState();
  let changed = false;
  const pings = st.pings.filter((p) => now - p.at < PING_MS);
  if (pings.length !== st.pings.length) changed = true;
  const trails: Record<string, Trail> = {};
  for (const [k, t] of Object.entries(st.trails)) {
    const points = t.points.filter((p) => now - p.at < LASER_FADE_MS);
    if (points.length !== t.points.length) changed = true;
    if (points.length > 0) trails[k] = points.length === t.points.length ? t : { ...t, points };
  }
  if (changed) s.setState({ pings, trails });
  return pings.length > 0 || Object.keys(trails).length > 0;
}

/** Sender key of an incoming signal (`from` is server-stamped). */
export const senderKey = (from: { role: string; playerId?: string | null }) =>
  from.role === "dm" ? "dm" : `player:${from.playerId ?? "?"}`;

/** How a ping or trail draws (FR-MAP-68, -69): the sender's colour, `by` attr and name chip. */
export interface SignalMark {
  /**
   * Konva `id` of the mark, its casing and its chip (MAP §7): the sender key (own marks too, no
   * `self`); a ping adds `:<n>`.
   */
  id: string;
  color: string;
  by: string;
  /** The sender's name ("DM" / player name); null on this client's own marks. */
  chip: string | null;
  opacity: number;
}

type Records = Pick<RecordStore, "you" | "records">;

const markOf = (
  store: Records,
  id: string,
  from: MarkPerson,
  own: boolean,
  opacity: number,
  read?: ReadVar,
): SignalMark => ({
  id,
  color: markColor(store, from, read),
  by: byAttr(from),
  chip: own ? null : personName(store, from),
  opacity,
});

/** FR-MAP-69: a pulse over 2 s; the chip stays for those 2 s (none on the own). */
export function pingMark(p: Ping, store: Records, now: number, read?: ReadVar) {
  const t = Math.min(1, Math.max(0, (now - p.at) / PING_MS));
  return { ...markOf(store, `${senderKey(p.from)}:${p.id}`, p.from, p.own, 1 - t, read), t };
}

/** FR-MAP-68: a trail fades 1 s after its newest point; its chip at the head fades with it. */
export function trailMark(tr: Trail, store: Records, now: number, read?: ReadVar): SignalMark {
  const last = tr.points.at(-1);
  const age = last ? now - last.at : LASER_FADE_MS;
  const opacity = Math.max(0, 1 - age / LASER_FADE_MS);
  return markOf(store, senderKey(tr.from), tr.from, tr.key === SELF_KEY, opacity, read);
}

// Pointer overlays of one canvas (ruler, drag target, pings, laser trails): a small store per
// canvas so 20 laser frames/s re-render only the pointer layer. DOM-free (testable).
import { createStore, type StoreApi } from "zustand";
import { LASER_FADE_MS } from "./laser";

/** A ping pulse lasts 2 s (FR-MAP-23). */
export const PING_MS = 2000;

export type SignalRole = "dm" | "player";

export interface Ping {
  id: number;
  x: number;
  y: number;
  role: SignalRole;
  at: number;
}

export interface Trail {
  /** Sender key: `dm` or `player:<id>` (or `self`). */
  key: string;
  role: SignalRole;
  points: { x: number; y: number; at: number }[];
  ended: boolean;
}

export interface RulerState {
  from: { col: number; row: number };
  to: { col: number; row: number };
}

export interface DragState {
  tokenId: string;
  size: number;
  from: { col: number; row: number };
  to: { col: number; row: number };
}

export interface PointerState {
  ruler: RulerState | null;
  drag: DragState | null;
  pings: Ping[];
  trails: Record<string, Trail>;
}

export type PointerStore = StoreApi<PointerState>;

export const createPointerStore = (): PointerStore =>
  createStore<PointerState>()(() => ({ ruler: null, drag: null, pings: [], trails: {} }));

let pingSeq = 1;

export function addPing(s: PointerStore, x: number, y: number, role: SignalRole, at: number) {
  s.setState((st) => ({ pings: [...st.pings, { id: pingSeq++, x, y, role, at }] }));
}

export function addTrailPoints(
  s: PointerStore,
  key: string,
  role: SignalRole,
  points: readonly (readonly [number, number])[],
  end: boolean,
  at: number,
) {
  s.setState((st) => {
    const prev = st.trails[key];
    const base = prev && !prev.ended ? prev.points : [];
    const next: Trail = {
      key,
      role,
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

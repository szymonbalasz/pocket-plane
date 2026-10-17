// FR-FOG-54 (sprint 4, review A6): the sight preview while a source token is dragged. Map sight
// only: records never change mid-drag (a monster in the previewed sight appears on the drop),
// memory doesn't grow. Per canvas store:
// - `local`: the dragger's preview = the `fog-sight` hint of the newest `map.checkMove` ack (the
//   drag probe, scenes-map); a refused cell has no hint, so the preview stays at the last legal
//   cell. Kept until the drop's `ack` / `reject` or a cancel (Esc, snap-back), however long the
//   pointer rests; dropped on a snapshot or leaving live (the probe resets);
// - `remote`: others' drags = the newest `fog.sight` for T, kept only while this canvas shows T's
//   drag preview (FR-MAP-40), so it drops with it: `map.drag end`, the drop's `TokenMoved`, a
//   snapshot, a scene switch, or 3 s after the last `map.drag` for T (not after the last
//   `fog.sight`); also on leaving live.
// `previewVision` draws a preview **instead of** T's polygons (matched by `src`) in T's owner's
// `vision` record; a record of another player is left alone (V10's party render passes each
// record through it). DOM-free.
import type { FogSightPayload } from "@shared/fog-of-war/schemas";
import { FOG_SIGHT_HINT, type FogSightHint, type MoveHint } from "@shared/scenes-map/schemas";
import { createStore, type StoreApi } from "zustand";
import type { PreviewStore } from "../scenes-map/drag-preview";
import type { DragProbe } from "../scenes-map/drag-probe";
import type { VisionLike } from "./vision-render";

/** One source's polygons (flat grid units, FR-FOG-33). */
export interface SightPolys {
  see: readonly (readonly number[])[];
  dark: readonly (readonly number[])[];
}

export interface SightPreviewState {
  /** This client's own drag (newest `fog-sight` hint). */
  local: ({ tokenId: string } & SightPolys) | null;
  /** Others' drags: tokenId → newest `fog.sight`. */
  remote: Record<string, SightPolys>;
}

export type SightPreviewStore = StoreApi<SightPreviewState>;

export const createSightPreviewStore = (): SightPreviewStore =>
  createStore<SightPreviewState>()(() => ({ local: null, remote: {} }));

const isSight = (h: MoveHint): h is FogSightHint => h.guard === FOG_SIGHT_HINT;

/** The dragger: follows the canvas probe (FR-FOG-54 lifetime). Returns the unsubscribe. */
export function followProbe(s: SightPreviewStore, probe: DragProbe): () => void {
  /** Bumped by every new preview and reset: a drop answered after a newer drag keeps it. */
  let gen = 0;
  return probe.subscribe({
    ack(drag, r) {
      const h = r.hints.filter(isSight).find((x) => x.tokenId === drag.tokenId);
      if (!h) return; // refused or not a source: keep the last legal cell's preview
      gen += 1;
      s.setState({ local: { tokenId: h.tokenId, see: h.see, dark: h.dark } });
    },
    done(tokenId, settled) {
      const g = ++gen;
      settled.then(() => {
        if (g === gen && s.getState().local?.tokenId === tokenId) s.setState({ local: null });
      });
    },
    reset() {
      gen += 1;
      if (s.getState().local !== null) s.setState({ local: null });
    },
  });
}

/** What a receiver needs: the shown scene and whether it shows T's drag preview (FR-MAP-40). */
export interface SightView {
  sceneId: string | null;
  previewing(tokenId: string): boolean;
}

/** A `fog.sight` frame (zod-parsed by the caller): kept only beside T's drag preview. */
export function receiveSight(s: SightPreviewStore, d: FogSightPayload, view: SightView): void {
  if (view.sceneId === null || d.sceneId !== view.sceneId || !view.previewing(d.tokenId)) return;
  s.setState((st) => ({ remote: { ...st.remote, [d.tokenId]: { see: d.see, dark: d.dark } } }));
}

/** Drops every remote preview whose drag preview is gone (end, token change, snapshot, 3 s). */
export function pruneRemote(s: SightPreviewStore, previewing: (tokenId: string) => boolean) {
  const st = s.getState().remote;
  const gone = Object.keys(st).filter((id) => !previewing(id));
  if (gone.length === 0) return;
  const next = { ...st };
  for (const id of gone) delete next[id];
  s.setState({ remote: next });
}

/** Follows the canvas's drag previews (FR-MAP-40). Returns the unsubscribe. */
export function followDrags(s: SightPreviewStore, previews: PreviewStore): () => void {
  return previews.subscribe((st) => pruneRemote(s, (id) => id in st.previews));
}

/** Leaving live: every remote preview goes (the local one goes with the probe's reset). */
export function clearRemote(s: SightPreviewStore): void {
  if (Object.keys(s.getState().remote).length > 0) s.setState({ remote: {} });
}

/** A preview with its token's owner (from the canvas tokens). */
export interface OwnedPreview extends SightPolys {
  tokenId: string;
  ownerPlayerId: string | null;
}

/** The previews in the state, each with its token's owner (unknown token → skipped). */
export function previewList(
  st: SightPreviewState,
  ownerOf: (tokenId: string) => string | null | undefined,
): OwnedPreview[] {
  const out: OwnedPreview[] = [];
  const add = (tokenId: string, p: SightPolys) => {
    const owner = ownerOf(tokenId);
    if (owner !== undefined) out.push({ tokenId, ownerPlayerId: owner, see: p.see, dark: p.dark });
  };
  for (const [id, p] of Object.entries(st.remote)) add(id, p);
  if (st.local) add(st.local.tokenId, st.local);
  return out;
}

/** The `vision` fields the preview reads. */
export interface PreviewableVision extends VisionLike {
  playerId: string;
  src?: readonly string[];
  inv?: readonly number[];
}

type Poly = { poly: readonly number[]; src: string; inv: boolean };

/**
 * FR-FOG-54: `v` with each of its player's previewed tokens' polygons (by `src`) replaced by the
 * preview's; `applied` = those token ids (the `fog-vision` marker's `preview` attr). `inv` is
 * re-indexed (a preview's polygons carry none: the hint has no `inv`, FR-FOG-53). Blind stays only
 * while no polygon is left (a source dragged out of darkness sees).
 */
export function previewVision<V extends PreviewableVision>(
  v: V | null,
  previews: readonly OwnedPreview[],
): { vision: V | null; applied: string[] } {
  if (!v) return { vision: v, applied: [] };
  const mine = previews.filter((p) => p.ownerPlayerId === v.playerId);
  if (mine.length === 0) return { vision: v, applied: [] };
  const ids = new Set(mine.map((p) => p.tokenId));
  const src = v.src ?? [];
  const inv = new Set(v.inv ?? []);
  const n = v.see.length;
  const old = (list: V["see"], base: number): Poly[] =>
    list
      .map((poly, i) => ({ poly, src: src[base + i] ?? "", inv: inv.has(base + i) }))
      .filter((x) => !ids.has(x.src));
  const fresh = (pick: (p: OwnedPreview) => SightPolys["see"]): Poly[] =>
    mine.flatMap((p) => pick(p).map((poly) => ({ poly, src: p.tokenId, inv: false })));
  const see = [...old(v.see, 0), ...fresh((p) => p.see)];
  const dark = [...old(v.dark, n), ...fresh((p) => p.dark)];
  const all = [...see, ...dark];
  const vision: V = {
    ...v,
    blind: v.blind && all.length === 0,
    see: see.map((x) => x.poly as number[]),
    dark: dark.map((x) => x.poly as number[]),
    src: all.map((x) => x.src),
    inv: all.flatMap((x, i) => (x.inv ? [i] : [])),
  };
  return { vision, applied: mine.map((p) => p.tokenId).sort() };
}

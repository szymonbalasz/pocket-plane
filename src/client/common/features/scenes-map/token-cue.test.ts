// FR-MAP-49: transient token cue (decoration merge, geometry, pulse) and overlay subscriptions.
import { describe, expect, test } from "bun:test";
import { emptyStore } from "@shared/protocol/store";
import type { TokenView } from "@shared/scenes-map/schemas";
import { decorateToken, plainDecoration, subscribeOverlays } from "./decorations";
import { CUE_PERIOD_MS, cueGeometry, cuePulse } from "./token-decor";
import type { TokenOverlay, TokenOverlayView } from "./token-overlays";

const view: TokenOverlayView = { client: "dm", selected: false, targeting: false };
const t = { id: "mira", col: 1, row: 1, size: "medium" } as TokenView;

describe("FR-MAP-49 token cue", () => {
  test("merge: first non-null cue wins; plain tokens have none; a throw is ignored", () => {
    const errors: string[] = [];
    const overlays: TokenOverlay[] = [
      {
        id: "boom",
        decorate: () => {
          throw new Error("x");
        },
      },
      { id: "dim", decorate: () => ({ dim: true }) },
      {
        id: "note",
        decorate: () => ({ cue: { id: "note-token-cue", label: "Mira: save DC 10" } }),
      },
      { id: "late", decorate: () => ({ cue: { id: "late-cue", label: "later" } }) },
    ];
    const d = decorateToken(overlays, t, emptyStore(), view, (id) => errors.push(id));
    expect(d.cue).toEqual({ id: "note-token-cue", label: "Mira: save DC 10" });
    expect(d.dim).toBe(true);
    expect(errors).toEqual(["boom"]);
    expect(plainDecoration.cue).toBeNull();
    expect(decorateToken([overlays[1] as TokenOverlay], t, emptyStore(), view).cue).toBeNull();
  });

  test("geometry: ring just outside the art, bell on the top-right corner; scales with the footprint", () => {
    const g = cueGeometry(70);
    expect(g.ring).toMatchObject({ x: 35, y: 35 });
    expect(g.ring.radius).toBeGreaterThan(35);
    expect(g.bell).toMatchObject({ x: 70, y: 0 });
    expect(cueGeometry(140).ring.radius).toBeCloseTo(g.ring.radius * 2);
  });

  test("pulse: opacity 1 → 0.35 → 1 over a period; reduced motion → steady ring", () => {
    expect(cuePulse(0, false)).toEqual({ opacity: 1, scale: 1 });
    const mid = cuePulse(CUE_PERIOD_MS / 2, false);
    expect(mid.opacity).toBeCloseTo(0.35);
    expect(mid.scale).toBeCloseTo(1.12);
    expect(cuePulse(CUE_PERIOD_MS, false).opacity).toBeCloseTo(1);
    for (const ms of [0, 300, 600, 900])
      expect(cuePulse(ms, true)).toEqual({ opacity: 1, scale: 1 });
  });
});

describe("FR-MAP-49 overlay subscribe", () => {
  test("once per overlay with `subscribe`; onChange re-runs decorations; one unsubscribe for all", () => {
    let cueOn = false;
    const listeners = new Set<() => void>();
    const timer: TokenOverlay = {
      id: "note",
      decorate: () => (cueOn ? { cue: { id: "note-token-cue", label: "L" } } : null),
      subscribe(onChange) {
        listeners.add(onChange);
        return () => listeners.delete(onChange);
      },
    };
    const plain: TokenOverlay = { id: "plain", decorate: () => null };
    let redraws = 0;
    let deco = decorateToken([plain, timer], t, emptyStore(), view);
    const off = subscribeOverlays([plain, timer], () => {
      redraws++;
      deco = decorateToken([plain, timer], t, emptyStore(), view);
    });
    expect(listeners.size).toBe(1);
    expect(deco.cue).toBeNull();
    cueOn = true;
    for (const l of listeners) l();
    expect(redraws).toBe(1);
    expect(deco.cue?.id).toBe("note-token-cue");
    cueOn = false;
    for (const l of listeners) l();
    expect(deco.cue).toBeNull();
    off();
    expect(listeners.size).toBe(0);
  });

  test("a throwing subscribe (or unsubscribe) is reported and ignored; the others still subscribe", () => {
    const errors: string[] = [];
    let subscribed = 0;
    const overlays: TokenOverlay[] = [
      {
        id: "bad",
        subscribe: () => {
          throw new Error("x");
        },
      },
      {
        id: "bad-off",
        subscribe: () => () => {
          throw new Error("y");
        },
      },
      {
        id: "good",
        subscribe: () => {
          subscribed++;
          return () => {
            subscribed--;
          };
        },
      },
    ];
    const off = subscribeOverlays(
      overlays,
      () => {},
      (id) => errors.push(id),
    );
    expect(subscribed).toBe(1);
    off();
    expect(subscribed).toBe(0);
    expect(errors).toEqual(["bad", "bad-off"]);
  });
});

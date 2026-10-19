// A 3D throw run (FR-DICEX-14, -15, -20, -23, -34, -35, -41, -46), drawn by the lazy chunk's
// renderer on the dice layer's one canvas at its arena rect (the viewport, or the zone's dice
// area). At its hand-off the rested dice are copied off the canvas one by one; each die flies to
// its popup cell, scaling to it and turning its value upright (0.4 s), and the cell keeps its
// pixels; dice past cell 11 fly into "+N" and fade. With no popup on screen (or popups off) the still fades out. Dice data stays in the DOM for walkthroughs: one hidden `dicex-throw-die` per 3D die
// with `data-settled` = the up-face read from the rendered mesh at rest. MOD / offered dice get a
// label under the die at rest.
import type { DiceLook } from "@shared/dice-extras/looks";
import { STYLE_LOOK } from "@shared/dice-extras/looks";
import { isMeshDie, type ThrowDie } from "@shared/dice-extras/throw";
import { type RefObject, useEffect, useRef, useState } from "react";
import { type Arena, arenaOf, dieSizePx, screenArena, shadowsFor } from "./arena";
import type { PlayHandle, Rect, RestInfo, Still } from "./dice3d/index";
import { rectOf } from "./layer-host";
import { dice3d } from "./lazy3d";
import { CELL_STILL_PAD, handoffCells, MORE_CELL, rollPopups } from "./popups";
import { diceExtras, type ThrowRun } from "./store";
import { FADE_MS, HANDOFF_MS } from "./timing";

export { isMeshDie };

/** FR-DICEX-23: a median frame time above this switches the device to flat. */
export const SLOW_FRAME_MS = 33;

/** FR-DICEX-23 / -44: the throw was slow (null = too few frames to judge). */
export const isSlow = (medianFrameMs: number | null) =>
  medianFrameMs !== null && medianFrameMs > SLOW_FRAME_MS;

const viewport = () => ({ w: globalThis.innerWidth || 1, h: globalThis.innerHeight || 1 });

/** FR-DICEX-33: the screen arena's rect = the viewport. */
export const viewportRect = (): Rect => ({ x: 0, y: 0, ...viewport() });

/** The arena of a run: the viewport's, or the zone's dice area with the screen's die size. */
function arenaFor(arena: ThrowRun["plan"]["arena"], r: Rect): Arena {
  return arena === "screen" ? screenArena(r) : arenaOf(r, dieSizePx(viewport()));
}

/**
 * Plays `run` on the layer canvas in `host` at `rect()` (read every frame), reports rest to the
 * store, and hands off at the run's `handoff` / `fading` phase. Returns the rest info.
 */
export function useRun3D(
  run: ThrowRun,
  dice: readonly ThrowDie[],
  host: RefObject<HTMLDivElement | null>,
  rect: () => Rect | null,
  onSlow: () => void,
): RestInfo | null {
  const [rest, setRest] = useState<RestInfo | null>(null);
  const handle = useRef<PlayHandle | null>(null);
  const stills = useRef<HTMLCanvasElement[]>([]);
  const input = useRef({ run, dice, rect, onSlow });
  input.current = { run, dice, rect, onSlow };
  const { seq } = run;

  // Once per run: settle headless in the arena, then play (FR-DICEX-34).
  useEffect(() => {
    const mod = dice3d.module();
    const layer = host.current;
    const { run: r, dice: ds, rect: rectOf } = input.current;
    const start = rectOf();
    let slow = false;
    if (!mod || !layer || !start) {
      diceExtras.flat(seq);
      return;
    }
    try {
      handle.current = mod.playThrow({
        layer,
        rect: () => input.current.rect() ?? start,
        arena: arenaFor(r.plan.arena, start),
        shadows: shadowsFor(viewport()),
        seed: mod.seedOf(r.t.seedId),
        dice: ds.map((d) => ({
          key: d.key,
          shape: d.shape as NonNullable<ThrowDie["shape"]>,
          ...(d.d100 && { d100: d.d100 }),
          value: d.value as number,
          kept: d.kept,
          look: r.looks[d.entryId] ?? STYLE_LOOK.ivory,
        })),
        onRest: (info) => {
          setRest(info);
          diceExtras.rested(seq);
          slow = isSlow(info.medianFrameMs);
        },
        onLost: () => diceExtras.flat(seq),
      });
    } catch (err) {
      console.warn("Dice: WebGL could not start; showing flat dice.", err);
      diceExtras.flat(seq);
    }
    return () => {
      handle.current?.stop();
      handle.current = null;
      for (const c of stills.current) c.remove();
      stills.current = [];
      // Unmounted before its end (the display changed): the run shows flat in the zone.
      const s = diceExtras.api.getState();
      if (s.current?.seq === seq || s.leaving?.seq === seq) diceExtras.flat(seq);
      // FR-DICEX-23: a slow throw finishes as it is; the device turns flat once it has gone.
      if (slow) input.current.onSlow();
    };
  }, [seq, host]);

  // FR-DICEX-18: a newer throw (or the rest timer) ended the motion: snap, then hand off.
  const leaving = run.phase === "handoff" || run.phase === "fading";
  useEffect(() => {
    if (run.phase === "rest") handle.current?.snap();
    if (!leaving || !handle.current) return;
    const s = handle.current.handoff();
    handle.current = null;
    const layer = host.current;
    if (!s || !layer) return;
    const ms = run.phase === "handoff" ? HANDOFF_MS : FADE_MS;
    // FR-DICEX-35 / -46 a: each die flies to its popup cell, which keeps its pixels.
    const target = run.phase === "handoff" ? handoffCells(run.t.id) : null;
    if (target && s.dice) {
      const flown = flyToCells(s, s.dice, target.cells, layer, ms);
      stills.current = [...flown.values()].map((f) => f.canvas);
      setTimeout(() => {
        // The cells keep upright copies (the flown canvases go with the run).
        const kept: Record<string, HTMLCanvasElement> = {};
        for (const [key, f] of flown) if (!f.fade) kept[key] = turned(f.canvas, f.turn);
        rollPopups.still(target.id, kept);
      }, ms);
      return;
    }
    stills.current = [s.canvas];
    layer.appendChild(s.canvas);
    const el = s.canvas;
    el.style.transition = `opacity ${ms}ms ease-in, transform ${ms}ms ease-in`;
    el.style.transformOrigin = "100% 100%";
    // Next frame: from the copied pixels to gone (D7 swaps this for the flight into its PiP).
    requestAnimationFrame(() => {
      el.style.opacity = "0";
      if (run.phase === "handoff") el.style.transform = "scale(0.6)";
    });
  }, [run.phase, leaving, host, run.t.id]);

  return rest;
}

/** One die's flight: centre to its cell's (or "+N"'s, fading), scaled, turned upright. */
export interface Flight {
  to: Rect;
  fade: boolean;
  /** Centre to centre (px). */
  dx: number;
  dy: number;
  k: number;
  /** Screen turn (radians, clockwise) standing the value upright. */
  turn: number;
}

/**
 * FR-DICEX-46 a: each rested die's flight from its `boxes` rect (the die and a margin,
 * `CELL_STILL_PAD`) to its cell (`cells` by die key, viewport rects): the die spans the cell
 * (44 px, a full-size die), turned upright (`turns`); a die without a cell flies into `more`
 * ("+N") and fades. Pure.
 */
export function handoffFlights(
  boxes: Record<string, Rect>,
  cells: ReadonlyMap<string, Rect>,
  more: Rect | null,
  turns: Record<string, number> = {},
): Map<string, Flight> {
  const out = new Map<string, Flight>();
  for (const [key, box] of Object.entries(boxes)) {
    const cell = cells.get(key);
    const to = cell ?? more;
    if (!to || to.w <= 0 || to.h <= 0 || box.w <= 0 || box.h <= 0) continue;
    const k = Math.min(to.w / box.w, to.h / box.h) * CELL_STILL_PAD;
    out.set(key, {
      to,
      fade: !cell,
      k,
      dx: to.x + to.w / 2 - (box.x + box.w / 2),
      dy: to.y + to.h / 2 - (box.y + box.h / 2),
      turn: cell ? (turns[key] ?? 0) : 0,
    });
  }
  return out;
}

/** A copy of `src` turned by `turn` radians about its centre (an upright still). */
function turned(src: HTMLCanvasElement, turn: number): HTMLCanvasElement {
  if (turn === 0) return src;
  const c = src.ownerDocument.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d");
  if (!ctx) return src;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(turn);
  ctx.drawImage(src, -c.width / 2, -c.height / 2);
  return c;
}

/**
 * FR-DICEX-46 a: put each die's own still (`dice`, drawn alone) on the layer where it rested and
 * fly it to its cell (`cells` by die key), scaled to the cell and turned upright; a die without a
 * cell flies into "+N" and fades. Returns the flights with their canvases by die key.
 */
function flyToCells(
  s: Still,
  dice: Record<string, Still>,
  cells: ReadonlyMap<string, HTMLElement>,
  layer: HTMLElement,
  ms: number,
): Map<string, Flight & { canvas: HTMLCanvasElement }> {
  const out = new Map<string, Flight & { canvas: HTMLCanvasElement }>();
  const rects = new Map<string, Rect>();
  for (const [key, el] of cells) {
    const r = key === MORE_CELL ? null : rectOf(el);
    if (r) rects.set(key, r);
  }
  const boxes = Object.fromEntries(Object.entries(dice).map(([key, d]) => [key, d.rect]));
  const flights = handoffFlights(boxes, rects, rectOf(cells.get(MORE_CELL) ?? null), s.turns);
  for (const [key, f] of flights) {
    const c = (dice[key] as Still).canvas;
    layer.appendChild(c);
    c.style.transformOrigin = "50% 50%";
    c.style.transition = `transform ${ms}ms ease-in-out${f.fade ? `, opacity ${ms}ms ease-in` : ""}`;
    requestAnimationFrame(() => {
      c.style.transform = `translate(${f.dx}px, ${f.dy}px) rotate(${f.turn}rad) scale(${f.k})`;
      if (f.fade) c.style.opacity = "0";
    });
    out.set(key, { ...f, canvas: c });
  }
  return out;
}

/**
 * The DOM mirror of a 3D run: hidden dice with `data-settled` at rest, and MOD / offered labels
 * under their dice (positions from the arena rect's top-left).
 */
export function Mirror3D({
  dice,
  looks,
  rest,
}: {
  dice: readonly ThrowDie[];
  looks: Record<string, DiceLook>;
  rest: RestInfo | null;
}) {
  return (
    <>
      {dice.map((d) => (
        <span
          key={d.key}
          data-testid="dicex-throw-die"
          data-entry-id={d.entryId}
          data-faces={d.faces}
          data-value={d.value ?? ""}
          data-kept={d.kept}
          data-flat={false}
          data-offered={d.offered === true}
          data-style={(looks[d.entryId] ?? STYLE_LOOK.ivory).style}
          data-material={(looks[d.entryId] ?? STYLE_LOOK.ivory).material}
          {...(rest && { "data-settled": rest.settled[d.key] ?? "" })}
          className="sr-only"
        />
      ))}
      {rest &&
        dice
          .filter((d) => d.label || d.offered)
          .map((d) => {
            const at = rest.at[d.key];
            if (!at) return null;
            return (
              <span
                key={d.key}
                className="absolute max-w-20 -translate-x-1/2 truncate rounded bg-background/80 px-1 text-[10px] leading-tight text-muted-foreground"
                style={{ left: at.x, top: at.y + 22 }}
              >
                {d.sign === -1 && "−"}
                {d.offered ? `${d.label ?? ""} on a hit` : d.label}
              </span>
            );
          })}
    </>
  );
}

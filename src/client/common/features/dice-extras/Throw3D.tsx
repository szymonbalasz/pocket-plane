// A 3D throw run (FR-DICEX-14, -15, -20, -23, -34, -35, -41), drawn by the lazy chunk's renderer
// on the dice layer's one canvas at its arena rect (the viewport, or the zone's dice area). At its
// hand-off the rested dice are copied into a still on the layer that shrinks and flies into its
// popup's PiP (0.4 s), which keeps the pixels; with no popup on screen (or popups off) the still
// fades out. Dice data stays in the DOM for walkthroughs: one hidden `dicex-throw-die` per 3D die
// with `data-settled` = the up-face read from the rendered mesh at rest. MOD / offered dice get a
// label under the die at rest.
import type { DiceLook } from "@shared/dice-extras/looks";
import { STYLE_LOOK } from "@shared/dice-extras/looks";
import { isMeshDie, type ThrowDie } from "@shared/dice-extras/throw";
import { type RefObject, useEffect, useRef, useState } from "react";
import { type Arena, arenaOf, dieSizePx, screenArena, shadowsFor } from "./arena";
import type { PlayHandle, Rect, RestInfo } from "./dice3d/index";
import { rectOf } from "./layer-host";
import { dice3d } from "./lazy3d";
import { handoffSlot, rollPopups } from "./popups";
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
  const still = useRef<HTMLCanvasElement | null>(null);
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
      still.current?.remove();
      still.current = null;
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
    still.current = s.canvas;
    layer.appendChild(s.canvas);
    const ms = run.phase === "handoff" ? HANDOFF_MS : FADE_MS;
    const el = s.canvas;
    // FR-DICEX-35 / -41 a: shrink and fly into the popup's PiP, which keeps the pixels.
    const target = run.phase === "handoff" ? handoffSlot(run.t.id) : null;
    const to = target && rectOf(target.el);
    if (target && to && to.w > 0 && to.h > 0) {
      const k = Math.min(1, to.w / s.rect.w, to.h / s.rect.h);
      const dx = to.x + (to.w - s.rect.w * k) / 2 - s.rect.x;
      const dy = to.y + (to.h - s.rect.h * k) / 2 - s.rect.y;
      el.style.transformOrigin = "0 0";
      el.style.transition = `transform ${ms}ms ease-in-out`;
      requestAnimationFrame(() => {
        el.style.transform = `translate(${dx}px, ${dy}px) scale(${k})`;
      });
      setTimeout(() => rollPopups.still(target.id, "handoff", el), ms);
      return;
    }
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

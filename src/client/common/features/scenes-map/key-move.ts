// Arrow keys move what a drag would move (FR-MAP-124, FR-OVW-49), for the map and the overview: which
// way a key points, the pacing of steps, whom a player's keys move and the camera keeping up. Each
// canvas sends its own intents; the server has the last word, as on a drop.
import { useEffect, useRef, useState } from "react";
import { pauseGate } from "../pause/gate";
import { useBaseKeyDown } from "../play-shell/hooks";
import type { Box, Camera } from "./camera";

export interface KeyStep {
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
}

const ARROWS: Readonly<Record<string, KeyStep>> = {
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
};

/** The step of a plain arrow key; with a modifier it stays the browser's (Alt+← is Back). */
export function arrowStep(e: {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): KeyStep | null {
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return null;
  return ARROWS[e.key] ?? null;
}

/** A held key steps at most this often: the keyboard's own repeat (~30 a second) is too quick to steer. */
export const REPEAT_MS = 120;

/** Presses waiting behind a step on its way; quick taps on a slow connection all count. */
const QUEUE_MAX = 8;

/** What one step sends; null = nothing to do (at the edge, no target). A rejection is its toast. */
export type SendStep = (step: KeyStep) => Promise<unknown> | null;

/**
 * Steps go one at a time, each after the last one's answer, so the next starts from where the
 * server put the token. A rejected step ends the run: what was waiting is dropped and a held key
 * does nothing more (one toast at a wall, not thirty) until the key is pressed afresh.
 */
export class KeySteps {
  private busy = false;
  private stopped = false;
  private queue: KeyStep[] = [];
  private lastAt = Number.NEGATIVE_INFINITY;
  private run = 0;

  constructor(private readonly send: SendStep) {}

  press(step: KeyStep, repeat: boolean, now: number): void {
    if (repeat) {
      if (this.stopped || this.busy || now - this.lastAt < REPEAT_MS) return;
    } else {
      this.stopped = false;
    }
    if (this.busy) {
      if (this.queue.length < QUEUE_MAX) this.queue.push(step);
      return;
    }
    this.lastAt = now;
    this.go(step);
  }

  /** Another scene or overview: what was waiting belonged to the last one. */
  reset(): void {
    this.run++;
    this.busy = false;
    this.stopped = false;
    this.queue = [];
  }

  private go(step: KeyStep): void {
    const sent = this.send(step);
    if (!sent) {
      this.next();
      return;
    }
    this.busy = true;
    const run = this.run;
    sent.then(
      () => {
        if (run !== this.run) return;
        this.busy = false;
        this.next();
      },
      () => {
        if (run !== this.run) return;
        this.busy = false;
        this.stopped = true;
        this.queue = [];
      },
    );
  }

  private next(): void {
    const step = this.queue.shift();
    if (step) this.go(step);
  }
}

/**
 * Whom a player's keys move, as they have no selection: the own token they last pressed, else
 * their character's, else the first of their own.
 */
export function ownKeyTarget<T extends { id: string; characterId?: string | null }>(
  own: readonly T[],
  lastPressed: string | null,
): T | null {
  return own.find((t) => t.id === lastPressed) ?? own.find((t) => t.characterId) ?? own[0] ?? null;
}

/** The smallest pan that brings `box` (map units) inside `area` (screen px); bigger than it: none. */
export function panToShow(cam: Camera, box: Box, area: Box): Camera {
  const along = (at: number, start: number, side: number, from: number, room: number) => {
    const low = at + start * cam.scale;
    const high = low + side * cam.scale;
    if (high - low > room) return at;
    if (low < from) return at + from - low;
    return high > from + room ? at + from + room - high : at;
  };
  const x = along(cam.x, box.x, box.w, area.x, area.w);
  const y = along(cam.y, box.y, box.h, area.y, area.h);
  return x === cam.x && y === cam.y ? cam : { ...cam, x, y };
}

/** `box` with `by` map units more on every side: a step ahead stays in view. */
export const grownBy = (box: Box, by: number): Box => ({
  x: box.x - by,
  y: box.y - by,
  w: box.w + 2 * by,
  h: box.h + 2 * by,
});

/**
 * Routes the arrow keys of the base layer (never from a window, dialog or field, FR-SHELL-13).
 * `scope` is what the canvas shows; `hasTargets` keeps the keys the browser's when nothing would
 * move. `step` is read when it runs, as a waiting step runs after later renders.
 */
export function useArrowSteps(scope: string, hasTargets: () => boolean, step: SendStep): void {
  const stepRef = useRef(step);
  stepRef.current = step;
  const [steps] = useState(() => new KeySteps((s) => stepRef.current(s)));
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new scope drops what was waiting.
  useEffect(() => steps.reset(), [steps, scope]);
  useBaseKeyDown((e) => {
    const s = arrowStep(e);
    if (!s || pauseGate.paused() || !hasTargets()) return;
    e.preventDefault();
    steps.press(s, e.repeat, performance.now());
  });
}

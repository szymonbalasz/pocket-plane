// Laser sender (FR-MAP-24): batches pointer points into `map.laser` frames, ≤ 20 sends/s and
// ≤ 32 points each (older points of an over-full batch are dropped: the trail fades anyway).
import { LASER_POINTS_MAX, LASER_SENDS_PER_S, type LaserData } from "@shared/scenes-map/schemas";

export interface LaserTimers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

const browserTimers: LaserTimers = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as number),
};

export const LASER_INTERVAL_MS = 1000 / LASER_SENDS_PER_S;
/** A trail fades 1 s after its last point (FR-MAP-24). */
export const LASER_FADE_MS = 1000;

export class LaserSender {
  private buffer: [number, number][] = [];
  private lastSend = Number.NEGATIVE_INFINITY;
  private timer: unknown = null;

  constructor(
    private readonly sceneId: string,
    private readonly send: (data: LaserData) => void,
    private readonly timers: LaserTimers = browserTimers,
  ) {}

  push(x: number, y: number): void {
    this.buffer.push([x, y]);
    if (this.buffer.length > LASER_POINTS_MAX)
      this.buffer.splice(0, this.buffer.length - LASER_POINTS_MAX);
    const wait = this.lastSend + LASER_INTERVAL_MS - this.timers.now();
    if (wait <= 0) this.flush(false);
    else if (this.timer === null) {
      this.timer = this.timers.setTimeout(() => {
        this.timer = null;
        this.flush(false);
      }, wait);
    }
  }

  /** Pointer released: send what is left with `end: true` (still within the send budget). */
  end(): void {
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
    const wait = this.lastSend + LASER_INTERVAL_MS - this.timers.now();
    if (wait <= 0) this.flush(true);
    else this.timer = this.timers.setTimeout(() => this.flush(true), wait);
  }

  private flush(end: boolean): void {
    if (this.buffer.length === 0 && !end) return;
    const points = this.buffer;
    this.buffer = [];
    this.lastSend = this.timers.now();
    this.send(
      end ? { sceneId: this.sceneId, points, end: true } : { sceneId: this.sceneId, points },
    );
  }
}

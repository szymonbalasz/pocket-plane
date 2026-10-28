// Test seam: a recording 2D context (every method call and property set, in order) with the
// farthest point any path or sprite reached from a centre. DOM-free; tests and the FX bench.

export interface RecordingCtx {
  ctx: CanvasRenderingContext2D;
  calls: string[];
  /** Farthest distance from (cx, cy) any drawn point or sprite edge reached. */
  reach(cx: number, cy: number): number;
  clear(): void;
}

export function recordingCtx(record = true): RecordingCtx {
  const calls: string[] = [];
  const pts: [number, number, number][] = [];
  const point = (x: number, y: number, r = 0) => pts.push([x, y, r]);
  const methods: Record<string, (...a: number[]) => void> = {
    moveTo: (x, y) => point(x as number, y as number),
    lineTo: (x, y) => point(x as number, y as number),
    arc: (x, y, r) => point(x as number, y as number, r as number),
    rect: (x, y, w, h) => {
      point(x as number, y as number);
      point((x as number) + (w as number), (y as number) + (h as number));
    },
    fillRect: (x, y, w, h) => {
      point(x as number, y as number);
      point((x as number) + (w as number), (y as number) + (h as number));
    },
    quadraticCurveTo: (cx, cy, x, y) => {
      point(cx as number, cy as number);
      point(x as number, y as number);
    },
  };
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(_t, key: string) {
      if (key in target) return target[key];
      return (...args: unknown[]) => {
        if (record)
          calls.push(
            `${key}(${args.map((a) => (typeof a === "number" ? a.toFixed(3) : typeof a)).join(",")})`,
          );
        if (key === "drawImage") {
          const [, x, y, w, h] = args as number[];
          point(
            (x as number) + (w as number) / 2,
            (y as number) + (h as number) / 2,
            (w as number) / 2,
          );
          return;
        }
        methods[key]?.(...(args as number[]));
      };
    },
    set(_t, key: string, value) {
      target[key] = value;
      if (record)
        calls.push(`${key}=${typeof value === "number" ? value.toFixed(3) : String(value)}`);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return {
    ctx,
    calls,
    reach(cx, cy) {
      let max = 0;
      for (const [x, y, r] of pts) max = Math.max(max, Math.hypot(x - cx, y - cy) + r);
      return max;
    },
    clear() {
      calls.length = 0;
      pts.length = 0;
    },
  };
}

// Registry-driven facts for the Recap window (FR-RECAP-10, -21), asserted by each client's
// `features/session-recap/windows.test.ts` on its own registry. Test support, no React.
import type { You } from "@shared/protocol/frames";
import { RECAP_WINDOW_KIND } from "@shared/session-recap/schemas";
import { clampRect, type Rect, TOP_BAR_H, workArea } from "../play-shell/geometry";
import { defaultLayout, type OpenBy, reduce } from "../play-shell/manager";
import { defaultSizeAt, type WindowRegistry } from "../play-shell/registry";
import { viewKey } from "../stats/view";
import { createRecapViews, openRecap } from "./open";

/** FR-RECAP-10: the registered def's facts. */
export function recapDefFacts(registry: WindowRegistry) {
  const d = registry.get(RECAP_WINDOW_KIND);
  return d
    ? {
        title: d.title,
        default720: defaultSizeAt(d, { w: 1280, h: 720 }),
        default900: defaultSizeAt(d, { w: 1440, h: 900 }),
        minSize: d.minSize,
        usefulSize: d.usefulSize,
        defaultOpen: d.defaultOpen ?? false,
        launcher: d.launcher ?? null,
        companion: d.companion !== undefined,
      }
    : null;
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Opened on the default layout: inside the work area; the open product windows it covers. */
export function recapOnDefaults(registry: WindowRegistry, vp: { w: number; h: number }) {
  const ctx = { registry, viewport: vp, available: new Set(registry.defs.map((d) => d.kind)) };
  const ws = reduce(defaultLayout(registry, vp), { type: "open", kind: RECAP_WINDOW_KIND }, ctx);
  const rects = ws
    .filter((w) => w.state === "open")
    .map((w) => ({ kind: w.kind, ...clampRect(w, vp) }));
  const r = rects.find((x) => x.kind === RECAP_WINDOW_KIND) as Rect;
  const area = workArea(vp);
  return {
    inside: r.x >= 0 && r.y >= TOP_BAR_H && r.x + r.w <= area.w && r.y + r.h <= TOP_BAR_H + area.h,
    size: { w: r.w, h: r.h },
    covers: rects.filter((o) => o.kind !== RECAP_WINDOW_KIND && overlaps(o, r)).map((o) => o.kind),
  };
}

/** FR-RECAP-21 / FR-STATS-79 / FR-RECAP-28: `openRecap(7, by)` on a closed, a minimised and an open window. */
export function openRecapRuns(registry: WindowRegistry, you: You, by: OpenBy) {
  const vp = { w: 1440, h: 900 };
  const ctx = { registry, viewport: vp, available: new Set(registry.defs.map((d) => d.kind)) };
  const base = defaultLayout(registry, vp);
  const opened = reduce(base, { type: "open", kind: RECAP_WINDOW_KIND }, ctx);
  const covered = reduce(opened, { type: "open", kind: "cmp.compendium" }, ctx);
  const minimised = reduce(opened, { type: "minimise", kind: RECAP_WINDOW_KIND }, ctx);
  return (
    [
      ["closed", base],
      ["minimised", minimised],
      ["open", covered],
    ] as const
  ).map(([before, ws]) => {
    const views = createRecapViews();
    let next = ws;
    const calls: { kind: string; by: string | undefined }[] = [];
    openRecap(7, {
      you,
      views,
      by,
      open: (kind, instance, opts) => {
        calls.push({ kind, by: opts?.by });
        next = reduce(next, { type: "open", kind, instance, by: opts?.by }, ctx);
      },
    });
    const win = next.find((w) => w.kind === RECAP_WINDOW_KIND);
    return {
      before,
      calls,
      state: win?.state,
      onTop: win?.z === Math.max(...next.map((w) => w.z)),
      view: views.get(viewKey(you)),
    };
  });
}

// Registry-driven facts for `party.summary` (FR-SHELL-140–143, CB3), asserted by each client's
// `features/party-board/summary-window.test.ts` on its own registry. Test support, no React.
import { clampRect, type Rect } from "../play-shell/geometry";
import { fitLauncher, launcherMetrics } from "../play-shell/launcher-fit";
import { defaultLayout, reduce } from "../play-shell/manager";
import type { WindowRegistry } from "../play-shell/registry";
import { REPLAY_SETS } from "../play-shell/replay";
import { PENDING_ROWS, SIZE_TABLE } from "../play-shell/size-table";
import { PARTY_BOARD_KIND } from "./logic";
import { PARTY_SUMMARY_KIND } from "./summary-logic";

export const REFERENCE_SIZES = [
  { w: 1280, h: 720 },
  { w: 1280, h: 800 },
  { w: 1440, h: 900 },
  { w: 1600, h: 900 },
];

/** FR-SHELL-140 / -141: the def's registration facts. */
export function summaryRegistration(registry: WindowRegistry) {
  const def = registry.get(PARTY_SUMMARY_KIND);
  const launchers = registry.defs
    .filter((d) => d.launcher)
    .sort((a, b) => (a.launcher?.order ?? 0) - (b.launcher?.order ?? 0))
    .map((d) => d.kind);
  const client = registry.client;
  return {
    title: def?.title,
    label: def?.launcher?.label,
    afterParty: launchers[launchers.indexOf(PARTY_BOARD_KIND) + 1],
    defaultOpen: def?.defaultOpen ?? false,
    restoreOpen: def?.restoreOpen ?? true,
    defaultSize: def?.defaultSize,
    minSize: def?.minSize,
    usefulSize: def?.usefulSize,
    growToContent: def?.growToContent ?? false,
    activity: def?.activity !== undefined,
    sizeRow: SIZE_TABLE[client][PARTY_SUMMARY_KIND],
    pending: PENDING_ROWS[client][PARTY_SUMMARY_KIND] !== undefined,
    sets: REPLAY_SETS[client]
      .filter((s) => s.kinds.includes(PARTY_SUMMARY_KIND))
      .map((s) => s.name),
  };
}

/** Opened from the launcher on the default layout at each reference size: its clamped rect. */
export function summaryOpenRects(registry: WindowRegistry): { vp: string; rect: Rect }[] {
  return REFERENCE_SIZES.map((viewport) => {
    const ctx = { registry, viewport, available: new Set(registry.defs.map((d) => d.kind)) };
    let ws = defaultLayout(registry, viewport);
    ws = [...reduce(ws, { type: "open", kind: PARTY_SUMMARY_KIND }, ctx)];
    const w = ws.find((x) => x.kind === PARTY_SUMMARY_KIND && x.state === "open");
    if (!w) throw new Error(`party.summary not open at ${viewport.w}×${viewport.h}`);
    return { vp: `${viewport.w}×${viewport.h}`, rect: clampRect(w, viewport) };
  });
}

/**
 * FR-SHELL-143 (review-b #20): every launcher entry, Party status included, stays in the bar at
 * 1280×720 (labels or icons only, never the "⋯" menu), labels measured as `Launcher.tsx`'s
 * fallback (7 px a character).
 */
export function launcherFitAt1280(registry: WindowRegistry) {
  const entries = registry.defs
    .filter((d) => d.launcher)
    .sort((a, b) => (a.launcher?.order ?? 0) - (b.launcher?.order ?? 0));
  const labels = new Map(entries.map((d) => [d.kind, d.launcher?.label ?? ""]));
  const items = entries.map((d) => ({
    kind: d.kind,
    order: d.launcher?.order ?? 0,
    state: "closed" as const,
  }));
  return fitLauncher(
    items,
    1280,
    launcherMetrics(labels, (l) => l.length * 7 + 1),
  );
}

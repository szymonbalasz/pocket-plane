// Registry-driven facts for `party.board` "Party Manager" (FR-SHELL-155–157, -161, FR-PARTY-64;
// sprint 9 PM2), asserted by each client's `features/party-board/manager-window.test.ts` on its own
// registry. Test support, no React.

import type { WindowState } from "@shared/play-shell/layout";
import type { You } from "@shared/protocol/frames";
import { clampRect, type Rect } from "../play-shell/geometry";
import { fitLauncher, launcherMetrics } from "../play-shell/launcher-fit";
import { absorbEntries, defaultLayout, reduce } from "../play-shell/manager";
import type { WindowRegistry } from "../play-shell/registry";
import { REPLAY_SETS } from "../play-shell/replay";
import { SIZE_TABLE } from "../play-shell/size-table";
import { PARTY_BOARD_KIND } from "./logic";
import { tabKeyOf } from "./open-tab";
import type { TabState } from "./seen";
import { PARTY_SUMMARY_KIND } from "./summary-logic";

export const REFERENCE_SIZES = [
  { w: 1280, h: 720 },
  { w: 1280, h: 800 },
  { w: 1440, h: 900 },
  { w: 1600, h: 900 },
];

/** FR-SHELL-156 / -157: the def's registration facts, `party.summary` gone. */
export function managerRegistration(registry: WindowRegistry) {
  const def = registry.get(PARTY_BOARD_KIND);
  return {
    title: def?.title,
    label: def?.launcher?.label,
    order: def?.launcher?.order,
    defaultSize: def?.defaultSize,
    usefulSize: def?.usefulSize,
    minSize: def?.minSize,
    minOpenH: def?.minOpenH,
    absorbs: def?.absorbs,
    onAbsorb: typeof def?.onAbsorb,
    sizeRow: SIZE_TABLE[registry.client][PARTY_BOARD_KIND],
    sets: REPLAY_SETS[registry.client]
      .filter((s) => s.kinds.includes(PARTY_BOARD_KIND))
      .map((s) => s.name),
    summary: {
      def: registry.get(PARTY_SUMMARY_KIND) !== undefined,
      launcher: registry.defs.some((d) => d.launcher?.label === "Party status"),
      row: SIZE_TABLE[registry.client][PARTY_SUMMARY_KIND] !== undefined,
      sets: REPLAY_SETS[registry.client]
        .filter((s) => s.kinds.includes(PARTY_SUMMARY_KIND))
        .map((s) => s.name),
    },
  };
}

/** Opened from the launcher on the default layout at each reference size: its clamped rect. */
export function managerOpenRects(registry: WindowRegistry): { vp: string; rect: Rect }[] {
  return REFERENCE_SIZES.map((viewport) => {
    const ctx = { registry, viewport, available: new Set(registry.defs.map((d) => d.kind)) };
    let ws = defaultLayout(registry, viewport);
    ws = [...reduce(ws, { type: "open", kind: PARTY_BOARD_KIND }, ctx)];
    const w = ws.find((x) => x.kind === PARTY_BOARD_KIND && x.state === "open");
    if (!w) throw new Error(`party.board not open at ${viewport.w}×${viewport.h}`);
    return { vp: `${viewport.w}×${viewport.h}`, rect: clampRect(w, viewport) };
  });
}

/**
 * FR-SHELL-155 / FR-PARTY-64 on the real registry: an old layout with `party.summary` open (and
 * Party Manager closed) loads Party Manager open in its state and z; `onAbsorb` picks Party
 * status in the given tab state; the entry has no `party.summary` after the write.
 */
export function summaryMigration(registry: WindowRegistry, you: You, tabs: TabState) {
  const vp = REFERENCE_SIZES[2] as { w: number; h: number };
  const base = defaultLayout(registry, vp).filter((w) => w.kind !== PARTY_BOARD_KIND);
  const z = base.length + 3;
  const summary: WindowState = {
    kind: PARTY_SUMMARY_KIND,
    instance: "main",
    state: "minimised",
    x: 300,
    y: 120,
    w: 280,
    h: 260,
    z,
    userSpot: true,
  };
  const out = absorbEntries(registry, [...base, summary], vp);
  for (const a of out.absorbed) registry.get(a.kind)?.onAbsorb?.(a.from, you);
  const board = out.windows.find((w) => w.kind === PARTY_BOARD_KIND);
  return {
    absorbed: out.absorbed,
    dropped: out.dropped,
    left: out.windows.filter((w) => w.kind === PARTY_SUMMARY_KIND).length,
    board: board && {
      state: board.state,
      z: board.z,
      x: board.x,
      y: board.y,
      w: board.w,
      remembered: board.userSpot === true,
    },
    tab: tabs.state.getState().key === tabKeyOf(you) ? tabs.state.getState().tab : null,
  };
}

/**
 * FR-SHELL-161 (BL-80, reasoned drop): the narrowest viewport at which every launcher label shows
 * (labels measured as `Launcher.tsx`'s fallback, 7 px a character); below it icons + Tooltips,
 * then "⋯". Also whether every entry stays in the bar (icons) at 1280.
 */
export function launcherThreshold(registry: WindowRegistry) {
  const entries = registry.defs
    .filter((d) => d.launcher)
    .sort((a, b) => (a.launcher?.order ?? 0) - (b.launcher?.order ?? 0));
  const labels = new Map(entries.map((d) => [d.kind, d.launcher?.label ?? ""]));
  const items = entries.map((d) => ({
    kind: d.kind,
    order: d.launcher?.order ?? 0,
    state: "closed" as const,
  }));
  const metrics = launcherMetrics(labels, (l) => l.length * 7 + 1);
  let labelsFrom = 4000;
  while (labelsFrom > 0 && !fitLauncher(items, labelsFrom - 1, metrics).compact) labelsFrom--;
  const at1280 = fitLauncher(items, 1280, metrics);
  return { labelsFrom, at1280: { compact: at1280.compact, overflow: at1280.overflow } };
}

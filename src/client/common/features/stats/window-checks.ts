// Registry-driven facts for the Stats window (FR-SHELL-93, -94), asserted by each client's
// `features/stats/windows.test.ts` on its own registry. Test support, no React.
import type { You } from "@shared/protocol/frames";
import { defaultLayout, reduce } from "../play-shell/manager";
import type { WindowRegistry } from "../play-shell/registry";
import { STATS_WINDOW_KIND } from "./logic";
import { openStatsAwards } from "./open";
import { createViewState, viewKey } from "./view";

const VP = { w: 1440, h: 900 };

/** FR-SHELL-93: the registered def's facts (FR-SHELL-86 contract numbers). */
export function statsDefFacts(registry: WindowRegistry) {
  const d = registry.get(STATS_WINDOW_KIND);
  return d
    ? {
        title: d.title,
        defaultSize: d.defaultSize,
        minSize: d.minSize,
        defaultPosition: d.defaultPosition,
        defaultOpen: d.defaultOpen ?? false,
        launcher: d.launcher ? { label: d.launcher.label, order: d.launcher.order } : null,
        companion: d.companion !== undefined,
        activity: d.activity !== undefined,
        partyOrder: registry.get("party.board")?.launcher?.order ?? null,
      }
    : null;
}

/** FR-SHELL-94: `openStatsAwards(7)` on a closed, a minimised and an open window. */
export function openStatsAwardsRuns(registry: WindowRegistry, you: You) {
  const ctx = { registry, viewport: VP, available: new Set(registry.defs.map((d) => d.kind)) };
  const base = defaultLayout(registry, VP);
  const opened = reduce(base, { type: "open", kind: STATS_WINDOW_KIND }, ctx);
  const covered = reduce(opened, { type: "open", kind: "cmp.compendium" }, ctx);
  const minimised = reduce(opened, { type: "minimise", kind: STATS_WINDOW_KIND }, ctx);
  const runs = [
    ["closed", base],
    ["minimised", minimised],
    ["open", covered],
  ] as const;
  return runs.map(([before, ws]) => {
    const views = createViewState();
    views.set(viewKey(you), { tab: "fight", fightKey: "enc-1" });
    let next = ws;
    const calls: { kind: string; by: string | undefined }[] = [];
    openStatsAwards(7, {
      you,
      views,
      open: (kind, instance, opts) => {
        calls.push({ kind, by: opts?.by });
        next = reduce(next, { type: "open", kind, instance, by: opts?.by }, ctx);
      },
    });
    const win = next.find((w) => w.kind === STATS_WINDOW_KIND);
    return {
      before,
      calls,
      state: win?.state,
      onTop: win?.z === Math.max(...next.map((w) => w.z)),
      view: views.get(viewKey(you)),
    };
  });
}

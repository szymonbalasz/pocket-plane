// Registry-driven facts for the Stats window (FR-SHELL-93, -94, FR-STATS-34), asserted by each client's
// `features/stats/windows.test.ts` on its own registry. Test support, no React.
import type { You } from "@shared/protocol/frames";
import { defaultLayout, reduce } from "../play-shell/manager";
import type { WindowRegistry } from "../play-shell/registry";
import { STATS_WINDOW_KIND } from "./logic";
import { type OpenWindowFn, openStatsAwards, openStatsFight } from "./open";
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

type Opener = (deps: {
  you: You;
  views: ReturnType<typeof createViewState>;
  open: OpenWindowFn;
}) => void;

/** One feature open on a closed, a minimised and an open (covered) window. */
function openRuns(registry: WindowRegistry, you: You, run: Opener) {
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
    run({
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

/** FR-SHELL-94: `openStatsAwards(7)` on a closed, a minimised and an open window. */
export const openStatsAwardsRuns = (registry: WindowRegistry, you: You) =>
  openRuns(registry, you, (deps) => openStatsAwards(7, deps));

/** FR-STATS-34: `openStatsFight("enc-9")` (the End summary) on a closed, a minimised and an open window. */
export const openStatsFightRuns = (registry: WindowRegistry, you: You) =>
  openRuns(registry, you, (deps) => openStatsFight("enc-9", deps));

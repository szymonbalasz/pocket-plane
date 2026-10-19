// Registry-driven facts for the Loot tab slice (FR-PARTY-30, FR-LOOT-21), asserted by each
// client's `features/party-board/windows.test.ts` on its own registry. Test support, no React.
import type { You } from "@shared/protocol/frames";
import { emptyStore } from "@shared/protocol/store";
import { TOP_BAR_H, workArea } from "../play-shell/geometry";
import { defaultLayout, reduce, restoreLayout, serialise } from "../play-shell/manager";
import { availableKinds, type WindowRegistry } from "../play-shell/registry";
import { PARTY_BOARD_KIND } from "./logic";
import { openPartyTab, tabKeyOf } from "./open-tab";
import { createPartyMemory, createTabState } from "./seen";

export const RETIRED_LOOT_KIND = "loot.log";
const VP = { w: 1440, h: 900 };

/** FR-LOOT-21: where `loot.log` still shows up in a registry, by kind (review #21). */
export function lootLogTraces(registry: WindowRegistry) {
  return {
    kind: registry.get(RETIRED_LOOT_KIND) !== undefined,
    launcher: registry.defs.some((d) => d.kind === RETIRED_LOOT_KIND && d.launcher),
    available: availableKinds(registry, emptyStore()).has(RETIRED_LOOT_KIND),
  };
}

export const STORED_BOARD = { x: 68, y: TOP_BAR_H + 40, w: 420, h: 500 };

/** FR-LOOT-21: restores a stored layout that still lists `loot.log` (open) beside the board. */
export function restoreWithLootLog(registry: WindowRegistry) {
  const area = workArea(VP);
  const raw = JSON.stringify({
    windows: [
      {
        kind: RETIRED_LOOT_KIND,
        instance: "main",
        state: "open",
        x: 68,
        y: 60,
        w: 440,
        h: 472,
        z: 1,
        area,
      },
      { kind: PARTY_BOARD_KIND, instance: "main", state: "open", ...STORED_BOARD, z: 2, area },
    ],
  });
  const r = restoreLayout(registry, raw, VP);
  return {
    warning: r.warning,
    stored: r.stored,
    board: r.windows.find((w) => w.kind === PARTY_BOARD_KIND),
    written: serialise(r.windows, registry).windows.map((w) => w.kind),
  };
}

/** FR-PARTY-30: `openPartyTab("loot")` on a closed, a minimised and an open board. */
export function openPartyTabRuns(registry: WindowRegistry, you: You) {
  const ctx = { registry, viewport: VP, available: new Set(registry.defs.map((d) => d.kind)) };
  const stored = new Map<string, string>();
  const tabs = createTabState(
    createPartyMemory(() => ({
      getItem: (k) => stored.get(k) ?? null,
      setItem: (k, v) => void stored.set(k, v),
    })),
  );
  const key = tabKeyOf(you);
  const base = defaultLayout(registry, VP);
  const opened = reduce(base, { type: "open", kind: PARTY_BOARD_KIND }, ctx);
  const minimised = reduce(opened, { type: "minimise", kind: PARTY_BOARD_KIND }, ctx);
  const runs = [
    ["closed", base],
    ["minimised", minimised],
    ["open", opened],
  ] as const;
  return runs.map(([before, ws]) => {
    tabs.choose(key, "handouts");
    let next = ws;
    const calls: { kind: string; by: string | undefined }[] = [];
    openPartyTab("loot", {
      you,
      tabs,
      open: (kind, instance, opts) => {
        calls.push({ kind, by: opts?.by });
        next = reduce(next, { type: "open", kind, instance, by: opts?.by }, ctx);
      },
    });
    const board = next.find((w) => w.kind === PARTY_BOARD_KIND);
    return {
      before,
      calls,
      state: board?.state,
      onTop: board?.z === Math.max(...next.map((w) => w.z)),
      tab: tabs.state.getState().tab,
      stored: key ? stored.get(key) : undefined,
    };
  });
}

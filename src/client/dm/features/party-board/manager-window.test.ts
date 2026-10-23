// Sprint 9 PM2 (FR-SHELL-155–157, -161, FR-PARTY-63, -64) on the DM registry: `party.board`
// registered as "Party Manager" 600 × 560 (BL-106) (useful 440 × 400, min 340 × 360), absorbing
// `party.summary`; no Party status window, launcher entry, size-table row or harness set left;
// it opens inside the viewport at the four sizes; an old layout migrates onto Party status; the
// launcher-label threshold recorded (BL-80, a reasoned drop).
import { afterEach, expect, mock, test } from "bun:test";
import type { You } from "@shared/protocol/frames";
import {
  launcherThreshold,
  managerOpenRects,
  managerRegistration,
  summaryMigration,
} from "@ui/features/party-board/manager-checks";
import { partyMemory } from "@ui/features/party-board/seen";
import { TOP_BAR_H } from "@ui/features/play-shell/geometry";

mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows: registry } = await import("../../windows");
const YOU: You = { campaignId: "c1", role: "dm", playerId: null };
const all = (w: number, h: number) => [
  { w, h },
  { w, h },
  { w, h },
  { w, h },
];

afterEach(() => partyMemory().tabs.bind(null));

test("FR-SHELL-156 Party Manager registered (DM): title / label Party Manager, order 58, 600 × 560, useful 440 × 400, min 340 × 360, minOpenH 400, absorbs party.summary; size-table row and sets; opens inside the viewport at the four sizes, ≤ 600 wide", () => {
  const r = managerRegistration(registry);
  expect(r).toMatchObject({
    title: "Party Manager",
    label: "Party Manager",
    order: 58,
    defaultSize: { w: 600, h: 560 },
    usefulSize: { w: 440, h: 400 },
    minSize: { w: 340, h: 360 },
    minOpenH: 400,
    absorbs: ["party.summary"],
    onAbsorb: "function",
    sizeRow: { default: all(600, 560), useful: all(440, 400), min: { w: 340, h: 360 } },
    sets: ["D1", "D2", "D3"],
  });
  expect(r.sizeRow?.criterion).toContain("every PC row and its companion rows whole");
  for (const { vp, rect } of managerOpenRects(registry)) {
    const [w, h] = vp.split("×").map(Number) as [number, number];
    expect({
      vp,
      inside: rect.x >= 0 && rect.y >= TOP_BAR_H && rect.x + rect.w <= w && rect.y + rect.h <= h,
    }).toEqual({ vp, inside: true });
    // OQ-SHELL-78 A, BL-106: 600 where a PC-clear spot has it, never under the useful width.
    expect(rect.w).toBeGreaterThanOrEqual(440);
    expect(rect.w).toBeLessThanOrEqual(600);
  }
});

test("FR-PARTY-64 no party status window (DM): no party.summary def, launcher button, size-table row or harness set", () => {
  expect(managerRegistration(registry).summary).toEqual({
    def: false,
    launcher: false,
    row: false,
    sets: [],
  });
});

test("FR-SHELL-155 party.summary layout migrated (DM): a remembered, minimised Party status entry → Party Manager in that state (minimised) and z at its x / y, own size; onAbsorb picks Party status; no party.summary left", () => {
  // The registry's onAbsorb writes the page's tab state.
  const m = summaryMigration(registry, YOU, partyMemory().tabs);
  expect(m.absorbed).toEqual([{ kind: "party.board", from: "party.summary" }]);
  expect(m.left).toBe(0);
  expect(m.board).toMatchObject({ state: "minimised", x: 300, y: 120, w: 600, remembered: true });
  expect(m.tab).toBe("status");
});

test("FR-SHELL-161 launcher threshold (DM): every product label shows from 1434 px (recorded: test-mode launchers out, 6 px a character; SP2 re-test); below it icons only; nothing in the ⋯ menu at 1280", () => {
  const t = launcherThreshold(registry);
  console.log(`FR-SHELL-161 DM labels from ${t.labelsFrom}`);
  expect(t.labelsFrom).toBe(1434); // measured; SP1 / SP2 update it after their launcher entries (S3)
  expect(t.at1280).toEqual({ compact: true, overflow: [] });
});

// Sprint 9 PM2 (FR-SHELL-155–157, -161, FR-PARTY-63, -64) on the Player registry: `party.board`
// registered as "Party Manager" 550 × 560 (useful 440 × 400, min 340 × 360), absorbing
// `party.summary`; no Party status window, launcher entry, size-table row or harness set left;
// it opens inside the viewport at the four sizes; an old layout migrates onto Party status; the
// launcher-label threshold recorded (BL-80, a reasoned drop).
import { afterEach, expect, test } from "bun:test";
import type { You } from "@shared/protocol/frames";
import {
  launcherThreshold,
  managerOpenRects,
  managerRegistration,
  summaryMigration,
} from "@ui/features/party-board/manager-checks";
import { partyMemory } from "@ui/features/party-board/seen";
import { TOP_BAR_H } from "@ui/features/play-shell/geometry";
import { keepOuts } from "@ui/features/play-shell/keep-outs";
import { defaultLayout, restoreLayout } from "@ui/features/play-shell/manager";

const { playerWindows: registry } = await import("../../windows");
const YOU: You = { campaignId: "c1", role: "player", playerId: "p1" };
const all = (w: number, h: number) => [
  { w, h },
  { w, h },
  { w, h },
  { w, h },
];

afterEach(() => partyMemory().tabs.bind(null));

test("FR-SHELL-156 Party Manager registered (Player): title / label Party Manager, order 58, 550 × 560, useful 440 × 400, min 340 × 360, minOpenH 400, absorbs party.summary; size-table row and sets; opens inside the viewport at the four sizes, 550 wide", () => {
  const r = managerRegistration(registry);
  expect(r).toMatchObject({
    title: "Party Manager",
    label: "Party Manager",
    order: 58,
    defaultSize: { w: 550, h: 560 },
    usefulSize: { w: 440, h: 400 },
    minSize: { w: 340, h: 360 },
    minOpenH: 400,
    absorbs: ["party.summary"],
    onAbsorb: "function",
    sizeRow: { default: all(550, 560), useful: all(440, 400), min: { w: 340, h: 360 } },
    sets: ["P1", "P2", "P3"],
  });
  expect(r.sizeRow?.criterion).toContain("every PC row and its companion rows whole");
  for (const { vp, rect } of managerOpenRects(registry)) {
    const [w, h] = vp.split("×").map(Number) as [number, number];
    expect({
      vp,
      inside: rect.x >= 0 && rect.y >= TOP_BAR_H && rect.x + rect.w <= w && rect.y + rect.h <= h,
    }).toEqual({ vp, inside: true });
    // OQ-SHELL-78 A: 550 where a PC-clear spot has it, never under the useful width.
    expect(rect.w).toBeGreaterThanOrEqual(440);
    expect(rect.w).toBeLessThanOrEqual(550);
  }
});

test("FR-PARTY-64 no party status window (Player): no party.summary def, launcher button, size-table row or harness set", () => {
  expect(managerRegistration(registry).summary).toEqual({
    def: false,
    launcher: false,
    row: false,
    sets: [],
  });
});

test("FR-SHELL-155 party.summary layout migrated (Player): a remembered, minimised Party status entry → Party Manager in that state (minimised) and z at its x / y, own size; onAbsorb picks Party status; no party.summary left", () => {
  // The registry's onAbsorb writes the page's tab state.
  const m = summaryMigration(registry, YOU, partyMemory().tabs);
  expect(m.absorbed).toEqual([{ kind: "party.board", from: "party.summary" }]);
  expect(m.left).toBe(0);
  expect(m.board).toMatchObject({ state: "minimised", x: 300, y: 120, w: 550, remembered: true });
  expect(m.tab).toBe("status");
});

test("FR-SHELL-161 launcher threshold (Player): every label shows from 1208 px (recorded); below it icons only; nothing in the ⋯ menu at 1280", () => {
  const t = launcherThreshold(registry);
  console.log(`FR-SHELL-161 Player labels from ${t.labelsFrom}`);
  expect(t.labelsFrom).toBe(1208); // measured; SP1 / SP2 update it after their launcher entries (S3)
  expect(t.at1280).toEqual({ compact: false, overflow: [] });
});

test("FR-SHELL-155 party.summary layout migrated (Player, walkthrough M13): an open Party status entry over an older untouched Stats in Initiative's zone → Party Manager comes back open, Stats (least recently used, I4) put away", () => {
  const vp = { w: 1280, h: 800 };
  const base = defaultLayout(registry, vp).filter(
    (w) => w.kind !== "party.board" && w.kind !== "stats.board",
  );
  const windows = [
    ...base,
    { kind: "stats.board", instance: "main", state: "open", x: 68, y: 60, w: 400, h: 412, z: 4 },
    { kind: "party.summary", instance: "main", state: "open", x: 400, y: 80, w: 280, h: 260, z: 6 },
  ];
  const r = restoreLayout(registry, JSON.stringify({ windows }), vp, [], keepOuts("player", vp));
  const win = (kind: string) => r.windows.find((w) => w.kind === kind);
  expect(r.absorbed).toEqual([{ kind: "party.board", from: "party.summary" }]);
  expect(win("party.summary")).toBeUndefined();
  expect(win("party.board")?.state).toBe("open");
  expect(win("party.board")?.w).toBeGreaterThanOrEqual(440);
  expect(win("stats.board")?.state).toBe("minimised");
  // Seeded elsewhere, the same: Party Manager open.
  for (const at of [
    { x: 360, y: 60 },
    { x: 500, y: 200 },
  ]) {
    const moved = windows.map((w) => (w.kind === "stats.board" ? { ...w, ...at } : w));
    const again = restoreLayout(
      registry,
      JSON.stringify({ windows: moved }),
      vp,
      [],
      keepOuts("player", vp),
    );
    expect(again.windows.find((w) => w.kind === "party.board")?.state).toBe("open");
  }
});

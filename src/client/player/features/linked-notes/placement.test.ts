// NOTES §7, walkthrough r1 step 12: a player at 1280 × 720 with the Dice tray, Sheet and Game log
// open opens Notes: it opens smaller (useful 440 wide) in the free room and covers none of them
// (before r1 it landed 760 × 436 on the Dice tray's buttons). With room (1440 × 900, nothing
// else open) it opens its full 760 wide, as tall as the room above the Game log allows.
import { expect, test } from "bun:test";
import { clampRect, type Rect } from "@ui/features/play-shell/geometry";
import { defaultLayout, reduce } from "@ui/features/play-shell/manager";
import { playerWindows } from "../../windows";

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function open(kinds: string[], viewport: { w: number; h: number }) {
  const available = new Set(playerWindows.defs.map((d) => d.kind));
  available.delete("cbt.initiative"); // the `notes` bundle has no fight
  const ctx = { registry: playerWindows, viewport, available };
  let ws = defaultLayout(playerWindows, viewport);
  for (const kind of kinds) ws = [...reduce(ws, { type: "open", kind }, ctx)];
  return ws
    .filter((w) => available.has(w.kind))
    .map((w) => ({ kind: w.kind, state: w.state, ...clampRect(w, viewport) }));
}

test("FR-NOTES-13 r1 step 12: at 1280×720 beside the Dice tray, Sheet and Log, Notes opens smaller in the free room and covers none of them", () => {
  const ws = open(["dicex.tray", "char.sheet", "dice.log", "notes.main"], { w: 1280, h: 720 });
  const notes = ws.find((w) => w.kind === "notes.main");
  if (!notes) throw new Error("Notes not open");
  expect(notes.state).toBe("open");
  expect(notes.w).toBeGreaterThanOrEqual(320);
  expect(notes.w).toBeLessThan(760);
  for (const w of ws.filter((x) => x.kind !== "notes.main" && x.state === "open"))
    expect([w.kind, overlaps(w, notes)]).toEqual([w.kind, false]);
  expect(ws.find((w) => w.kind === "dicex.tray")?.state).toBe("open");
});

test("FR-NOTES-13 with room (1440×900, nothing else open) Notes opens its full 760 wide, above the Game log", () => {
  const notes = open(["notes.main"], { w: 1440, h: 900 }).find((w) => w.kind === "notes.main");
  expect(notes?.w).toBe(760);
  expect(notes?.h).toBeGreaterThanOrEqual(420);
});

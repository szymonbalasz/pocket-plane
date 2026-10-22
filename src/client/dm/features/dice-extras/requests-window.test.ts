// FR-DICEX-86, -88 (TT2, FR-SHELL-112 (1)): the DM's `dicex.requests` registration (launcher
// "Requests", 360 × 460, useful 360 × 400, min 300 × 320, DM only) and its launcher cues.
import { expect, mock, test } from "bun:test";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { openRequests, requestActivity, requestsWindow } from "./requests-window";

// The players panel pulls in the DM session (localStorage, window.location at import).
mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

const target = (characterId: string, state: string) => ({ characterId, state });
const store = (rows: { id: string; state: string; targets: object[] }[]): RecordStore => ({
  ...emptyStore(),
  records: { "roll-request": Object.fromEntries(rows.map((r) => [r.id, r])) },
});

test("FR-DICEX-86 requests window: DM registration, launcher Requests after Dice, sizes per §7", () => {
  expect(dmWindows.get("dicex.requests")).toBe(requestsWindow);
  expect(requestsWindow).toMatchObject({
    clients: ["dm"],
    defaultSize: { w: 360, h: 460 },
    usefulSize: { w: 360, h: 400 },
    minSize: { w: 300, h: 320 },
    defaultOpen: false,
    launcher: { label: "Requests", order: 46 },
  });
});

test("FR-DICEX-88 launcher cues: badge = open requests; the minimised dot moves when a target answers", () => {
  const open = { id: "r1", state: "open", targets: [target("a", "open"), target("b", "open")] };
  const closed = { id: "r0", state: "closed", targets: [target("a", "rolled")] };
  expect(openRequests(store([open, closed]))).toBe(1);
  expect(openRequests(store([closed]))).toBe(0);
  const before = requestActivity(store([open]));
  const after = requestActivity(
    store([{ ...open, targets: [target("a", "rolled"), target("b", "open")] }]),
  );
  expect(after).not.toBe(before);
});

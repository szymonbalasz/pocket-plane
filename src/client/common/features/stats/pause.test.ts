// Sprint 8 TT4 (seams S10, FR-SHELL-127, FR-STATS-28, -34, FR-SHELL-94): under the pause card the
// kill feed is dropped (not replayed) and the awards / fight-summary opens wait for resume.
import { describe, expect, test } from "bun:test";
import { NotificationCreated } from "@shared/events/notifications";
import type { EventFrame } from "@shared/protocol/frames";
import { createPauseGate } from "../pause/gate";
import { onStatsFrame, type StatsFrameDeps } from "./runtime";

const created = (id: string, kind: string, payload: unknown): EventFrame => ({
  type: "event",
  seq: 1,
  cause: { name: NotificationCreated.type },
  changes: [{ type: "notification", id, op: "upsert", data: { id, kind, payload } }],
});
const AWARDS = {
  fromN: 1,
  toN: 40,
  from: "2026-10-20T19:02:00.000Z",
  to: "2026-10-20T23:41:00.000Z",
  label: "Tue 20 Oct",
};

function setup() {
  const log: string[] = [];
  const gate = createPauseGate();
  const deps: StatsFrameDeps = {
    role: "player",
    prefs: { feed: true, openSummary: true },
    feed: { push: () => void log.push("feed") },
    openAwards: (n) => log.push(`awards:${n}`),
    openFight: (e) => log.push(`fight:${e}`),
    wait: (e) => log.push(`wait:${e}`),
    initiative: undefined,
    gate,
    seen: new Set(),
  };
  return { log, gate, deps };
}

describe("stats under the pause card (FR-SHELL-127)", () => {
  test("FR-SHELL-127 stats while paused: kill feed dropped, not replayed; End summary and awards opens deferred to resume, once each", () => {
    const { log, gate, deps } = setup();
    // Running: all at once.
    onStatsFrame(created("n1", "stats-awards", AWARDS), deps);
    onStatsFrame(created("n2", "stats-fight-summary", { encounterId: "enc-1" }), deps);
    expect(log).toEqual(["feed", "awards:1", "feed", "fight:enc-1"]);
    log.length = 0;
    // Paused: nothing shows or opens.
    gate.set(true);
    onStatsFrame(created("n3", "stats-awards", { ...AWARDS, fromN: 41 }), deps);
    onStatsFrame(created("n4", "stats-fight-summary", { encounterId: "enc-2" }), deps);
    expect(log).toEqual([]);
    // Resume: the deferred opens run once; the feed lines stay dropped.
    gate.set(false);
    expect(log).toEqual(["awards:41", "fight:enc-2"]);
    gate.set(true);
    gate.set(false);
    expect(log).toHaveLength(2);
  });

  test("FR-STATS-34 the DM's own End still waits for Initiative (the DM is never paused)", () => {
    const { log, deps } = setup();
    const frame = created("n5", "stats-fight-summary", { encounterId: "enc-3" });
    onStatsFrame(
      { ...frame, cause: { ...frame.cause, intentId: crypto.randomUUID() } },
      { ...deps, role: "dm", initiative: "open" },
    );
    expect(log).toEqual(["feed", "wait:enc-3"]);
  });
});

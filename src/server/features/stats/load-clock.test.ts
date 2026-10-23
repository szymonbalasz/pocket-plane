// FR-FIX-29 (sprint 9, FX1; BL-69, ADR-0068) seen from Stats on `session-sim-12`: a CLI load
// anchors the fixture clock at load time, so the fixture's fights read the load day and its facts
// form one session dated that day (live play the same evening joins it: gap < 6 h). With no live
// play the counts are the fixture's in both loads; only the dates move. Campaign totals unchanged.
import { afterAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import type { Credential } from "@shared/protocol/frames";
import { dayLabel } from "@shared/stats/rules";
import {
  DmLuckResult,
  PlayerFightResult,
  SessionsResult,
  STATS_QUERY_INTENT,
} from "@shared/stats/schemas";
import { FIXTURE_INSTANT } from "../../commands/context";
import { closeDb } from "../../db/client";
import { player } from "../../db/schema";
import { startTestServer, TEST_SECRET, type TestClient } from "../../testing/harness";

const cleanups: (() => Promise<void> | void)[] = [];
afterAll(async () => {
  for (const c of cleanups.reverse()) {
    try {
      await c();
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  }
});

async function result(c: TestClient, name: string, payload: unknown): Promise<unknown> {
  const intentId = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 5000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) {
      if (f.type !== "ack") throw new Error(JSON.stringify(f));
      return f.result;
    }
  }
}

/** Stats on a fresh `session-sim-12` load (`now` = a CLI load's start, else as `bun test`). */
async function statsAfterLoad(now?: number) {
  const loaded = await loadBundle("session-sim-12", {
    testMode: true,
    dmSecret: TEST_SECRET,
    ...(now !== undefined && { now }),
  });
  const db = loaded.openDb();
  const h = await startTestServer({ db, testMode: true, fake: false });
  cleanups.push(
    loaded.cleanup,
    () => closeDb(db),
    () => h.stop(),
  );
  const token = db
    .select()
    .from(player)
    .all()
    .find((p) => p.name === "Player 1")?.linkToken as string;
  const dm = await h.live({ role: "dm", secret: TEST_SECRET } satisfies Credential);
  const p1 = await h.live({ role: "player", token } satisfies Credential);
  const sessions = SessionsResult.parse(
    await result(dm, STATS_QUERY_INTENT, { scope: "sessions" }),
  );
  const today = DmLuckResult.parse(await result(dm, STATS_QUERY_INTENT, { scope: "luck" })).luck;
  let campaign = DmLuckResult.parse(
    await result(dm, STATS_QUERY_INTENT, { scope: "luck", campaign: true }),
  ).luck;
  for (let i = 0; i < 10 && campaign.pending; i++) {
    await Bun.sleep(1050);
    campaign = DmLuckResult.parse(
      await result(dm, STATS_QUERY_INTENT, { scope: "luck", campaign: true }),
    ).luck;
  }
  const fights = PlayerFightResult.parse(
    await result(p1, STATS_QUERY_INTENT, { scope: "fight" }),
  ).fights;
  dm.close();
  p1.close();
  return { sessions: sessions.sessions, today, campaign, fights };
}

describe("FR-FIX-29 session-sim-12 stats views", () => {
  test("FR-FIX-29 session-sim-12 stats views: with `now` the fixture session and fights read the load day (one session, the fixture's counts); without `now` unchanged (1 Jan); Campaign totals equal", async () => {
    const now = Date.parse("2026-10-22T19:40:31Z");
    const anchored = await statsAfterLoad(now);
    const fixed = await statsAfterLoad();
    const day = (iso: string) => iso.slice(0, 10);

    // One session (every fixture fact at one instant), dated the load day; 1 Jan without `now`.
    expect(anchored.sessions).toHaveLength(1);
    expect(fixed.sessions).toHaveLength(1);
    expect(day(anchored.sessions[0]?.from ?? "")).toBe("2026-10-22");
    expect(anchored.sessions[0]?.from).toBe("2026-10-22T19:40:00.000Z");
    expect(fixed.sessions[0]?.from).toBe(FIXTURE_INSTANT);
    // Luck "Today" (the newest session) holds the fixture's rolls (+ 0 live) in both.
    expect(anchored.today.rows).toEqual(fixed.today.rows);
    expect(anchored.today.rows.some((r) => r.rolls > 0)).toBe(true);
    // Campaign totals unchanged.
    expect(anchored.campaign.rows).toEqual(fixed.campaign.rows);
    // Fixture fights read the load day ("Fight 3 · Thu 22 Oct"), never "Thu 1 Jan".
    const labels = (f: typeof fixed.fights) => f.map((x) => x.label);
    expect(labels(anchored.fights).length).toBeGreaterThan(0);
    for (const l of labels(anchored.fights)) {
      expect(l).toContain(dayLabel("2026-10-22T19:40:00.000Z"));
    }
    for (const l of labels(fixed.fights)) expect(l).toContain(dayLabel(FIXTURE_INSTANT));
  }, 60_000);
});

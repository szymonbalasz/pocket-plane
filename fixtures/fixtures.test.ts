import { afterAll, describe, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import { campaign, eventLog, player, syncProbe } from "@server/db/schema";
import { readEventLog } from "@server/events/log";
import { library, loadBundle } from "./index";

const cleanups: (() => void)[] = [];
afterAll(() => {
  for (const c of cleanups) c();
});

async function loaded(bundle: string) {
  const r = await loadBundle(bundle, { testMode: true });
  cleanups.push(r.cleanup);
  const db = r.openDb();
  cleanups.unshift(() => closeDb(db));
  return { ...r, db };
}

function dump(db: Awaited<ReturnType<typeof loaded>>["db"]) {
  return {
    campaigns: db.select().from(campaign).all(),
    players: db.select().from(player).all(),
    probes: db.select().from(syncProbe).all(),
    log: db.select().from(eventLog).all(),
  };
}

describe("fixture library", () => {
  test("FR-FIX-03 every bundle loads from empty", async () => {
    for (const b of library.bundles) {
      const r = await loaded(b.name);
      expect(r.manifest.status).toBe("complete");
    }
    // One load per bundle, serially; grows with every bundle (scenes rasterises map-large).
  }, 60_000);

  test("FR-FIX-15 bundle contents per FIX §8", async () => {
    const keys = (name: string) =>
      loadBundle(name, { testMode: true }).then((r) => {
        cleanups.push(r.cleanup);
        return r.manifest.fixtures;
      });
    expect(await keys("base")).toEqual(["campaign", "player-1"]);
    expect(await keys("session-sim")).toEqual([
      "campaign",
      "player-1",
      "images",
      "enemy-1",
      "enemy-2",
      "enemy-custom",
      "char-mira",
      "town",
      "battlemap",
    ]);
    expect(await keys("campaign-switch")).toEqual([
      "campaign",
      "player-1",
      "player-2",
      "campaign-second",
    ]);
    expect(await keys("sync-probe")).toEqual([
      "campaign",
      "player-1",
      "player-2",
      "campaign-second",
      "sync-probes",
    ]);
  });

  test("FR-FIX-08 two loads → identical IDs, links, timestamps, row counts", async () => {
    const a = await loaded("sync-probe");
    const b = await loaded("sync-probe");
    expect(dump(a.db)).toEqual(dump(b.db));
    expect(a.manifest.records).toEqual(b.manifest.records);
    expect(a.manifest.playerLinks).toEqual(b.manifest.playerLinks);
    expect(new Set(dump(a.db).log.map((l) => l.at))).toEqual(new Set(["2026-01-01T00:00:00.000Z"]));
  });

  test("FR-FIX-08 a fixture's IDs and tokens are the same in every bundle that includes it", async () => {
    const tokens = await Promise.all(
      ["base", "session-sim", "sync-probe", "campaign-switch"].map(async (n) => {
        const r = await loaded(n);
        const p = r.db
          .select()
          .from(player)
          .all()
          .find((x) => x.name === "Player 1");
        return { id: p?.id, token: p?.linkToken, cid: r.manifest.records.campaign?.campaign?.[0] };
      }),
    );
    for (const t of tokens) expect(t).toEqual(tokens[0] as (typeof tokens)[number]);
  });

  test("campaign-switch: Fixture Campaign active, Second Campaign inactive with Second Player", async () => {
    const r = await loaded("campaign-switch");
    const cs = r.db.select().from(campaign).all();
    expect(cs.map((c) => [c.name, c.active])).toEqual([
      ["Fixture Campaign", true],
      ["Second Campaign", false],
    ]);
    const second = r.db
      .select()
      .from(player)
      .all()
      .filter((p) => p.campaignId === cs[1]?.id);
    expect(second.map((p) => p.name)).toEqual(["Second Player"]);
  });

  test("sync-probes: public, secret (hidden, SECRET-PROBE), mine (owner player-1)", async () => {
    const r = await loaded("sync-probe");
    const p1 = r.manifest.records["player-1"]?.player?.[0];
    const probes = r.db.select().from(syncProbe).all();
    expect(probes.map((p) => [p.text, p.hidden, p.ownerPlayerId])).toEqual([
      ["public", false, null],
      ["SECRET-PROBE", true, null],
      ["mine", false, p1 ?? null],
    ]);
  });

  test("FR-FIX-13 one event-log entry per mutating step, DM authority, no intentId", async () => {
    const r = await loaded("sync-probe");
    const steps = library.fixtures
      .filter((f) => r.manifest.fixtures.includes(f.key))
      .reduce((n, f) => n + (f.kind === "setup" ? f.steps.length : 0), 0);
    const log = readEventLog(r.db);
    // createCampaign on an empty DB also emits CampaignActivated (CON-10).
    expect(log).toHaveLength(steps + 1);
    expect(new Set(log.map((l) => l.actorRole))).toEqual(new Set(["dm"]));
    expect(log.every((l) => l.intentId === null)).toBe(true);
  });

  test("FR-FIX-10 in-process session-sim within budget (warn > 1 s, fail > 2 s)", async () => {
    const t0 = performance.now();
    await loaded("session-sim");
    const ms = performance.now() - t0;
    if (ms > 1000)
      console.warn(`session-sim in-process load took ${Math.round(ms)} ms (> 1 s budget)`);
    expect(ms).toBeLessThan(2000);
  });
});

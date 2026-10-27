// Bundle `kit-log` (kit parity §13 K1): `theme-gilt` + Mira's crit attack, damage and heal as
// player-1. Loads from empty; the rows' outcomes; CON-44 ceilings with the measured figures.
import { afterAll, describe, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import { gameLogEntry } from "@server/db/schema";
import { SNAPSHOT_CEILING } from "@server/ws/hub";
import { servicesFromBundle, snapshotSizes } from "@server/ws/testing/snapshot-size";
import { rowAction, rowResults } from "@shared/dice-roll-log/row";
import { asc } from "drizzle-orm";
import { loadBundle } from "../index";

const BUNDLE = "kit-log";

const cleanups: (() => void)[] = [];
afterAll(() => {
  Bun.gc(true);
  for (const c of cleanups) {
    try {
      c();
    } catch {
      // Windows may hold the temp dir a moment longer; the OS cleans it up.
    }
  }
});

describe("kit-log bundle (kit parity §13 K1)", () => {
  test("FR-KIT-44 kit-log loads from empty: Mira's crit attack, damage and heal rows after theme-gilt's lines", async () => {
    const r = await loadBundle(BUNDLE, { testMode: true });
    cleanups.push(r.cleanup);
    const db = r.openDb();
    cleanups.unshift(() => closeDb(db));
    expect(r.manifest.status).toBe("complete");
    expect(r.manifest.fixtures.slice(-2)).toEqual(["rolls-1", "kit-log-rolls"]);
    const rows = db.select().from(gameLogEntry).orderBy(asc(gameLogEntry.n)).all();
    const kit = rows.slice(-3);
    expect(kit.map((e) => [e.rollerRole, e.actorName, e.public])).toEqual([
      ["player", "Mira", true],
      ["player", "Mira", true],
      ["player", "Mira", true],
    ]);
    expect(kit.map((e) => rowAction(e).text)).toEqual([
      "Longbow attack",
      "Longbow damage",
      "Healing Word",
    ]);
    const results = kit.map((e) => rowResults(e)[0]);
    expect(results.map((x) => x?.outcome)).toEqual(["crit", "damage", "heal"]);
    expect(results.slice(0, 2).map((x) => x?.total)).toEqual([29, 16]);
  }, 60_000);

  test("CON-44 kit-log snapshots under the ceilings: DM ≤ 1.5 MiB, every player ≤ 512 KiB", async () => {
    const b = await servicesFromBundle(await loadBundle(BUNDLE, { testMode: true }));
    cleanups.push(b.cleanup);
    const sizes = snapshotSizes(b.s);
    console.log(`CON-44 kit-log: ${sizes.map((s) => `${s.label} ${s.bytes} B`).join("; ")}`);
    for (const s of sizes)
      expect([s.label, s.bytes <= SNAPSHOT_CEILING[s.role]]).toEqual([s.label, true]);
  }, 60_000);
});

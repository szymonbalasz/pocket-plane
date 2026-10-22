// Sprint 8 TT4 unit `camp-paused` (dice-extras §13): `table-tools-paused` loaded from empty.
import { afterAll, describe, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import { campaign } from "@server/db/schema";
import { eq } from "drizzle-orm";
import { loadBundle } from "../../index";
import { IMG } from "../scenes-map/town";

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

describe("pause fixture (FR-CAMP-46, -47)", () => {
  test("FR-CAMP-47 camp-paused: the active campaign paused with the town image, back in 10 min", async () => {
    const r = await loadBundle("table-tools-paused");
    cleanups.push(r.cleanup);
    const db = r.openDb();
    const active = db.select().from(campaign).where(eq(campaign.active, true)).get();
    closeDb(db);
    const town = r.manifest.records.images?.asset?.[IMG.town];
    expect(active?.pause).toMatchObject({ message: "Pizza break, back soon", imageAssetId: town });
    const p = active?.pause;
    expect(Date.parse(p?.backAt as string) - Date.parse(p?.startedAt as string)).toBe(600_000);
    // The DM's picks stay (pause → Chime).
    expect(active?.alertSounds.pause).toBeDefined();
  });
});

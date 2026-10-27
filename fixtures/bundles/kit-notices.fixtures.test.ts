// Bundle `kit-notices` (kit-parity §13, K3): `theme-gilt` + Mira's applied crossbow card and the
// DM's stack (Player 1's draft request, Mira's pending card). Loads from empty; the cards' states,
// causers and outcome; CON-44 ceilings with the measured figures printed.
import { afterAll, describe, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import { notification } from "@server/db/schema";
import { SNAPSHOT_CEILING } from "@server/ws/hub";
import { servicesFromBundle, snapshotSizes } from "@server/ws/testing/snapshot-size";
import { resolutionText } from "@shared/combat-tracker/rules";
import { asc } from "drizzle-orm";
import { loadBundle } from "../index";

const BUNDLE = "kit-notices";

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

describe("kit-notices bundle (kit-parity §13)", () => {
  test("FR-KIT-55 kit-notices loads from empty: Mira's applied card, Player 1's pending request, Mira's pending card", async () => {
    const r = await loadBundle(BUNDLE, { testMode: true });
    cleanups.push(r.cleanup);
    const db = r.openDb();
    cleanups.unshift(() => closeDb(db));
    expect(r.manifest.status).toBe("complete");
    expect(r.manifest.fixtures.slice(-2)).toEqual(["kit-notices-applied", "kit-notices"]);
    const rows = db.select().from(notification).orderBy(asc(notification.seq)).all();
    const kit = rows.slice(-3);
    expect(kit.map((n) => [n.kind, n.state, n.byRole])).toEqual([
      ["damage-card", "resolved", "player"],
      ["charx-draft", "pending", "player"],
      ["damage-card", "pending", "player"],
    ]);
    // The request's text starts with the causing player's name (bold in the card, FR-KIT-56).
    expect(kit[1]?.text.startsWith("Player 1")).toBe(true);
    const res = kit[0]?.resolution as { targets: Parameters<typeof resolutionText>[0] };
    expect(resolutionText(res.targets)).toBe("Hit Goblin 2: 7");
  }, 60_000);

  test("CON-44 kit-notices snapshots under the ceilings: DM ≤ 1.5 MiB, every player ≤ 512 KiB", async () => {
    const b = await servicesFromBundle(await loadBundle(BUNDLE, { testMode: true }));
    cleanups.push(b.cleanup);
    const sizes = snapshotSizes(b.s);
    console.log(`CON-44 kit-notices: ${sizes.map((s) => `${s.label} ${s.bytes} B`).join("; ")}`);
    for (const s of sizes)
      expect([s.label, s.bytes <= SNAPSHOT_CEILING[s.role]]).toEqual([s.label, true]);
  }, 60_000);
});

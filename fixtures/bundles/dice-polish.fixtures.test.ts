// Bundle `dice-polish` (DICEX §13 sprint 5): `dice-display` + `char-brakka` +
// `weapon-flame-tongue` as patches (seams S10). Loads from empty with Brakka owned by `player-1`
// beside Mira; CON-44 ceilings with the measured figures printed (the landing adds no record).
import { afterAll, describe, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import { entity, player } from "@server/db/schema";
import { SNAPSHOT_CEILING } from "@server/ws/hub";
import { servicesFromBundle, snapshotSizes } from "@server/ws/testing/snapshot-size";
import { eq } from "drizzle-orm";
import { loadBundle } from "../index";

const BUNDLE = "dice-polish";

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

describe("dice-polish bundle (DICEX §13 sprint 5)", () => {
  test("FR-DICEX-49 dice-polish loads from empty: dice-display, then Brakka (player-1) with the Flame Tongue", async () => {
    const r = await loadBundle(BUNDLE, { testMode: true });
    cleanups.push(r.cleanup);
    const db = r.openDb();
    cleanups.unshift(() => closeDb(db));
    expect(r.manifest.status).toBe("complete");
    expect(r.manifest.fixtures.slice(-2)).toEqual(["char-brakka", "weapon-flame-tongue"]);
    for (const key of ["rolls-1", "dicex-looks", "dicex-notation-text", "player-2", "char-thorn"]) {
      expect(r.manifest.fixtures).toContain(key);
    }
    expect(r.manifest.playerLinks.map((p) => p.player)).toEqual(["Player 1", "Player 2"]);
    const p1 = db.select().from(player).where(eq(player.name, "Player 1")).get()?.id;
    const brakka = db.select().from(entity).where(eq(entity.name, "Brakka")).get();
    expect(brakka?.ownerPlayerId).toBe(p1 as string);
    expect((brakka?.statBlock as { attacks?: unknown[] }).attacks).toContainEqual(
      expect.objectContaining({
        name: "Flame Tongue greatsword",
        damage: "2d6+4",
        damageType: "slashing",
        bonus: 1,
        extraDamage: [{ damage: "2d6", type: "fire" }],
      }),
    );
    expect(db.select().from(entity).where(eq(entity.name, "Mira")).get()?.ownerPlayerId).toBe(
      p1 as string,
    );
  }, 60_000);

  test("CON-44 dice-polish snapshots under the ceilings: DM ≤ 1.5 MiB, every player ≤ 512 KiB", async () => {
    const b = await servicesFromBundle(await loadBundle(BUNDLE, { testMode: true }));
    cleanups.push(b.cleanup);
    const sizes = snapshotSizes(b.s);
    console.log(`CON-44 dice-polish: ${sizes.map((s) => `${s.label} ${s.bytes} B`).join("; ")}`);
    expect(sizes.map((s) => s.label)).toEqual(["DM", "P1", "P2"]);
    for (const s of sizes)
      expect([s.label, s.bytes <= SNAPSHOT_CEILING[s.role]]).toEqual([s.label, true]);
  }, 60_000);
});

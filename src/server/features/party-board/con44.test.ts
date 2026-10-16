// PARTY §12 / §13 CON-44 for sprint 3 (P core; #208 ceilings: DM 1 MiB, players 512 KiB, no
// headroom guard): the realistic-heavy harness on `session-sim` + PARTY's units, then the §12
// board written straight to the tables (max length): 30 handouts (20 text, 10 with 3 images;
// 20 shared with all, 5 with player-1, 5 unshared), the party inventory at its cap (60), and
// every loot row of the 100-row window an item row with `qty` 9 999 (worst). PARTY's own bound:
// `handout`, `handout-body`, `party-item` in no snapshot frame (lazy, ADR-0045); `loot-entry`
// growth ≤ 1,100 B. Load acks measured with `lazyLoadSizes` (FR-SYNC-38) for §12.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { library } from "@fixtures/index";
import {
  HANDOUT_BODY_MAX,
  HANDOUT_BODY_TYPE,
  HANDOUT_TITLE_MAX,
  HANDOUT_TYPE,
  ITEM_NAME_MAX,
  ITEM_NOTES_MAX,
  ITEM_QTY_MAX,
  PARTY_ITEM_MAX,
  PARTY_ITEM_TYPE,
  type SharedWith,
} from "@shared/party-board/schemas";
import { LOOT_ENTRY_TYPE } from "@shared/party-loot/schemas";
import { asc, eq } from "drizzle-orm";
import {
  asset,
  campaign,
  handout,
  handoutSeqNext,
  lootEntry,
  partyItem,
  partyItemSeqNext,
  player,
} from "../../db/schema";
import { SNAPSHOT_CEILING } from "../../ws/hub";
import { lazyLoadSizes } from "../../ws/testing/lazy-probe";
import {
  buildRealisticHeavy,
  servicesFromBundle,
  snapshotFrames,
  snapshotSizes,
  type ViewerSize,
} from "../../ws/testing/snapshot-size";
import { loadInProcess } from "../fixtures-adapters/loader";

/** PARTY §3 / §12: what PARTY adds to every snapshot (seams S2 budget). */
const PARTY_SNAPSHOT_MAX = 1_100;
const AT = "2026-01-01T00:00:00.000Z";
const x = (n: number, p = "") => (p + "x".repeat(n)).slice(0, n);
const uuid = (p: string) => x(36, `${p}-`);

describe("CON-44 with PARTY sprint-3 rows (PARTY §12, #208)", () => {
  let b: Awaited<ReturnType<typeof servicesFromBundle>>;
  let before: ViewerSize[];
  let after: ViewerSize[];
  let cid: string;
  beforeAll(async () => {
    const lib = {
      fixtures: library.fixtures,
      bundles: [
        ...library.bundles,
        {
          name: "session-sim-party",
          includes: ["session-sim"],
          fixtures: ["handout-images", "handouts-1", "party-items-1", "party-second"],
        },
      ],
    };
    b = await servicesFromBundle(await loadInProcess(lib, "session-sim-party", { testMode: true }));
    buildRealisticHeavy(b.s);
    const db = b.s.db;
    cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
    before = snapshotSizes(b.s);

    const images = db
      .select()
      .from(asset)
      .where(eq(asset.campaignId, cid))
      .all()
      .slice(0, 3)
      .map((a) => a.id);
    expect(images).toHaveLength(3);
    const p1 = db
      .select()
      .from(player)
      .where(eq(player.campaignId, cid))
      .orderBy(asc(player.createdAt))
      .get()?.id as string;
    const have = db.select().from(handout).where(eq(handout.campaignId, cid)).all().length;
    // 30 handouts as §12 (the units' 5 count): 20 → all, 5 → player-1, 5 unshared.
    for (let i = have; i < 30; i++) {
      const sharedWith: SharedWith =
        i < 20
          ? { mode: "all", playerIds: [] }
          : i < 25
            ? { mode: "players", playerIds: [p1] }
            : { mode: "none", playerIds: [] };
      db.insert(handout)
        .values({
          id: uuid(`h${i}`),
          campaignId: cid,
          seq: handoutSeqNext,
          title: x(HANDOUT_TITLE_MAX, `Handout ${i} `),
          body: x(HANDOUT_BODY_MAX, `Body ${i} `),
          imageAssetIds: i % 3 === 0 ? images : [],
          sharedWith,
          rev: 1,
          bodyRev: 1,
          createdAt: AT,
          updatedAt: AT,
          sharedAt: sharedWith.mode === "none" ? null : AT,
        })
        .run();
    }
    // The party inventory at its cap, max length.
    const items = db.select().from(partyItem).where(eq(partyItem.campaignId, cid)).all().length;
    for (let i = items; i < PARTY_ITEM_MAX; i++) {
      db.insert(partyItem)
        .values({
          id: uuid(`i${i}`),
          campaignId: cid,
          seq: partyItemSeqNext,
          name: x(ITEM_NAME_MAX, `Item ${i} `),
          qty: ITEM_QTY_MAX,
          notes: x(ITEM_NOTES_MAX, `Notes ${i} `),
          createdAt: AT,
          updatedAt: AT,
        })
        .run();
    }
    // Worst window: every loot row an item row with a 4-digit qty (text stays at the
    // harness's 200 chars, longer than any item name).
    db.update(lootEntry).set({ kind: "item", qty: ITEM_QTY_MAX }).run();
    after = snapshotSizes(b.s);
  }, 120_000);
  afterAll(() => b.cleanup());

  test("CON-44 PARTY §12 heavy (#208): DM < 1 MiB, players < 512 KiB; PARTY adds ≤ 1,100 B to every snapshot", () => {
    const [dm, ...players] = after;
    const deltas = after.map((v, i) => v.bytes - (before[i]?.bytes ?? 0));
    const lootDelta = after.map(
      (v, i) =>
        (v.types[LOOT_ENTRY_TYPE]?.bytes ?? 0) - (before[i]?.types[LOOT_ENTRY_TYPE]?.bytes ?? 0),
    );
    console.log(
      `PARTY CON-44 (P core): heavy DM ${before[0]?.bytes} → ${dm?.bytes} B (+${deltas[0]}; ${SNAPSHOT_CEILING.dm - (dm?.bytes ?? 0)} B left of 1 MiB); players max ${Math.max(...players.map((p) => p.bytes))} B (+${Math.min(...deltas.slice(1))}…+${Math.max(...deltas.slice(1))}); loot-entry +${Math.max(...lootDelta)} at ${dm?.types[LOOT_ENTRY_TYPE]?.rows} rows`,
    );
    expect(dm?.bytes ?? Infinity).toBeLessThan(SNAPSHOT_CEILING.dm);
    for (const p of players) expect(p.bytes).toBeLessThan(SNAPSHOT_CEILING.player);
    expect(dm?.types[LOOT_ENTRY_TYPE]?.rows).toBe(100);
    for (const [i, d] of deltas.entries()) {
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(PARTY_SNAPSHOT_MAX);
      expect(lootDelta[i]).toBe(d);
    }
  });

  test("FR-PARTY-01 FR-PARTY-17 no `handout`, `handout-body` or `party-item` in any snapshot frame (lazy)", () => {
    expect(b.s.db.select().from(handout).where(eq(handout.campaignId, cid)).all()).toHaveLength(30);
    for (const f of snapshotFrames(b.s)) {
      for (const t of [HANDOUT_TYPE, HANDOUT_BODY_TYPE, PARTY_ITEM_TYPE])
        expect(f.records[t]).toBeUndefined();
      const text = JSON.stringify(f.records);
      expect(text).not.toContain("Body 2");
      expect(text).not.toContain("Handout 2");
    }
  });

  test("PARTY §12 load acks (lazyLoadSizes): 30 headers, one body chunk, 60 items far below 4 MiB", () => {
    const viewers = snapshotFrames(b.s).map((f) => ({ label: f.label, viewer: f.viewer }));
    const report = (type: string) => {
      const sizes = lazyLoadSizes(b.s, type, viewers);
      const dm = sizes.find((s) => s.label === "DM");
      const players = sizes.filter((s) => s.label !== "DM");
      console.log(
        `PARTY CON-44 (P core): ${type} load DM ${dm?.rows} rows ${dm?.bytes} B; player max ${Math.max(...players.map((p) => p.rows))} rows ${Math.max(...players.map((p) => p.bytes))} B`,
      );
      return { dm, players };
    };
    const headers = report(HANDOUT_TYPE);
    expect(headers.dm?.rows).toBe(30);
    // Everyone: h1 + 15 harness rows shared with all; player-1 also h2 + 5 of their own.
    expect(headers.players.map((p) => p.rows).sort((a, c) => a - c)).toEqual([
      ...Array(headers.players.length - 1).fill(16),
      22,
    ]);
    const bodies = report(HANDOUT_BODY_TYPE);
    expect(bodies.dm?.rows).toBe(30);
    const items = report(PARTY_ITEM_TYPE);
    expect(items.dm?.rows).toBe(PARTY_ITEM_MAX);
    for (const r of [headers, bodies, items])
      for (const s of [r.dm, ...r.players])
        expect(s?.bytes ?? Infinity).toBeLessThan(4 * 1024 * 1024);
  });
});

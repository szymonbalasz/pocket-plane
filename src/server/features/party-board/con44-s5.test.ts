// PARTY §12 / §13.1 CON-44 for sprint 5 (P0; #256 ceilings: DM 1.5 MiB, players 512 KiB): the
// realistic-heavy harness on `session-sim` + the `party-s5` units. PARTY's own bounds:
// `handout-present` ≤ 1 row in every player frame; the DM's rows ≤ 5,100 B at the 20-row cap
// (20 players); 50 attachments (FR-ASSET-24) leave every snapshot byte-identical.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { library } from "@fixtures/index";
import { HANDOUT_PRESENT_TYPE } from "@shared/party-board/schemas";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { asset, campaign } from "../../db/schema";
import { DM_ACTOR } from "../../testing/services";
import { SNAPSHOT_CEILING } from "../../ws/hub";
import {
  buildRealisticHeavy,
  servicesFromBundle,
  snapshotFrames,
  snapshotSizes,
  type ViewerSize,
} from "../../ws/testing/snapshot-size";
import { ingestAsset } from "../assets-pipeline/ingest";
import { addPlayer } from "../campaign-management/commands";
import { loadInProcess } from "../fixtures-adapters/loader";
import { writeWorstPresents } from "./testing";

/** PARTY §12 S5: DM `handout-present` bytes at the 20-row cap. */
const PRESENT_CAP_DM_MAX = 5_100;
const PRESENT_CAP = 20;
const ATTACHMENTS = 50;

function expectCeilings(sizes: ViewerSize[]) {
  for (const v of sizes) {
    const ceiling = v.role === "dm" ? SNAPSHOT_CEILING.dm : SNAPSHOT_CEILING.player;
    expect({ viewer: v.label, over: v.bytes > ceiling }).toEqual({ viewer: v.label, over: false });
  }
}
const presentRows = (v: ViewerSize) => v.types[HANDOUT_PRESENT_TYPE]?.rows ?? 0;
const presentBytes = (v: ViewerSize) => v.types[HANDOUT_PRESENT_TYPE]?.bytes ?? 0;

describe("CON-44 with PARTY sprint-5 rows (PARTY §12 S5, #256)", () => {
  let b: Awaited<ReturnType<typeof servicesFromBundle>>;
  let cid: string;
  beforeAll(async () => {
    const lib = {
      fixtures: library.fixtures,
      bundles: [
        ...library.bundles,
        {
          name: "session-sim-party-s5",
          includes: ["session-sim"],
          fixtures: [
            "handout-images",
            "handouts-1",
            "party-items-1",
            "party-second",
            "cmp-srd-mini",
            "handout-attachment",
            "handout-present-1",
          ],
        },
      ],
    };
    b = await servicesFromBundle(
      await loadInProcess(lib, "session-sim-party-s5", { testMode: true }),
    );
    buildRealisticHeavy(b.s);
    cid = b.s.db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
  }, 120_000);
  afterAll(() => b.cleanup());

  test("FR-ASSET-24 CON-44 50 attachments → every snapshot byte-identical (no `asset` record)", async () => {
    const before = snapshotSizes(b.s);
    const actor = { ...DM_ACTOR, campaignId: cid };
    for (let i = 0; i < ATTACHMENTS; i++) {
      const png = await sharp({
        create: { width: 8, height: 8, channels: 3, background: { r: i, g: 255 - i, b: 7 } },
      })
        .png()
        .toBuffer();
      const r = await ingestAsset(
        b.s,
        { bytes: png, filename: `Pasted image ${i}.png`, listed: false },
        { actor },
      );
      expect(r.outcome).toBe("created");
    }
    const unlisted = b.s.db.select().from(asset).where(eq(asset.listed, false)).all();
    expect(unlisted.length).toBe(ATTACHMENTS + 1); // + the fixture's ransom-note
    expect(snapshotSizes(b.s).map((v) => v.bytes)).toEqual(before.map((v) => v.bytes));
  }, 60_000);

  test("CON-44 FR-PARTY-31 heavy + party-s5 (#256): DM < 1.5 MiB, players < 512 KiB; handout-present ≤ 1 row per player frame", () => {
    const fixture = snapshotSizes(b.s);
    // `handout-present-1`: player-1's waiting present only.
    expect(presentRows(fixture[0] as ViewerSize)).toBe(1);
    expect(
      fixture
        .slice(1)
        .map(presentRows)
        .sort((x, y) => y - x),
    ).toEqual([1, ...Array(fixture.length - 2).fill(0)]);
    const rows = writeWorstPresents(b.s.db, cid);
    const sizes = snapshotSizes(b.s);
    const [dm, ...players] = sizes as [ViewerSize, ...ViewerSize[]];
    expect(presentRows(dm)).toBe(rows);
    for (const p of players) expect(presentRows(p)).toBe(1);
    for (const f of snapshotFrames(b.s).filter((x) => x.viewer.role === "player")) {
      const own = (f.records[HANDOUT_PRESENT_TYPE] ?? []) as { playerId: string }[];
      expect(own.map((r) => r.playerId)).toEqual([f.viewer.playerId as string]);
    }
    expectCeilings(sizes);
    console.log(
      `PARTY CON-44 (S5 P0): handout-present DM ${presentBytes(dm)} B at ${rows} rows, player ${presentBytes(players[0] as ViewerSize)} B; heavy DM ${dm.bytes} B (${SNAPSHOT_CEILING.dm - dm.bytes} B left of 1.5 MiB); players max ${Math.max(...players.map((p) => p.bytes))} B`,
    );
  });

  // Mutates the scenario (adds players): keep last.
  test("CON-44 FR-PARTY-31 at the 20-row cap (20 players): DM handout-present ≤ 5,100 B; each player 1 row; ceilings hold", () => {
    const actor = { ...DM_ACTOR, campaignId: cid };
    const have = snapshotSizes(b.s).length - 1;
    for (let i = have; i < PRESENT_CAP; i++)
      b.s.commands.run(addPlayer, { name: `Player ${String(i + 1).padStart(2, "0")}` }, { actor });
    expect(writeWorstPresents(b.s.db, cid)).toBe(PRESENT_CAP);
    const sizes = snapshotSizes(b.s);
    const [dm, ...players] = sizes as [ViewerSize, ...ViewerSize[]];
    expect(presentRows(dm)).toBe(PRESENT_CAP);
    expect(presentBytes(dm)).toBeLessThanOrEqual(PRESENT_CAP_DM_MAX);
    expect(players).toHaveLength(PRESENT_CAP);
    for (const p of players) {
      expect(presentRows(p)).toBe(1);
      expect(presentBytes(p)).toBeLessThan(300);
    }
    expectCeilings(sizes);
    console.log(
      `PARTY CON-44 (S5 P0): 20-row cap DM handout-present ${presentBytes(dm)} B; heavy DM ${dm.bytes} B; players max ${Math.max(...players.map((p) => p.bytes))} B`,
    );
  });
});

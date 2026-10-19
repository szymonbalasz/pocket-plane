// PARTY §13.1 fixtures (FR-PARTY-40): bundle `party-s5` from empty (h6 with an attachment,
// unshared; h2 presented to player-1), deterministic, patches only (seams S10: no sheet, share or
// notification change against `party-board`), and the P0 units stacked on `session-sim-9`.
import { afterAll, describe, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import {
  asset,
  campaign,
  creatureSheet,
  handout,
  handoutPresent,
  notification,
  player,
} from "@server/db/schema";
import { asc } from "drizzle-orm";
import { loadBundle } from "../../index";
import { HANDOUT_ATTACHMENT } from "./handout-attachment";
import { HANDOUTS_1 } from "./handouts-1";

const cleanups: (() => void)[] = [];
afterAll(() => {
  Bun.gc(true);
  for (const c of cleanups) {
    try {
      c();
    } catch {
      // Windows: a closed SQLite handle can linger until GC; a leftover OS temp dir is harmless.
    }
  }
});

async function read(bundle: string) {
  const r = await loadBundle(bundle, { testMode: true });
  cleanups.push(r.cleanup);
  const db = r.openDb();
  const fixture = db
    .select()
    .from(campaign)
    .all()
    .find((c) => c.name === "Fixture Campaign")?.id as string;
  const out = {
    manifest: r.manifest,
    fixture,
    players: Object.fromEntries(
      db
        .select()
        .from(player)
        .all()
        .map((p) => [p.id, p.name]),
    ),
    assets: db.select().from(asset).orderBy(asc(asset.seq)).all(),
    handouts: db.select().from(handout).orderBy(asc(handout.seq)).all(),
    presents: db.select().from(handoutPresent).all(),
    notes: db.select().from(notification).orderBy(asc(notification.seq)).all(),
    sheets: db.select().from(creatureSheet).all(),
  };
  closeDb(db);
  return out;
}

describe("party-s5 fixtures (PARTY §13.1, FR-PARTY-40)", () => {
  test("FR-PARTY-40 party-s5 loads from empty: h6 with an unlisted attachment (unshared), h2 presented to player-1; deterministic", async () => {
    const r = await read("party-s5");
    expect(r.manifest.fixtures).toEqual(
      expect.arrayContaining([
        "handouts-1",
        "cmp-srd-mini",
        HANDOUT_ATTACHMENT.key,
        "handout-present-1",
      ]),
    );
    const note = r.assets.find((a) => a.name === "ransom-note");
    expect(note?.listed).toBe(false);
    expect(note?.campaignId).toBe(r.fixture);
    // Every other asset stays in the library.
    expect(r.assets.filter((a) => !a.listed).map((a) => a.name)).toEqual(["ransom-note"]);
    // The loader records an attachment's id (no record change) for `r.id` and the manifest.
    expect(r.manifest.records[HANDOUT_ATTACHMENT.key]?.asset).toEqual([note?.id as string]);

    const h6 = r.handouts.at(-1);
    expect(h6).toMatchObject({
      campaignId: r.fixture,
      title: HANDOUT_ATTACHMENT.title,
      body: HANDOUT_ATTACHMENT.body,
      imageAssetIds: [note?.id as string],
      sharedWith: { mode: "none", playerIds: [] },
      sharedAt: null,
    });
    const h2 = r.handouts.find((x) => x.title === `${HANDOUTS_1.p1Only} Thieves' Map`);
    expect(r.presents.map((p) => [p.handoutId, r.players[p.playerId], p.campaignId])).toEqual([
      [h2?.id as string, "Player 1", r.fixture],
    ]);

    // Patches only: against `party-board`, the same sheets and notifications (no present toast).
    const board = await read("party-board");
    expect(r.sheets).toEqual(board.sheets);
    expect(r.notes).toEqual(board.notes);
    expect(r.handouts.slice(0, -1)).toEqual(board.handouts);

    // Deterministic: a second load gives identical ids and rows.
    const again = await read("party-s5");
    expect({ a: again.assets, h: again.handouts, p: again.presents }).toEqual({
      a: r.assets,
      h: r.handouts,
      p: r.presents,
    });
  }, 30_000);

  test("FR-PARTY-40 session-sim-9 carries the P0 units: h6 + attachment, player-1's present", async () => {
    const r = await read("session-sim-9");
    expect(r.manifest.fixtures).toEqual(
      expect.arrayContaining([HANDOUT_ATTACHMENT.key, "handout-present-1"]),
    );
    expect(r.handouts.map((h) => h.body)).toContain(HANDOUT_ATTACHMENT.body);
    // Other sprint-5 units add their own attachments (C5: cmp-images).
    expect(r.assets.filter((a) => !a.listed).map((a) => a.name)).toContain("ransom-note");
    expect(r.presents.map((p) => r.players[p.playerId])).toEqual(["Player 1"]);
  }, 60_000);
});

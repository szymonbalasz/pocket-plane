// Bundle `party-cmp` (P4, CMP §13 sprint 5): `party-board` + `cmp-srd-mini` over real sockets.
// The DM's Add to party on the SRD Potion of Healing sends party-board's `party.addItem` (the
// entry name clipped to 60, notes empty): it merges into `party-items-1`'s "Potion of healing" ×2
// → ×4, logs one `world → party` item row and one `loot-received` for everyone; both players see
// the row (and nothing they must not, before and after a reconnect); a player sending it →
// `forbidden`, nothing written. No new record, so no snapshot growth (CON-44: 0 B).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { closeDb, type Db, openFileDb } from "@server/db/client";
import { compendiumEntry, lootEntry, notification, partyItem, player } from "@server/db/schema";
import { NOTIFICATION_TYPE } from "@server/features/notifications/helpers";
import { PARTY_INTENTS } from "@server/features/party-board/commands";
import { startTestServer, type TestClient, type TestServer } from "@server/testing/harness";
import { TEST_SECRET } from "@server/testing/services";
import { leakScan } from "@server/ws/testing/convergence";
import { clip } from "@shared/compendium/homebrew";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { ITEM_NAME_MAX, PARTY_ITEM_TYPE, type PartyItemRecord } from "@shared/party-board/schemas";
import { LOOT_RECEIVED_KIND } from "@shared/party-loot/schemas";
import type { Credential } from "@shared/protocol/frames";
import { and, eq, isNull } from "drizzle-orm";
import { loadBundle } from "../index";
import { SECOND_ITEM_NAME } from "../units/party-board/party-second";

const DM: Credential = { role: "dm", secret: TEST_SECRET };
/** party-items-1's row the SRD potion merges into (case-insensitive name, empty notes). */
const PARTY_POTION = "Potion of healing";

async function answer(c: TestClient, intentId: string) {
  for (;;) {
    const f = await c.next(undefined, 2000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}
async function until(pred: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("condition not reached in time");
    await Bun.sleep(10);
  }
}
const ok = async (c: TestClient, id: string) => {
  const a = await answer(c, id);
  expect(a.type === "reject" ? JSON.stringify(a) : a.type).toBe("ack");
};
const potionRow = (c: TestClient) =>
  (Object.values(c.store.records[PARTY_ITEM_TYPE] ?? {}) as PartyItemRecord[]).filter(
    (r) => r.name.toLowerCase() === PARTY_POTION.toLowerCase(),
  );
const lootToasts = (c: TestClient) =>
  (Object.values(c.store.records[NOTIFICATION_TYPE] ?? {}) as NotificationRecord[]).filter(
    (n) => n.kind === LOOT_RECEIVED_KIND,
  );

describe("CMP §13 sprint 5 Add to party on `party-cmp`", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let campaignId: string;
  let srdName: string;
  let dm: TestClient;
  let p1: TestClient;
  let p2: TestClient;
  const cred = (name: string): Credential => ({ role: "player", token: links[name] as string });
  /** Party rows, item log rows and loot-received notifications of the fixture campaign. */
  const counts = () => ({
    items: db.select().from(partyItem).where(eq(partyItem.campaignId, campaignId)).all().length,
    log: db
      .select()
      .from(lootEntry)
      .where(and(eq(lootEntry.campaignId, campaignId), eq(lootEntry.kind, "item")))
      .all().length,
    toasts: db
      .select()
      .from(notification)
      .where(
        and(eq(notification.campaignId, campaignId), eq(notification.kind, LOOT_RECEIVED_KIND)),
      )
      .all().length,
  });

  beforeAll(async () => {
    const loaded = await loadBundle("party-cmp", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    const players = db.select().from(player).all();
    links = Object.fromEntries(players.map((r) => [r.name, r.linkToken]));
    campaignId = players.find((r) => r.name === "Player 1")?.campaignId as string;
    srdName = db
      .select({ name: compendiumEntry.name })
      .from(compendiumEntry)
      .where(
        and(
          eq(compendiumEntry.sourceKey, "item/potion-of-healing"),
          isNull(compendiumEntry.campaignId),
        ),
      )
      .get()?.name as string;
    h = await startTestServer({ db, fake: false });
    dm = await h.live(DM);
    p1 = await h.live(cred("Player 1"));
    p2 = await h.live(cred("Player 2"));
    for (const c of [dm, p1, p2]) await ok(c, c.load(PARTY_ITEM_TYPE));
  });

  afterAll(async () => {
    await h.stop();
    closeDb(db);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  });

  test("FR-CMP-40 add compendium item to party: SRD Potion of Healing ×2 merges into ×4; one item log row, one loot-received; players see it", async () => {
    expect(srdName).toBe("Potion of Healing");
    for (const c of [dm, p1, p2]) expect(potionRow(c).map((r) => r.qty)).toEqual([2]);
    const before = counts();
    const toastsBefore = [dm, p1, p2].map((c) => lootToasts(c).length);

    // What the DM client sends (FR-CMP-40): the name clipped as Add to sheet, notes empty.
    await ok(
      dm,
      dm.intent(PARTY_INTENTS.addItem, { name: clip(srdName, ITEM_NAME_MAX), qty: 2, notes: "" }),
    );
    expect(counts()).toEqual({ ...before, log: before.log + 1, toasts: before.toasts + 1 });
    const log = db
      .select()
      .from(lootEntry)
      .where(and(eq(lootEntry.campaignId, campaignId), eq(lootEntry.kind, "item")))
      .all()
      .at(-1);
    expect(log).toMatchObject({
      fromKind: "world",
      toKind: "party",
      // The merged row's spelling (FR-PARTY-19 logs and notifies `after.name`).
      text: PARTY_POTION,
      qty: 2,
    });

    for (const [i, c] of [dm, p1, p2].entries()) {
      await until(() => potionRow(c)[0]?.qty === 4);
      // Merged: still one row, keeping the party's spelling.
      expect(potionRow(c).map((r) => [r.name, r.qty])).toEqual([[PARTY_POTION, 4]]);
      await until(() => lootToasts(c).length === (toastsBefore[i] as number) + 1);
      expect(lootToasts(c).at(-1)?.text).toBe(`Party loot: ${PARTY_POTION} ×2`);
    }
  });

  test("FR-CMP-42 a player sending party.addItem → forbidden, nothing written", async () => {
    const before = counts();
    for (const c of [p1, p2]) {
      const a = await answer(
        c,
        c.intent(PARTY_INTENTS.addItem, { name: srdName, qty: 1, notes: "" }),
      );
      expect(a.type === "reject" ? a.code : a.type).toBe("forbidden");
    }
    expect(counts()).toEqual(before);
  });

  test("FR-CMP-40 leak: players hold only what they may (live, then after a reconnect + load)", async () => {
    for (const name of ["Player 1", "Player 2"]) {
      const live = name === "Player 1" ? p1 : p2;
      const fresh = await h.live(cred(name));
      await ok(fresh, fresh.load(PARTY_ITEM_TYPE));
      for (const [label, c] of [
        ["live", live],
        ["reconnected", fresh],
      ] as const) {
        expect([name, label, leakScan(h.s, c)]).toEqual([name, label, []]);
        // The second campaign's party row never crosses over.
        expect([name, label, c.raw().includes(SECOND_ITEM_NAME)]).toEqual([name, label, false]);
      }
      expect(potionRow(fresh).map((r) => r.qty)).toEqual([4]);
      fresh.close();
    }
  });
});

// NOTES build §1.2 campaign isolation, N1's record part (signals come with N2): the DM, player-1
// (two tabs) and player-2 in the main campaign; the DM and the Second Player in `campaign-second`
// after a switch. Script: create, rename, delete, restore in each campaign; another campaign's
// note ID on every intent; switch and back; resync. Checks: no frame to a main-campaign client
// carries `CANARY-OTHER` or a second-campaign note ID or title; none to a second-campaign client
// carries a main-campaign title, ID or body; no frame carries any body; `leakScan` on every client.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { NOTES_BINNED } from "@fixtures/units/linked-notes/notes-binned";
import { NOTES_SECOND } from "@fixtures/units/linked-notes/notes-second-campaign";
import { NOTES_SHARED } from "@fixtures/units/linked-notes/notes-shared";
import { NOTE_TYPE, type NoteRecord } from "@shared/linked-notes/schemas";
import { CloseCode } from "@shared/protocol/codes";
import type { Credential } from "@shared/protocol/frames";
import { eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { campaign, note, player } from "../../db/schema";
import type { Actor } from "../../events/types";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { leakScan } from "../../ws/testing/convergence";
import { NOTES_INTENTS as N } from "./commands";

const DM: Credential = { role: "dm", secret: TEST_SECRET };
const MAIN_TITLES = [NOTES_SHARED.quest, NOTES_SHARED.duke, NOTES_BINNED.title, "Canary watch"];
const SECOND_TITLES = ["Second only", "Second renamed"];
const BODIES = [
  NOTES_SHARED.ledgerBody,
  NOTES_SHARED.questBody,
  NOTES_SHARED.dukeBody,
  NOTES_BINNED.body,
  NOTES_SECOND.body,
];

async function answer(c: TestClient, intentId: string) {
  for (;;) {
    const f = await c.next(undefined, 3000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}
const ok = async (c: TestClient, id: string) => {
  const a = await answer(c, id);
  expect(a.type === "reject" ? JSON.stringify(a) : a.type).toBe("ack");
  return (a as { result?: unknown }).result;
};
const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
const titles = (c: TestClient) =>
  (Object.values(c.store.records[NOTE_TYPE] ?? {}) as NoteRecord[]).map((n) => n.title).sort();

describe("linked-notes campaign isolation (N1 records)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let camps: Record<string, string>;
  const as = (name: string): Credential => ({ role: "player", token: links[name] as string });
  const dmIn = (cid: string): Actor => ({ role: "dm", playerId: null, campaignId: cid });
  const noteIds = (cid: string) =>
    db
      .select({ id: note.id })
      .from(note)
      .where(eq(note.campaignId, cid))
      .all()
      .map((r) => r.id);

  beforeAll(async () => {
    const loaded = await loadBundle("notes", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    links = Object.fromEntries(
      db
        .select()
        .from(player)
        .all()
        .map((p) => [p.name, p.linkToken]),
    );
    camps = Object.fromEntries(
      db
        .select()
        .from(campaign)
        .all()
        .map((c) => [c.name, c.id]),
    );
    h = await startTestServer({ db, fake: false });
  }, 60_000);

  afterAll(async () => {
    await h.stop();
    closeDb(db);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  });

  /** Every not_found an intent on a foreign note ID must get, for each client given. */
  async function foreignIdsRefused(clients: TestClient[], ids: string[]) {
    for (const c of clients)
      for (const noteId of ids)
        for (const [name, payload] of [
          [N.rename, { noteId, title: "Hijack" }],
          [N.delete, { noteId }],
          [N.restore, { noteId }],
        ] as const) {
          const a = await answer(c, c.intent(name, payload));
          expect([name, a.type, a.type === "reject" ? a.code : null]).toEqual([
            name,
            "reject",
            "not_found",
          ]);
        }
  }

  test("FR-NOTES-01 notes never leave their campaign: frames, intents, a switch and back, a resync", async () => {
    const main = camps["Fixture Campaign"] as string;
    const second = camps["Second Campaign"] as string;
    const secondIds = noteIds(second);
    expect(secondIds).toHaveLength(1);

    // Main campaign: the DM, player-1 in two tabs, player-2.
    const dm = await h.live(DM);
    const p1a = await h.live(as("Player 1"));
    const p1b = await h.live(as("Player 1"));
    const p2 = await h.live(as("Player 2"));
    const mainClients = [dm, p1a, p1b, p2];
    for (const c of mainClients) await ok(c, c.load(NOTE_TYPE));
    const { noteId } = (await ok(p1a, p1a.intent(N.create, { title: "Canary" }))) as {
      noteId: string;
    };
    await ok(p2, p2.intent(N.rename, { noteId, title: "Canary watch" }));
    await ok(dm, dm.intent(N.delete, { noteId }));
    await ok(p1b, p1b.intent(N.restore, { noteId }));
    await foreignIdsRefused([dm, p1a, p2], secondIds);
    for (const c of mainClients) {
      await barrier(c);
      expect(titles(c)).toEqual(
        [
          NOTES_SHARED.ledger,
          NOTES_SHARED.duke,
          NOTES_BINNED.title,
          NOTES_SHARED.quest,
          "Canary watch",
        ].sort(),
      );
    }
    const mainIds = noteIds(main);

    // Switch: every main connection closes 4409; the second campaign's table works alone.
    h.s.commands.run("campaign.activate", { id: second }, { actor: dmIn(main) });
    for (const c of mainClients)
      expect((await c.closed).code).toBe(CloseCode.campaignInactive as number);
    const dm2 = await h.live(DM);
    const sp = await h.live(as("Second Player"));
    const secondClients = [dm2, sp];
    for (const c of secondClients) {
      await ok(c, c.load(NOTE_TYPE));
      expect(titles(c)).toEqual([NOTES_SECOND.title]);
    }
    const made = (await ok(sp, sp.intent(N.create, { title: "Second only" }))) as {
      noteId: string;
    };
    await ok(dm2, dm2.intent(N.rename, { noteId: made.noteId, title: "Second renamed" }));
    await ok(sp, sp.intent(N.delete, { noteId: made.noteId }));
    await ok(dm2, dm2.intent(N.restore, { noteId: made.noteId }));
    await foreignIdsRefused(secondClients, [mainIds[0] as string, noteId]);
    // The main campaign's title is free here: "Quest log" is created anew, not a clash.
    await ok(dm2, dm2.intent(N.create, { title: NOTES_SHARED.quest }));
    const secondNow = noteIds(second);
    for (const c of secondClients) {
      await barrier(c);
      const raw = c.raw();
      const foreign = [
        ...MAIN_TITLES.filter((t) => t !== NOTES_SHARED.quest),
        ...mainIds,
        ...BODIES,
      ];
      expect(foreign.filter((s) => raw.includes(s))).toEqual([]);
      expect(leakScan(h.s, c)).toEqual([]);
    }

    // Back: the main table reconnects, intact; a resync reloads cleanly.
    h.s.commands.run("campaign.activate", { id: main }, { actor: dmIn(second) });
    for (const c of secondClients)
      expect((await c.closed).code).toBe(CloseCode.campaignInactive as number);
    const back = [await h.live(DM), await h.live(as("Player 1")), await h.live(as("Player 2"))];
    for (const c of back) await ok(c, c.load(NOTE_TYPE));
    const again = back[1] as TestClient;
    again.send({ type: "resync" });
    await again.next("snapshot");
    expect(again.store.records[NOTE_TYPE] ?? {}).toEqual({});
    await ok(again, again.load(NOTE_TYPE));
    for (const c of [...mainClients, ...back]) {
      const raw = c.raw();
      const foreign = [...SECOND_TITLES, ...secondNow, ...BODIES];
      expect(foreign.filter((s) => raw.includes(s))).toEqual([]);
      expect(leakScan(h.s, c)).toEqual([]);
    }
    for (const c of back) {
      expect(titles(c)).toEqual(
        [
          NOTES_SHARED.ledger,
          NOTES_SHARED.duke,
          NOTES_BINNED.title,
          NOTES_SHARED.quest,
          "Canary watch",
        ].sort(),
      );
      c.close();
    }
  }, 30_000);
});

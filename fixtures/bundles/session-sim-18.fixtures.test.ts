// Session-sim-18 (NOTES build §1.4): `session-sim-18` loads from empty on top of session-sim-17:
// the running ambush and the shown Sword Coast stay, the Fixture Campaign is active again, and
// the notes are there: three live notes with bodies, one binned, the canary in the Second Campaign.
import { afterAll, expect, test } from "bun:test";
import { NOTES_BINNED } from "@fixtures/units/linked-notes/notes-binned";
import { NOTES_SECOND } from "@fixtures/units/linked-notes/notes-second-campaign";
import { NOTES_SHARED } from "@fixtures/units/linked-notes/notes-shared";
import { closeDb } from "@server/db/client";
import { campaign, encounter, note, overview, player } from "@server/db/schema";
import { and, eq } from "drizzle-orm";
import { loadBundle } from "../index";

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

test("FR-FIX-03 session-sim-18 loads from empty: session-sim-17 + the notes units", async () => {
  const r = await loadBundle("session-sim-18", { testMode: true });
  cleanups.push(r.cleanup);
  const db = r.openDb();
  cleanups.unshift(() => closeDb(db));
  expect(r.manifest.status).toBe("complete");
  expect(r.manifest.fixtures).toEqual(
    expect.arrayContaining([
      "sg-row",
      "ovw-sword-coast",
      "player-2",
      "campaign-second",
      "notes-shared",
      "notes-binned",
      "notes-second-campaign",
    ]),
  );
  // Each unit once.
  expect(new Set(r.manifest.fixtures).size).toBe(r.manifest.fixtures.length);

  const active = db.select().from(campaign).where(eq(campaign.active, true)).all();
  expect(active.map((c) => c.name)).toEqual(["Fixture Campaign"]);
  const main = active[0]?.id as string;
  const second = db.select().from(campaign).where(eq(campaign.name, "Second Campaign")).get()
    ?.id as string;

  // The sim's state survives the switch and back.
  const fights = db.select().from(encounter).where(eq(encounter.status, "started")).all();
  expect(fights).toHaveLength(1);
  const shown = db
    .select()
    .from(overview)
    .where(and(eq(overview.campaignId, main), eq(overview.active, true)))
    .all();
  expect(shown.map((o) => o.name)).toEqual(["Sword Coast"]);
  const players = db
    .select()
    .from(player)
    .where(eq(player.campaignId, main))
    .all()
    .map((p) => p.name);
  expect(players).toEqual(expect.arrayContaining(["Player 1", "Player 2"]));

  // Notes: three live with their bodies, one binned, the canary only in the Second Campaign.
  const notes = db.select().from(note).all();
  const of = (cid: string) => notes.filter((n) => n.campaignId === cid);
  expect(
    of(main)
      .filter((n) => n.deletedAt === null)
      .map((n) => [n.title, n.body])
      .sort(),
  ).toEqual(
    [
      [NOTES_SHARED.ledger, NOTES_SHARED.ledgerBody],
      [NOTES_SHARED.quest, NOTES_SHARED.questBody],
      [NOTES_SHARED.duke, NOTES_SHARED.dukeBody],
    ].sort(),
  );
  expect(
    of(main)
      .filter((n) => n.deletedAt !== null)
      .map((n) => [n.title, n.body]),
  ).toEqual([[NOTES_BINNED.title, NOTES_BINNED.body]]);
  expect(of(second).map((n) => [n.title, n.body])).toEqual([
    [NOTES_SECOND.title, NOTES_SECOND.body],
  ]);
  expect(of(main).some((n) => n.body.includes(NOTES_SECOND.body))).toBe(false);
}, 120_000);

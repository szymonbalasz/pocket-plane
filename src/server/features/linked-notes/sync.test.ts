// NOTES N1 over real sockets on the `notes` bundle (build §1.2 integration): `note` is lazy (in no
// snapshot); `sync.load note` gives the DM and every player the same rows, binned included, with no
// body; intents from players reach everyone at the table; a clash is refused; `ifMissing` from two
// clients at once makes one note; two deletes / restores at once → one, then a no-op ack; a fresh
// connection's load converges with a live one.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { NOTES_BINNED } from "@fixtures/units/linked-notes/notes-binned";
import { NOTES_SECOND } from "@fixtures/units/linked-notes/notes-second-campaign";
import { NOTES_SHARED } from "@fixtures/units/linked-notes/notes-shared";
import { NOTE_TITLE_CLASH, NOTE_TYPE, type NoteRecord } from "@shared/linked-notes/schemas";
import type { Credential } from "@shared/protocol/frames";
import { and, eq, isNull } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { campaign, note, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";
import { NOTES_INTENTS as N } from "./commands";

const DM: Credential = { role: "dm", secret: TEST_SECRET };
/** Every stored body of the bundle: none may travel in N1 (§8.2). */
const BODIES = [
  NOTES_SHARED.ledgerBody,
  NOTES_SHARED.questBody,
  NOTES_SHARED.dukeBody,
  NOTES_BINNED.body,
  NOTES_SECOND.body,
  "office",
  "owes money",
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
const notesOf = (c: TestClient) => Object.values(c.store.records[NOTE_TYPE] ?? {}) as NoteRecord[];
const titles = (c: TestClient) =>
  notesOf(c)
    .map((n) => `${n.title}${n.deletedAt ? " (binned)" : ""}`)
    .sort();

describe("linked-notes over WS (N1)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let mainId: string;
  const as = (name: string): Credential => ({ role: "player", token: links[name] as string });

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
    mainId = db
      .select()
      .from(campaign)
      .all()
      .find((c) => c.name === "Fixture Campaign")?.id as string;
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

  test("FR-NOTES-01 FR-NOTES-04 `note` is in no snapshot; the DM and both players load the same rows, the binned one included, no body", async () => {
    const clients = [await h.live(DM), await h.live(as("Player 1")), await h.live(as("Player 2"))];
    const loads = [];
    for (const c of clients) {
      expect(c.store.records[NOTE_TYPE]).toBeUndefined();
      await ok(c, c.load(NOTE_TYPE));
      loads.push(notesOf(c).sort((a, b) => a.id.localeCompare(b.id)));
      expect(titles(c)).toEqual([
        NOTES_SHARED.ledger,
        NOTES_SHARED.duke,
        `${NOTES_BINNED.title} (binned)`,
        NOTES_SHARED.quest,
      ]);
      const raw = c.raw();
      expect(BODIES.filter((b) => raw.includes(b))).toEqual([]);
      expect(leakScan(h.s, c)).toEqual([]);
    }
    expect(loads[1]).toEqual(loads[0] as NoteRecord[]);
    expect(loads[2]).toEqual(loads[0] as NoteRecord[]);
    const binned = loads[0]?.find((n) => n.title === NOTES_BINNED.title);
    expect(binned?.deletedBy).toEqual({ role: "dm", playerId: null });
    expect(Object.keys(binned ?? {}).sort()).toEqual(
      [
        "campaignId",
        "createdBy",
        "deletedAt",
        "deletedBy",
        "id",
        "title",
        "updatedAt",
        "updatedBy",
      ].sort(),
    );
    for (const c of clients) c.close();
  });

  test("FR-NOTES-01 FR-NOTES-02 a player's create, rename, delete and restore reach the DM and the other player; a clash is refused", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(as("Player 1"));
    const p2 = await h.live(as("Player 2"));
    for (const c of [dm, p1, p2]) await ok(c, c.load(NOTE_TYPE));

    const { noteId } = (await ok(p1, p1.intent(N.create, { title: "Session 4 recap" }))) as {
      noteId: string;
    };
    await ok(p2, p2.intent(N.rename, { noteId, title: "Session 4" }));
    await ok(dm, dm.intent(N.delete, { noteId }));
    await ok(p1, p1.intent(N.restore, { noteId }));
    for (const c of [dm, p1, p2]) {
      await barrier(c);
      const n = c.store.records[NOTE_TYPE]?.[noteId] as NoteRecord | undefined;
      expect(n).toMatchObject({ title: "Session 4", deletedAt: null, deletedBy: null });
    }
    const clash = await answer(p2, p2.intent(N.create, { title: "session-4" }));
    expect(clash).toMatchObject({ type: "reject", code: "conflict", message: NOTE_TITLE_CLASH });
    for (const c of [dm, p1, p2]) {
      expect(leakScan(h.s, c)).toEqual([]);
      const raw = c.raw();
      expect(BODIES.filter((b) => raw.includes(b))).toEqual([]);
      expect(raw).not.toContain(NOTES_SECOND.body);
    }
    for (const c of [dm, p1, p2]) c.close();
  });

  test("FR-NOTES-10 `ifMissing` create from two clients at once makes one note; both get its id", async () => {
    const p1 = await h.live(as("Player 1"));
    const p2 = await h.live(as("Player 2"));
    const a = p1.intent(N.create, { title: "The Black Tower", ifMissing: true });
    const b = p2.intent(N.create, { title: "the black tower", ifMissing: true });
    const [ra, rb] = (await Promise.all([ok(p1, a), ok(p2, b)])) as {
      noteId: string;
      created: boolean;
    }[];
    expect(ra?.noteId).toBe(rb?.noteId as string);
    expect([ra?.created, rb?.created].sort()).toEqual([false, true]);
    const live = db
      .select()
      .from(note)
      .where(
        and(
          eq(note.campaignId, mainId),
          eq(note.titleFold, "the black tower"),
          isNull(note.deletedAt),
        ),
      )
      .all();
    expect(live).toHaveLength(1);
    p1.close();
    p2.close();
  });

  test("FR-NOTES-04 FR-NOTES-05 two deletes, then two restores, at once: one change each, the second a no-op ack", async () => {
    const p1 = await h.live(as("Player 1"));
    const p2 = await h.live(as("Player 2"));
    const { noteId } = (await ok(p1, p1.intent(N.create, { title: "Twice" }))) as {
      noteId: string;
    };
    await barrier(p2);
    const events = (c: TestClient) =>
      c.frames.filter(
        (f) => f.type === "event" && f.cause.name === "NoteChanged" && f.changes.length > 0,
      ).length;
    const before = events(p2);
    await Promise.all([
      ok(p1, p1.intent(N.delete, { noteId })),
      ok(p2, p2.intent(N.delete, { noteId })),
    ]);
    await barrier(p2);
    expect(events(p2)).toBe(before + 1);
    const restored = (await Promise.all([
      ok(p1, p1.intent(N.restore, { noteId })),
      ok(p2, p2.intent(N.restore, { noteId })),
    ])) as { title: string }[];
    expect(restored).toEqual([{ title: "Twice" }, { title: "Twice" }]);
    await barrier(p2);
    expect(events(p2)).toBe(before + 2);
    p1.close();
    p2.close();
  });

  test("FR-NOTES-01 FR-SYNC-38 a fresh connection's load equals a live client's store", async () => {
    const live = await h.live(as("Player 2"));
    await ok(live, live.load(NOTE_TYPE));
    const p1 = await h.live(as("Player 1"));
    const { noteId } = (await ok(p1, p1.intent(N.create, { title: "Converge" }))) as {
      noteId: string;
    };
    await ok(p1, p1.intent(N.delete, { noteId }));
    await barrier(live);
    const fresh = await h.live(as("Player 2"));
    await ok(fresh, fresh.load(NOTE_TYPE));
    const { live: a, fresh: b } = convergence(h.s, live, fresh);
    expect(a).toEqual(b);
    expect(a[NOTE_TYPE]?.[noteId]).toBeDefined();
    for (const c of [live, p1, fresh]) c.close();
  });
});

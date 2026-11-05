// NOTES N2 integration over real sockets on the `notes` bundle (build §1.2): three real
// `@codemirror/collab` editors typing in Burnt Ledger at once converge with the server (the
// rebase path); `notes.here` on open, close and pruning; the cursor signal and its audience; a
// resync with a note open re-opens and loses nothing; a delete while open sends `notes.closed`;
// a campaign switch closes 4409 and drops the sessions.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { NOTES_SHARED } from "@fixtures/units/linked-notes/notes-shared";
import {
  NOTES_CLOSED_SIGNAL,
  NOTES_CURSOR_SIGNAL,
  NOTES_HERE_SIGNAL,
  type NoteHereSignal,
} from "@shared/linked-notes/collab";
import { CloseCode } from "@shared/protocol/codes";
import type { Credential } from "@shared/protocol/frames";
import { eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { campaign, note, player } from "../../db/schema";
import { startTestServer, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { loadText, notesRuntimes } from "./collab";
import { NOTES_COLLAB_INTENTS as C } from "./collab-commands";
import { NOTES_INTENTS as N } from "./commands";
import { Peer } from "./testing";

const DM: Credential = { role: "dm", secret: TEST_SECRET };

describe("linked-notes co-writing over WS (N2)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let players: Record<string, string>;
  let camps: Record<string, string>;
  let ledger: string;
  const as = (name: string): Credential => ({ role: "player", token: links[name] as string });
  const serverText = (id = ledger) =>
    loadText(
      db,
      db.select().from(note).where(eq(note.id, id)).get() as typeof note.$inferSelect,
    ).toString();
  const peer = async (cred: Credential, clientId: string, id = ledger) => {
    const p = new Peer(await h.live(cred), id, clientId);
    await p.open();
    return p;
  };
  const signalsOf = (p: Peer, name: string) => p.signals.filter((x) => x.name === name);

  beforeAll(async () => {
    const loaded = await loadBundle("notes", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    const rows = db.select().from(player).all();
    links = Object.fromEntries(rows.map((p) => [p.name, p.linkToken]));
    players = Object.fromEntries(rows.map((p) => [p.name, p.id]));
    camps = Object.fromEntries(
      db
        .select()
        .from(campaign)
        .all()
        .map((c) => [c.name, c.id]),
    );
    ledger = db
      .select()
      .from(note)
      .all()
      .find((n) => n.title === NOTES_SHARED.ledger && n.campaignId === camps["Fixture Campaign"])
      ?.id as string;
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

  test("FR-NOTES-14 three editors typing at once converge with the server: nothing lost or doubled", async () => {
    const dm = await peer(DM, "dm-tab");
    const p1 = await peer(as("Player 1"), "p1-tab");
    const p2 = await peer(as("Player 2"), "p2-tab");
    const start = serverText();
    expect(dm.doc).toBe(start);
    const editors = [
      { p: dm, ch: "D" },
      { p: p1, ch: "1" },
      { p: p2, ch: "2" },
    ];
    const ROUNDS = 20;
    let pushes = 0;
    await Promise.all(
      editors.map(async ({ p, ch }, k) => {
        for (let i = 0; i < ROUNDS; i++) {
          // Type somewhere in the text (start, middle, end), sometimes twice before a push.
          p.type([0, "end", Math.floor(p.doc.length / 2)][(i + k) % 3] as number | "end", ch);
          if (i % 4 === k) p.type("end", ch);
          pushes += await p.flush();
        }
      }),
    );
    for (const { p } of editors) await p.flush();
    for (const { p } of editors) await p.settle();
    const final = serverText();
    for (const { p, ch } of editors) {
      expect(p.doc).toBe(final);
      expect([...final].filter((c) => c === ch).length).toBeGreaterThanOrEqual(ROUNDS);
    }
    // Exactly the typed characters were added, each once.
    const added = [...final].length - [...start].length;
    const expected = editors.reduce(
      (n, _e, k) =>
        n + ROUNDS + Array.from({ length: ROUNDS }, (_x, i) => i).filter((i) => i % 4 === k).length,
      0,
    );
    expect(added).toBe(expected);
    expect(pushes).toBeGreaterThan(3 * ROUNDS - 1);
    // Typing at once really went stale and rebased (receiveUpdates + resend).
    expect(editors.reduce((n, { p }) => n + p.rebases, 0)).toBeGreaterThan(0);
    for (const { p } of editors) p.c.close();
  }, 30_000);

  test("FR-NOTES-16 who is here: open, close and a dropped connection (pruned by the next notes command)", async () => {
    const p1 = await peer(as("Player 1"), "h-p1");
    const p2 = await peer(as("Player 2"), "h-p2");
    const dm = await peer(DM, "h-dm");
    await p1.settle();
    const last = () =>
      (signalsOf(p1, NOTES_HERE_SIGNAL).at(-1)?.data as NoteHereSignal | undefined)?.here ?? [];
    expect(
      last()
        .map((x) => x.clientId)
        .sort(),
    ).toEqual(["h-dm", "h-p1", "h-p2"]);
    expect(last().find((x) => x.clientId === "h-p2")).toEqual({
      role: "player",
      playerId: players["Player 2"] as string,
      clientId: "h-p2",
    });
    await p2.answer(p2.c.intent(C.close, { noteId: ledger }));
    await p1.settle();
    expect(
      last()
        .map((x) => x.clientId)
        .sort(),
    ).toEqual(["h-dm", "h-p1"]);
    dm.c.close();
    await dm.c.closed;
    // Any notes command prunes the gone connection; the others hear of it.
    p1.type(0, "!");
    await p1.flush();
    await p1.settle();
    expect(last().map((x) => x.clientId)).toEqual(["h-p1"]);
    p1.c.close();
    p2.c.close();
  });

  test("FR-NOTES-15 a cursor reaches the DM and the players with the note open, never the others; a foreign or binned note is not_found", async () => {
    const p1 = await peer(as("Player 1"), "c-p1");
    const p1b = await peer(as("Player 1"), "c-p1b");
    const dm = await peer(DM, "c-dm");
    const p2 = new Peer(await h.live(as("Player 2")), ledger, "c-p2"); // not open
    const cursor = {
      noteId: ledger,
      clientId: "c-p1",
      version: p1.version,
      ranges: [{ anchor: 1, head: 4 }],
    };
    p1.c.send({ type: "signal", name: NOTES_CURSOR_SIGNAL, data: cursor });
    for (const p of [p1b, dm, p2]) await p.settle();
    expect(signalsOf(dm, NOTES_CURSOR_SIGNAL).map((x) => x.data)).toEqual([cursor]);
    expect(signalsOf(p1b, NOTES_CURSOR_SIGNAL).map((x) => x.data)).toEqual([cursor]);
    expect(signalsOf(p2, NOTES_CURSOR_SIGNAL)).toEqual([]);
    const frame = dm.c.frames.find((f) => f.type === "signal" && f.name === NOTES_CURSOR_SIGNAL);
    expect(frame && "from" in frame ? frame.from : null).toEqual({
      role: "player",
      playerId: players["Player 1"] as string,
    });
    // Over 10 ranges → invalid; another campaign's note or a binned note → not_found.
    const second = db
      .select()
      .from(note)
      .all()
      .find((n) => n.campaignId === camps["Second Campaign"])?.id;
    const binned = db
      .select()
      .from(note)
      .all()
      .find((n) => n.deletedAt !== null)?.id;
    for (const [noteId, code] of [
      [second, "not_found"],
      [binned, "not_found"],
      ["nope", "not_found"],
    ] as const) {
      p1.c.send({ type: "signal", name: NOTES_CURSOR_SIGNAL, data: { ...cursor, noteId } });
      expect(await p1.c.next("reject")).toMatchObject({ code });
    }
    p1.c.send({
      type: "signal",
      name: NOTES_CURSOR_SIGNAL,
      data: { ...cursor, ranges: Array(11).fill({ anchor: 0, head: 0 }) },
    });
    expect(await p1.c.next("reject")).toMatchObject({ code: "invalid" });
    for (const p of [p1, p1b, dm, p2]) p.c.close();
  });

  test("FR-NOTES-18 after a resync each open note re-opens from its version; typing meanwhile is sent rebased", async () => {
    const a = await peer(as("Player 1"), "r-a");
    const b = await peer(as("Player 2"), "r-b");
    a.type(0, "[offline a]");
    h.hub.resync((c) => c.playerId === players["Player 1"]);
    await a.c.next("snapshot");
    b.type("end", "[b]");
    await b.flush();
    // a missed b's update (a signal mid-snapshot is never queued); its re-open brings it.
    const r = await a.open();
    expect(r.mode).toBe("updates");
    await a.flush();
    for (const p of [a, b]) await p.settle();
    expect(a.doc).toBe(serverText());
    expect(b.doc).toBe(serverText());
    expect(serverText().startsWith("[offline a]")).toBe(true);
    expect(serverText().endsWith("[b]")).toBe(true);
    a.c.close();
    b.c.close();
  });

  test("FR-NOTES-20 a delete while open sends notes.closed to its editors; open and push then get not_found; restore brings it back intact", async () => {
    const quest = db
      .select()
      .from(note)
      .all()
      .find((n) => n.title === NOTES_SHARED.quest)?.id as string;
    const a = await peer(as("Player 1"), "d-a", quest);
    const b = await peer(as("Player 2"), "d-b", quest);
    a.type("end", " more");
    await a.flush();
    const text = serverText(quest);
    const dm = await h.live(DM);
    dm.intent(N.delete, { noteId: quest });
    for (const p of [a, b]) await p.settle();
    for (const p of [a, b])
      expect(signalsOf(p, NOTES_CLOSED_SIGNAL).map((x) => x.data)).toEqual([
        { noteId: quest, reason: "deleted" },
      ]);
    expect(notesRuntimes.get(h.s)?.sessions.has(quest)).toBe(false);
    b.type(0, "x");
    const push = await b.answer(b.c.intent(C.push, b.pending()));
    expect(push).toMatchObject({ type: "reject", code: "not_found" });
    const reopen = await a.answer(a.c.intent(C.open, { noteId: quest, clientId: "d-a" }));
    expect(reopen).toMatchObject({ type: "reject", code: "not_found" });
    dm.intent(N.restore, { noteId: quest });
    await dm.next("ack");
    const c = await peer(as("Player 1"), "d-c", quest);
    expect(c.doc).toBe(text);
    for (const p of [a, b, c]) p.c.close();
    dm.close();
  });

  test("FR-NOTES-20 a campaign switch closes every connection 4409 and drops the old campaign's sessions", async () => {
    const a = await peer(as("Player 1"), "s-a");
    const dm = await peer(DM, "s-dm");
    const rt = notesRuntimes.get(h.s);
    expect(rt?.sessions.has(ledger)).toBe(true);
    const main = camps["Fixture Campaign"] as string;
    const second = camps["Second Campaign"] as string;
    h.s.commands.run(
      "campaign.activate",
      { id: second },
      { actor: { role: "dm", playerId: null, campaignId: main } },
    );
    for (const p of [a, dm])
      expect((await p.c.closed).code).toBe(CloseCode.campaignInactive as number);
    expect([...(rt?.sessions.values() ?? [])].filter((s) => s.campaignId === main)).toEqual([]);
    h.s.commands.run(
      "campaign.activate",
      { id: main },
      { actor: { role: "dm", playerId: null, campaignId: second } },
    );
    // Back: a re-opens from its version and loses nothing.
    a.c = await h.live(as("Player 1"));
    expect((await a.open()).mode).toBe("updates");
    expect(a.doc).toBe(serverText());
    a.c.close();
  });
});

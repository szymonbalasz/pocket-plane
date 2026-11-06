// NOTES N1 + N8 commands in-process (NOTES §6, §9, build §1.2): create / rename / setCategory /
// delete / restore by
// the DM and players, folded title clashes, both caps, the Recycle bin and its "(restored)" names,
// `ifMissing`, no-op acks, another campaign's note → `not_found`, nothing in the event log.
import { beforeEach, describe, expect, test } from "bun:test";
import { NoteChanged } from "@shared/linked-notes/events";
import {
  NOTE_BIN_FULL,
  NOTE_BIN_MAX,
  NOTE_CATEGORIES,
  NOTE_LIMIT_MESSAGE,
  NOTE_LIVE_MAX,
  NOTE_TITLE_CLASH,
  NOTE_TYPE,
  type NoteRecord,
} from "@shared/linked-notes/schemas";
import { titleFold } from "@shared/linked-notes/titles";
import { eq } from "drizzle-orm";
import type { CommandDef } from "../../commands/commands";
import { manualClock, seededContext } from "../../commands/context";
import type { CommandError } from "../../commands/errors";
import { eventLog, note } from "../../db/schema";
import type { Actor, DispatchedEvent } from "../../events/types";
import type { Services } from "../../services";
import { seedSyncProbe } from "../../testing/seed";
import { createTestServices } from "../../testing/services";
import {
  createNote,
  deleteNote,
  renameNote,
  restoreNote,
  seedNoteBody,
  setNoteCategory,
} from "./commands";

type Seed = ReturnType<typeof seedSyncProbe>;

let s: Services;
let t: Seed;
let events: DispatchedEvent[];
let dm: Actor;
let p1: Actor;
let p2: Actor;
let other: Actor;

beforeEach(() => {
  const clock = manualClock(Date.parse("2026-03-01T00:00:00Z"));
  s = createTestServices({ clock });
  t = seedSyncProbe(s);
  events = [];
  s.bus.subscribe("test.notes", (e) => {
    if (e.event.type === NoteChanged.type) events.push(e);
  });
  dm = { role: "dm", playerId: null, campaignId: t.campaignId };
  p1 = { role: "player", playerId: t.p1.id, campaignId: t.campaignId };
  p2 = { role: "player", playerId: t.p2.id, campaignId: t.campaignId };
  other = { role: "dm", playerId: null, campaignId: t.secondCampaignId };
});

// biome-ignore lint/suspicious/noExplicitAny: the command defs differ in input / result types.
const run = <C extends CommandDef<any, any>>(def: C, input: unknown, actor: Actor) =>
  s.commands.run(def.name, input, { actor }) as ReturnType<C["execute"]>;

function refusal(fn: () => unknown): { code: string; message: string } {
  try {
    fn();
  } catch (err) {
    const e = err as CommandError;
    return { code: e.code, message: e.message };
  }
  throw new Error("expected a refusal");
}

const row = (id: string) => s.db.select().from(note).where(eq(note.id, id)).get();
const lastAfter = () => events.at(-1)?.event.changes[0]?.after as NoteRecord;
const create = (title: string, actor: Actor = dm) =>
  run(createNote, { title, category: "other" }, actor) as { noteId: string; created: boolean };

/** Rows straight into the table (cap tests): `n` live or binned notes titled `<prefix> i`. */
function fill(cid: string, n: number, binned: boolean, prefix = "Filler") {
  const at = "2026-01-01T00:00:00.000Z";
  s.db.transaction((tx) => {
    for (let i = 0; i < n; i++) {
      const title = `${prefix} ${i}`;
      tx.insert(note)
        .values({
          id: `${prefix}-${binned ? "b" : "l"}-${i}`,
          campaignId: cid,
          title,
          titleFold: titleFold(title),
          createdByRole: "dm",
          createdAt: at,
          updatedAt: at,
          updatedByRole: "dm",
          ...(binned ? { deletedAt: at, deletedByRole: "dm" as const } : {}),
        })
        .run();
    }
  });
}

describe("linked-notes commands (N1)", () => {
  test("FR-NOTES-01 the DM and players create, rename, delete and restore; the record names who", () => {
    const { noteId, created } = create("Burnt Ledger", p1);
    expect(created).toBe(true);
    expect(lastAfter()).toEqual({
      id: noteId,
      campaignId: t.campaignId,
      title: "Burnt Ledger",
      category: "other",
      createdBy: { role: "player", playerId: t.p1.id },
      updatedAt: "2026-03-01T00:00:00.000Z",
      updatedBy: { role: "player", playerId: t.p1.id },
      deletedAt: null,
      deletedBy: null,
    });
    expect(events.at(-1)?.event.changes[0]?.before).toBeNull();
    expect(events.at(-1)?.event.payload).toEqual({ noteId, change: "created" });

    run(renameNote, { noteId, title: "Burnt ledger (copy)" }, p2);
    expect(lastAfter().title).toBe("Burnt ledger (copy)");
    expect(lastAfter().updatedBy).toEqual({ role: "player", playerId: t.p2.id });
    expect(lastAfter().createdBy).toEqual({ role: "player", playerId: t.p1.id });

    run(deleteNote, { noteId }, dm);
    expect(lastAfter().deletedBy).toEqual({ role: "dm", playerId: null });
    expect(lastAfter().deletedAt).toBe("2026-03-01T00:00:00.000Z");

    const restored = run(restoreNote, { noteId }, p1) as { title: string };
    expect(restored.title).toBe("Burnt ledger (copy)");
    expect(lastAfter()).toMatchObject({ deletedAt: null, deletedBy: null });
    expect(events.map((e) => e.event.payload)).toEqual([
      { noteId, change: "created" },
      { noteId, change: "renamed" },
      { noteId, change: "deleted" },
      { noteId, change: "restored" },
    ]);
    for (const e of events) {
      expect(e.event.campaignId).toBe(t.campaignId);
      expect(e.event.changes.map((c) => c.type)).toEqual([NOTE_TYPE]);
    }
  });

  test("FR-NOTES-01 another campaign's note is not_found on every intent; its notes never clash", () => {
    const { noteId } = create("Burnt Ledger", other);
    const before = row(noteId);
    for (const actor of [dm, p1]) {
      expect(refusal(() => run(renameNote, { noteId, title: "X" }, actor)).code).toBe("not_found");
      expect(refusal(() => run(deleteNote, { noteId }, actor)).code).toBe("not_found");
      expect(refusal(() => run(restoreNote, { noteId }, actor)).code).toBe("not_found");
    }
    expect(refusal(() => run(deleteNote, { noteId: "nope" }, dm)).code).toBe("not_found");
    expect(row(noteId)).toEqual(before);
    // The same title in the main campaign is free: titles are unique per campaign.
    expect(create("Burnt Ledger", dm).created).toBe(true);
  });

  test("FR-NOTES-02 titles are unique among live notes, folded; a clash is refused with the spec's text", () => {
    const a = create("Quest log");
    expect(refusal(() => create("QUEST-LOG", p1))).toEqual({
      code: "conflict",
      message: NOTE_TITLE_CLASH,
    });
    const b = create("Duke Varen");
    expect(refusal(() => run(renameNote, { noteId: b.noteId, title: "quest log" }, dm))).toEqual({
      code: "conflict",
      message: NOTE_TITLE_CLASH,
    });
    // A note may change its own case; the same title is an ack with no write or event.
    const n = events.length;
    run(renameNote, { noteId: a.noteId, title: "Quest log" }, dm);
    expect(events.length).toBe(n);
    run(renameNote, { noteId: a.noteId, title: "Quest Log" }, dm);
    expect(row(a.noteId)?.title).toBe("Quest Log");
    expect(row(a.noteId)?.titleFold).toBe("quest log");
    // Invalid titles never reach the command.
    expect(refusal(() => create("See [[x]]")).code).toBe("invalid");
    expect(refusal(() => create("a".repeat(101))).code).toBe("invalid");
  });

  test("FR-NOTES-03 at 1,000 live notes a create is refused; binned notes don't count", () => {
    fill(t.campaignId, NOTE_LIVE_MAX - 1, false);
    fill(t.campaignId, 5, true, "Binned");
    expect(create("The last one").created).toBe(true);
    expect(refusal(() => create("One too many", p1))).toEqual({
      code: "conflict",
      message: NOTE_LIMIT_MESSAGE,
    });
    // Another campaign has its own cap.
    expect(create("Elsewhere", other).created).toBe(true);
  });

  test("FR-NOTES-04 delete bins the note with its text; it leaves title checks; a second delete is a no-op ack", () => {
    const { noteId } = create("Old rumours", p2);
    s.commands.run(
      seedNoteBody,
      { noteId, body: "Rumour: the Duke owes money" },
      { actor: p2, ctx: seededContext({ disposable: true, key: "t" }) },
    );
    run(deleteNote, { noteId }, p1);
    expect(row(noteId)).toMatchObject({
      deletedByRole: "player",
      deletedByPlayerId: t.p1.id,
      body: "Rumour: the Duke owes money",
      version: 1,
    });
    const n = events.length;
    run(deleteNote, { noteId }, dm);
    expect(events.length).toBe(n);
    expect(row(noteId)?.deletedByPlayerId).toBe(t.p1.id);
    // A binned note can't be renamed; its title is free for a new note.
    expect(refusal(() => run(renameNote, { noteId, title: "X" }, dm)).code).toBe("not_found");
    expect(create("old rumours", dm).created).toBe(true);
    // No record carries a body.
    for (const e of events) expect(JSON.stringify(e.event)).not.toContain("Duke owes");
  });

  test("FR-NOTES-05 restore brings the text back; a taken title comes back as (restored), (restored 2)", () => {
    const first = create("Old rumours");
    s.commands.run(
      seedNoteBody,
      { noteId: first.noteId, body: "Rumour: the Duke owes money" },
      { actor: dm, ctx: seededContext({ disposable: true, key: "t" }) },
    );
    run(deleteNote, { noteId: first.noteId }, dm);
    const second = create("Old Rumours");
    run(deleteNote, { noteId: second.noteId }, dm);
    create("old rumours");

    expect(run(restoreNote, { noteId: first.noteId }, p1)).toEqual({
      title: "Old rumours (restored)",
    });
    expect(row(first.noteId)).toMatchObject({
      title: "Old rumours (restored)",
      titleFold: "old rumours restored",
      deletedAt: null,
      deletedByRole: null,
      body: "Rumour: the Duke owes money",
      updatedByPlayerId: t.p1.id,
    });
    expect(run(restoreNote, { noteId: second.noteId }, dm)).toEqual({
      title: "Old Rumours (restored 2)",
    });
    // Two restores at once: the second is a no-op ack.
    const n = events.length;
    expect(run(restoreNote, { noteId: second.noteId }, p2)).toEqual({
      title: "Old Rumours (restored 2)",
    });
    expect(events.length).toBe(n);
  });

  test("FR-NOTES-05 restoring past 1,000 live notes is refused and leaves the note binned", () => {
    const { noteId } = create("Keep me");
    run(deleteNote, { noteId }, dm);
    fill(t.campaignId, NOTE_LIVE_MAX, false);
    expect(refusal(() => run(restoreNote, { noteId }, p1))).toEqual({
      code: "conflict",
      message: NOTE_LIMIT_MESSAGE,
    });
    expect(row(noteId)?.deletedAt).not.toBeNull();
  });

  test("FR-NOTES-06 the bin holds 1,000 notes: a delete past that is refused with the spec's text", () => {
    fill(t.campaignId, NOTE_BIN_MAX, true);
    const { noteId } = create("Live one");
    expect(refusal(() => run(deleteNote, { noteId }, p2))).toEqual({
      code: "conflict",
      message: NOTE_BIN_FULL,
    });
    expect(NOTE_BIN_FULL).toBe("The Recycle bin is full (1,000 notes). Restore some first.");
    expect(row(noteId)?.deletedAt).toBeNull();
    // The other campaign's bin is its own.
    const elsewhere = create("Elsewhere", other);
    run(deleteNote, { noteId: elsewhere.noteId }, other);
  });

  test("FR-NOTES-10 ifMissing answers with the live note of that folded title, no write", () => {
    const a = run(createNote, { title: "Duke Varen", ifMissing: true, category: "other" }, p1) as {
      noteId: string;
      created: boolean;
    };
    expect(a.created).toBe(true);
    const n = events.length;
    const b = run(createNote, { title: "duke  varen", ifMissing: true, category: "other" }, p2) as {
      noteId: string;
      created: boolean;
    };
    expect(b).toEqual({ noteId: a.noteId, created: false });
    expect(events.length).toBe(n);
    // A binned note of that title doesn't count: a new one is made.
    run(deleteNote, { noteId: a.noteId }, dm);
    const c = run(createNote, { title: "Duke Varen", ifMissing: true, category: "other" }, p2) as {
      noteId: string;
      created: boolean;
    };
    expect(c.created).toBe(true);
    expect(c.noteId).not.toBe(a.noteId);
  });

  test("FR-NOTES-24 notes add nothing to the event log; notes.seedBody runs only in a fixture load", () => {
    const logged = () => s.db.select().from(eventLog).all().length;
    const n = logged();
    const { noteId } = create("Burnt Ledger", p1);
    run(renameNote, { noteId, title: "Burnt Ledger 2" }, dm);
    run(deleteNote, { noteId }, p2);
    run(restoreNote, { noteId }, dm);
    expect(logged()).toBe(n);
    expect(s.intents.has("notes.seedBody")).toBe(false);
    run(setNoteCategory, { noteId, category: "npc" }, p1);
    expect(logged()).toBe(n);
    for (const name of [
      "notes.create",
      "notes.rename",
      "notes.setCategory",
      "notes.delete",
      "notes.restore",
    ])
      expect(s.intents.has(name)).toBe(true);
    expect(refusal(() => run(seedNoteBody, { noteId, body: "x" }, dm)).code).toBe("forbidden");
    expect(
      refusal(() =>
        s.commands.run(
          seedNoteBody,
          { noteId, body: "é".repeat(16 * 1024 + 1) },
          { actor: dm, ctx: seededContext({ disposable: true, key: "t" }) },
        ),
      ).code,
    ).toBe("invalid");
  });
});

describe("linked-notes categories (N8)", () => {
  test("FR-NOTES-25 create needs one of the eight categories; the record carries it", () => {
    const missing = refusal(() => run(createNote, { title: "No category" }, p1));
    expect(missing.code).toBe("invalid");
    expect(refusal(() => run(createNote, { title: "Bad", category: "tag" }, p1)).code).toBe(
      "invalid",
    );
    for (const category of NOTE_CATEGORIES) {
      const { noteId } = run(createNote, { title: `A ${category}`, category }, p1) as {
        noteId: string;
      };
      expect(row(noteId)?.category).toBe(category);
      expect(lastAfter().category).toBe(category);
    }
    expect(NOTE_CATEGORIES).toEqual([
      "session",
      "npc",
      "quest",
      "location",
      "item",
      "faction",
      "player",
      "other",
    ]);
  });

  test("FR-NOTES-25 ifMissing on an existing title keeps that note's category", () => {
    const { noteId } = run(createNote, { title: "Duke Varen", category: "npc" }, p1) as {
      noteId: string;
    };
    const again = run(createNote, { title: "duke varen", category: "quest", ifMissing: true }, p2);
    expect(again).toEqual({ noteId, created: false });
    expect(row(noteId)?.category).toBe("npc");
  });

  test("FR-NOTES-25 FR-NOTES-30 anyone changes a live note's category: one record change, who and when move, nothing logged", () => {
    const { noteId } = run(createNote, { title: "Burnt Ledger", category: "other" }, p1) as {
      noteId: string;
    };
    const logged = s.db.select().from(eventLog).all().length;
    for (const [actor, category] of [
      [p2, "item"],
      [dm, "quest"],
    ] as const) {
      const before = events.length;
      run(setNoteCategory, { noteId, category }, actor);
      expect(events.length).toBe(before + 1);
      const e = events.at(-1);
      expect(e?.event.payload).toEqual({ noteId, change: "categorized" });
      expect(e?.event.changes).toHaveLength(1);
      expect(lastAfter().category).toBe(category);
      expect(lastAfter().updatedBy).toEqual(
        actor.role === "dm"
          ? { role: "dm", playerId: null }
          : { role: "player", playerId: actor.playerId },
      );
    }
    // The same category again: an ack, no write.
    const n = events.length;
    run(setNoteCategory, { noteId, category: "quest" }, p1);
    expect(events.length).toBe(n);
    expect(s.db.select().from(eventLog).all().length).toBe(logged);
    expect(refusal(() => run(setNoteCategory, { noteId, category: "x" }, p1)).code).toBe("invalid");
  });

  test("FR-NOTES-25 a binned note's category can't change (not_found); Restore keeps it", () => {
    const { noteId } = run(createNote, { title: "Old rumours", category: "faction" }, p2) as {
      noteId: string;
    };
    run(deleteNote, { noteId }, dm);
    expect(refusal(() => run(setNoteCategory, { noteId, category: "npc" }, p1)).code).toBe(
      "not_found",
    );
    expect(row(noteId)?.category).toBe("faction");
    run(restoreNote, { noteId }, p1);
    expect(row(noteId)?.category).toBe("faction");
    expect(lastAfter().category).toBe("faction");
  });

  test("FR-NOTES-25 another campaign's note is not_found for setCategory", () => {
    const { noteId } = run(createNote, { title: "Canary", category: "item" }, other) as {
      noteId: string;
    };
    expect(refusal(() => run(setNoteCategory, { noteId, category: "npc" }, p1)).code).toBe(
      "not_found",
    );
    expect(row(noteId)?.category).toBe("item");
  });
});

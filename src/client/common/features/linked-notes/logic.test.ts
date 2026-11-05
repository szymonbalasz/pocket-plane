// NOTES §7 window logic (N3): list order, the Recycle bin newest first, names, status and banner
// texts, one who-is-here chip per person (you first), the window's registration in both clients.
import { describe, expect, test } from "bun:test";
import type { NoteRecord } from "@shared/linked-notes/schemas";
import { COMMANDS } from "../play-shell/commands";
import { NOTES_WINDOW_KIND } from "./kind";
import { bannerText, binnedNotes, hereChips, liveNotes, nameOf, STATUS_TEXT } from "./logic";
import { notesUi } from "./ui";
import { notesWindow } from "./window";

const note = (id: string, over: Partial<NoteRecord> = {}): NoteRecord => ({
  id,
  campaignId: "c1",
  title: id,
  createdBy: { role: "dm", playerId: null },
  updatedAt: "2026-11-05T10:00:00.000Z",
  updatedBy: { role: "dm", playerId: null },
  deletedAt: null,
  deletedBy: null,
  ...over,
});

describe("linked-notes window logic (N3)", () => {
  test("FR-NOTES-01 FR-NOTES-04 live notes last changed first; the Recycle bin apart, newest first", () => {
    const rows = [
      note("a", { updatedAt: "2026-11-05T10:00:00.000Z" }),
      note("b", { updatedAt: "2026-11-05T12:00:00.000Z" }),
      note("x", {
        deletedAt: "2026-11-01T00:00:00.000Z",
        deletedBy: { role: "dm", playerId: null },
      }),
      note("y", {
        deletedAt: "2026-11-03T00:00:00.000Z",
        deletedBy: { role: "player", playerId: "p1" },
      }),
    ];
    expect(liveNotes(rows).map((n) => n.id)).toEqual(["b", "a"]);
    expect(binnedNotes(rows).map((n) => n.id)).toEqual(["y", "x"]);
    expect(nameOf({ role: "dm", playerId: null }, {})).toBe("DM");
    expect(nameOf({ role: "player", playerId: "p1" }, { p1: { name: "Mira" } })).toBe("Mira");
    expect(nameOf({ role: "player", playerId: "gone" }, {})).toBe("A player");
  });

  test("FR-NOTES-16 one chip per person (tabs count once), you first; FR-NOTES-18 status texts", () => {
    const chips = hereChips(
      [
        { role: "player", playerId: "p2", clientId: "t1" },
        { role: "dm", playerId: null, clientId: "t2" },
        { role: "player", playerId: "p1", clientId: "t3" },
        { role: "player", playerId: "p1", clientId: "t4" },
      ],
      { role: "player", playerId: "p1" },
    );
    expect(chips.map((c) => [c.key, c.you])).toEqual([
      ["p1", true],
      ["p2", false],
      ["dm", false],
    ]);
    expect(Object.values(STATUS_TEXT)).toEqual(["Loading…", "Saving…", "Saved", "Offline"]);
  });

  test("FR-NOTES-20 FR-NOTES-21 banner texts", () => {
    expect(bannerText({ kind: "deleted", text: "" })).toBe("This note was deleted");
    expect(bannerText({ kind: "gone", text: "" })).toBe("This note is no longer available");
    expect(bannerText({ kind: "full", text: "" })).toContain("Note is full");
    expect(bannerText({ kind: "reload", text: "" })).toContain("reloaded");
  });

  test("FR-NOTES-13 NOTES §7 notes.main in both clients: 760 × 560, useful 560 × 420, min 360 × 320, launcher Notes; Open Notes and New note in the palette", () => {
    expect(notesWindow).toMatchObject({
      kind: NOTES_WINDOW_KIND,
      title: "Notes",
      clients: ["dm", "player"],
      defaultSize: { w: 760, h: 560 },
      usefulSize: { w: 560, h: 420 },
      minSize: { w: 360, h: 320 },
      launcher: { label: "Notes" },
    });
    const opened: string[] = [];
    const ctx = { live: true, shell: { openWindow: (k: string) => opened.push(k) } } as never;
    const byId = Object.fromEntries(COMMANDS.map((c) => [c.id, c]));
    const before = notesUi.getState().newRequest;
    void byId["notes.open"]?.run(ctx);
    void byId["notes.new"]?.run(ctx);
    expect(opened).toEqual([NOTES_WINDOW_KIND, NOTES_WINDOW_KIND]);
    expect(notesUi.getState().newRequest).toBe(before + 1);
    expect(byId["notes.new"]?.when?.({ live: false } as never)).toBe("Offline");
    notesUi.getState().select("n1");
    notesWindow.onClose?.(null);
    expect(notesUi.getState().selected).toBeNull();
  });
});

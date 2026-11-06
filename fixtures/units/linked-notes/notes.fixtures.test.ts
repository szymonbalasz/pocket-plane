// NOTES build §1.1: bundle `notes` from empty: the three units' notes with their authors, bodies
// and the binned one; the Second Campaign's canary; Fixture Campaign active; both players' links
// printed; the same IDs on a second load (seeded per fixture key).
import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { campaign, note, player } from "@server/db/schema";
import { asc } from "drizzle-orm";
import { loadBundle } from "../../index";
import { NOTES_BINNED } from "./notes-binned";
import { NOTES_SECOND } from "./notes-second-campaign";
import { NOTES_SHARED } from "./notes-shared";

const dirs: string[] = [];
afterAll(() => {
  Bun.gc(true);
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // Windows: a closed SQLite handle can linger until GC; a leftover OS temp dir is harmless.
    }
  }
});

async function load() {
  const r = await loadBundle("notes", { cache: false });
  dirs.push(r.dir);
  const db = r.openDb();
  const camps = Object.fromEntries(
    db
      .select()
      .from(campaign)
      .all()
      .map((c) => [c.name, c]),
  );
  const players = Object.fromEntries(
    db
      .select()
      .from(player)
      .all()
      .map((p) => [p.id, p.name]),
  );
  const notes = db.select().from(note).orderBy(asc(note.createdAt), asc(note.id)).all();
  return { r, camps, players, notes };
}

describe("fixtures: notes bundle (N1)", () => {
  test("FR-NOTES-01 FR-NOTES-04 FR-NOTES-25 `notes` from empty: shared notes by their authors, one binned, the second campaign's canary", async () => {
    const { r, camps, players, notes } = await load();
    const main = camps["Fixture Campaign"];
    const second = camps["Second Campaign"];
    expect(main?.active).toBe(true);
    expect(second?.active).toBe(false);
    const view = notes.map((n) => ({
      campaign: n.campaignId === main?.id ? "main" : "second",
      title: n.title,
      category: n.category,
      by: n.createdByRole === "dm" ? "DM" : players[n.createdByPlayerId as string],
      body: n.body,
      binnedBy:
        n.deletedAt === null
          ? null
          : n.deletedByRole === "dm"
            ? "DM"
            : players[n.deletedByPlayerId as string],
      version: n.version,
    }));
    expect(view).toEqual(
      expect.arrayContaining([
        {
          campaign: "main",
          title: NOTES_SHARED.ledger,
          category: "item",
          by: "Player 1",
          body: NOTES_SHARED.ledgerBody,
          binnedBy: null,
          version: 1,
        },
        {
          campaign: "main",
          title: NOTES_SHARED.quest,
          category: "quest",
          by: "DM",
          body: NOTES_SHARED.questBody,
          binnedBy: null,
          version: 1,
        },
        {
          campaign: "main",
          title: NOTES_SHARED.duke,
          category: "npc",
          by: "Player 2",
          body: NOTES_SHARED.dukeBody,
          binnedBy: null,
          version: 1,
        },
        {
          campaign: "main",
          title: NOTES_BINNED.title,
          category: "other",
          by: "Player 2",
          body: NOTES_BINNED.body,
          binnedBy: "DM",
          version: 1,
        },
        {
          campaign: "second",
          title: NOTES_SECOND.title,
          category: "item",
          by: "DM",
          body: NOTES_SECOND.body,
          binnedBy: null,
          version: 1,
        },
      ]),
    );
    expect(view).toHaveLength(5);
    expect(NOTES_SHARED.ledgerBody).toContain("[[Duke Varen]]");
    expect(NOTES_SHARED.ledgerBody).toContain("[[Quest log]]");
    expect(NOTES_SHARED.ledgerBody).toContain("2d6");
    expect(NOTES_SHARED.questBody).toContain("[[Burnt Ledger]]");
    expect(NOTES_SHARED.dukeBody).toContain("[[Burnt Ledger|the ledger]]");
    expect(r.manifest.playerLinks.map((l) => l.player)).toEqual(
      expect.arrayContaining(["Player 1", "Player 2"]),
    );
    expect(r.manifest.records["notes-shared"]?.note).toHaveLength(3);
  });

  test("FR-NOTES-01 the bundle is deterministic: a second load gives the same notes and IDs", async () => {
    const a = await load();
    const b = await load();
    expect(b.notes).toEqual(a.notes);
  });
});

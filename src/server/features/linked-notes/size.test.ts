// NOTES §12 load size (build §1.2 "Size"), measured with `lazyLoadSizes` (FR-SYNC-38): the
// `note` load at the fixture and at both caps (1,000 live + 1,000 binned, 100-character titles),
// far under the 4 MiB result cap; 0 B in every snapshot (lazy).
import { describe, expect, test } from "bun:test";
import { NOTE_BIN_MAX, NOTE_LIVE_MAX, NOTE_TYPE } from "@shared/linked-notes/schemas";
import { titleFold } from "@shared/linked-notes/titles";
import { manualClock } from "../../commands/context";
import { note } from "../../db/schema";
import type { Services } from "../../services";
import { seedSyncProbe } from "../../testing/seed";
import { createTestServices } from "../../testing/services";
import type { Viewer } from "../../ws/records";
import { lazyLoadSizes } from "../../ws/testing/lazy-probe";
import { createNote, deleteNote } from "./commands";

const MiB4 = 4 * 1024 * 1024;

function setup() {
  const s = createTestServices({ clock: manualClock(Date.parse("2026-03-01T00:00:00Z")) });
  const t = seedSyncProbe(s);
  const viewers: { label: string; viewer: Viewer }[] = [
    { label: "DM", viewer: { connId: "dm", campaignId: t.campaignId, role: "dm", playerId: null } },
    {
      label: "player-1",
      viewer: { connId: "p1", campaignId: t.campaignId, role: "player", playerId: t.p1.id },
    },
  ];
  return { s, t, viewers };
}

function measure(s: Services, viewers: { label: string; viewer: Viewer }[], label: string) {
  const sizes = lazyLoadSizes(s, NOTE_TYPE, viewers);
  for (const x of sizes)
    console.log(`NOTES §12 ${label}: note load ${x.label} ${x.rows} rows ${x.bytes} B`);
  return sizes;
}

describe("linked-notes load size (N1)", () => {
  test("FR-NOTES-03 FR-NOTES-06 NOTES §12 `note` load: the fixture's few rows, and both caps under 4 MiB (< 500 B a row)", () => {
    const { s, t, viewers } = setup();
    const dm = { role: "dm" as const, playerId: null, campaignId: t.campaignId };
    const p1 = { role: "player" as const, playerId: t.p1.id, campaignId: t.campaignId };
    for (const title of ["Burnt Ledger", "Quest log", "Duke Varen", "Old rumours"])
      s.commands.run(createNote, { title }, { actor: title === "Quest log" ? dm : p1 });
    const old = s.db
      .select()
      .from(note)
      .all()
      .find((n) => n.title === "Old rumours")?.id as string;
    s.commands.run(deleteNote, { noteId: old }, { actor: dm });
    const small = measure(s, viewers, "fixture");
    expect(small.map((x) => x.rows)).toEqual([4, 4]);
    expect(small[0]?.bytes).toBe(small[1]?.bytes as number);

    // Both caps: every title 100 characters, every row with a player as author and deleter.
    const at = "2026-03-01T00:00:00.000Z";
    s.db.transaction((tx) => {
      for (let i = 0; i < NOTE_LIVE_MAX + NOTE_BIN_MAX - 4; i++) {
        const title = `${String(i).padStart(5, "0")} ${"x".repeat(94)}`;
        const binned = i >= NOTE_LIVE_MAX - 3;
        tx.insert(note)
          .values({
            id: `cap-note-${String(i).padStart(30, "0")}`,
            campaignId: t.campaignId,
            title,
            titleFold: titleFold(title),
            createdByRole: "player",
            createdByPlayerId: t.p1.id,
            createdAt: at,
            updatedAt: at,
            updatedByRole: "player",
            updatedByPlayerId: t.p2.id,
            ...(binned
              ? { deletedAt: at, deletedByRole: "player" as const, deletedByPlayerId: t.p2.id }
              : {}),
          })
          .run();
      }
    });
    const big = measure(s, viewers, "both caps");
    for (const x of big) {
      expect(x.rows).toBe(NOTE_LIVE_MAX + NOTE_BIN_MAX);
      expect(x.bytes).toBeLessThan(MiB4);
      // Measured: ≈ 484 B a row at the worst case (100-character titles, players everywhere),
      // ≈ 0.97 MB in all, about twice §12's ≈ 250 B estimate and still a quarter of the cap.
      expect(x.bytes / x.rows).toBeLessThan(500);
      expect(x.bytes).toBeLessThan(1024 * 1024);
    }
  });

  test("FR-NOTES-24 CON-44 no `note` key in any snapshot, DM or player (lazy, 0 B)", () => {
    const { s, t, viewers } = setup();
    s.commands.run(
      createNote,
      { title: "Burnt Ledger" },
      { actor: { role: "dm", playerId: null, campaignId: t.campaignId } },
    );
    for (const { viewer } of viewers) {
      const snap = s.records.snapshot({ db: s.db, presence: { list: () => [] } }, viewer);
      expect(Object.keys(snap)).not.toContain(NOTE_TYPE);
      expect(JSON.stringify(snap)).not.toContain("Burnt Ledger");
    }
  });
});

// Bundle `log-note-colours` (CAMP §13 K6, K7, K12; sprint 5 K4): `player-colours` + three roll
// lines and three striped notifications, loaded from empty through the real commands, so the
// rows carry the `rollerRole` / `byRole` stamps the colours derive from. Snapshot frames per
// viewer: each row only to its audience; CON-44 ceilings with the measured figures printed.
import { afterAll, describe, expect, test } from "bun:test";
import { SNAPSHOT_CEILING } from "@server/ws/hub";
import {
  servicesFromBundle,
  snapshotFrames,
  snapshotSizes,
} from "@server/ws/testing/snapshot-size";
import type { GameLogEntryView } from "@shared/dice-roll-log/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { loadBundle } from "../index";

const BUNDLE = "log-note-colours";

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

describe("log-note-colours bundle (CAMP §13 K6, K7)", () => {
  test("FR-DICE-60 FR-NOTE-39 log-note-colours loads from empty: stamped roll lines and notifications per viewer", async () => {
    const loaded = await loadBundle(BUNDLE, { testMode: true });
    expect(loaded.manifest.status).toBe("complete");
    expect(loaded.manifest.fixtures.slice(-2)).toEqual(["log-colours", "note-colours"]);
    expect(loaded.manifest.fixtures).toContain("pc-colours");
    const b = await servicesFromBundle(loaded);
    cleanups.push(b.cleanup);
    const frames = snapshotFrames(b.s);
    expect(frames.map((f) => f.label)).toEqual(["DM", "P1", "P2"]);
    const [dm, p1, p2] = frames.map((f) => ({
      id: f.viewer.playerId,
      log: (f.records["game-log-entry"] ?? []) as GameLogEntryView[],
      notes: (f.records.notification ?? []) as NotificationRecord[],
    })) as [
      { id: null; log: GameLogEntryView[]; notes: NotificationRecord[] },
      { id: string; log: GameLogEntryView[]; notes: NotificationRecord[] },
      { id: string; log: GameLogEntryView[]; notes: NotificationRecord[] },
    ];

    // Roll lines: who rolled, as the stamps say; all public, so every viewer has all three.
    const lines = (log: GameLogEntryView[]) =>
      log
        .filter((e) => e.kind === "roll")
        .sort((a, b) => a.n - b.n)
        .slice(-3)
        .map((e) => [e.actorName, e.rollerRole, e.rollerPlayerId]);
    const expected = [
      ["Mira", "player", p1.id],
      ["Player 2", "player", p2.id],
      ["Mira", "dm", null],
    ];
    for (const v of [dm, p1, p2]) expect(lines(v.log)).toEqual(expected);

    // Notifications: the causer stamp; each row only to its audience.
    const view = (notes: NotificationRecord[]) =>
      notes
        .sort((a, b) => a.seq - b.seq)
        .map((n) => [n.text, n.byRole, n.byPlayerId, n.state, n.closedByPlayerId]);
    const card = ["Mira's card: apply 6 damage?", "player", p1.id, "pending", null];
    const info = ["The bridge creaks", "dm", null, "info", null];
    const ready = ["Ready to cross?", "dm", null, "resolved", p1.id];
    expect(view(dm.notes)).toEqual([card, info, ready]);
    // A player's test send is addressed to themself, the DM acts (like a damage card, FR-NOTE-22).
    expect(view(p1.notes)).toEqual([card, ready]);
    expect(view(p2.notes)).toEqual([info]);

    const sizes = snapshotSizes(b.s);
    console.log(
      `CON-44 log-note-colours: ${sizes.map((s) => `${s.label} ${s.bytes} B`).join("; ")}`,
    );
    for (const s of sizes)
      expect([s.label, s.bytes <= SNAPSHOT_CEILING[s.role]]).toEqual([s.label, true]);
  }, 60_000);
});

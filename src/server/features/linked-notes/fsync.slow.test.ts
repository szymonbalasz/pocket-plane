// ADR-0078 "fsync time" (build §1.2 Size: `fsync` cost per push): three simulated typists push
// one keystroke each, round robin, as fast as the server takes them, on a real file DB (WAL,
// `synchronous = FULL`, as `bun run play`): every push is its own commit (FR-NOTES-19). Reports
// sustained commits a second and the time per push; the ADR's load is ~30 pushes a second.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChangeSet } from "@codemirror/state";
import type { NoteUpdate, PushNoteResult } from "@shared/linked-notes/collab";
import { closeDb, openFileDb } from "../../db/client";
import { createSchema } from "../../db/push";
import type { Actor } from "../../events/types";
import { seedSyncProbe } from "../../testing/seed";
import { createTestServices } from "../../testing/services";
import { NOTES_COLLAB_INTENTS as C } from "./collab-commands";
import { createNote } from "./commands";

const dir = mkdtempSync(path.join(os.tmpdir(), "notes-fsync-"));
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may hold the WAL briefly; a leftover temp dir is harmless.
  }
});

describe("linked-notes fsync cost (N2)", () => {
  test("FR-NOTES-19 ADR-0078 3 typists: one commit per push; sustained commits a second and ms per push", async () => {
    const db = openFileDb(path.join(dir, "notes.db"));
    await createSchema(db.$client);
    const s = createTestServices({ db });
    const t = seedSyncProbe(s);
    const actors: Actor[] = [
      { role: "dm", playerId: null, campaignId: t.campaignId },
      { role: "player", playerId: t.p1.id, campaignId: t.campaignId },
      { role: "player", playerId: t.p2.id, campaignId: t.campaignId },
    ];
    const { noteId } = s.commands.run(
      createNote,
      { title: "Typing", category: "other" },
      { actor: actors[0] as Actor },
    );
    for (const [i, actor] of actors.entries())
      s.commands.run(C.open, { noteId, clientId: `t${i}` }, { actor, originConnId: `c${i}` });
    const PUSHES = 900;
    const times: number[] = [];
    let len = 0;
    const started = performance.now();
    for (let n = 0; n < PUSHES; n++) {
      const i = n % 3;
      const u: NoteUpdate = {
        clientId: `t${i}`,
        changes: ChangeSet.of(
          { from: len, insert: "abc"[i] as string },
          len,
        ).toJSON() as NoteUpdate["changes"],
      };
      const t0 = performance.now();
      const r = s.commands.run(
        C.push,
        { noteId, version: n, updates: [u] },
        { actor: actors[i] as Actor, originConnId: `c${i}` },
      ) as PushNoteResult;
      times.push(performance.now() - t0);
      expect(r).toEqual({ accepted: true });
      len++;
    }
    const total = performance.now() - started;
    const sorted = [...times].sort((a, b) => a - b);
    const pct = (p: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number;
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const perSecond = (PUSHES / total) * 1000;
    console.log(
      `NOTES fsync (3 typists, ${PUSHES} pushes, WAL + synchronous FULL): ${perSecond.toFixed(0)} commits/s sustained; per push avg ${avg.toFixed(2)} ms, p50 ${pct(0.5).toFixed(2)} ms, p95 ${pct(0.95).toFixed(2)} ms, max ${pct(1).toFixed(2)} ms; at 30 pushes/s ≈ ${((30 * avg) / 10).toFixed(1)}% of the server thread`,
    );
    // Loose guards (CI disks vary): the ADR's 30 pushes a second fit with room to spare.
    expect(perSecond).toBeGreaterThan(60);
    expect(pct(0.5)).toBeLessThan(15);
    closeDb(db);
  }, 120_000);
});

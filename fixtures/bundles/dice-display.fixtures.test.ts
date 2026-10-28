// Bundle `dice-display` (DICEX §13 sprint 4): `combat` + `rolls-1` + `dicex-looks` +
// `dicex-notation-text` as patches (seams S10). Loads from empty; the log history renders die
// chips (FR-DICE-35); CON-44 ceilings with the measured figures printed; per-player leak smoke
// over the snapshot and every lazy type's `sync.load` ack, before and after a restart.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeDb, type Db } from "@server/db/client";
import { campaign, diceLook, encounter, gameLogEntry, player } from "@server/db/schema";
import { SNAPSHOT_CEILING } from "@server/ws/hub";
import type { Viewer } from "@server/ws/records";
import { playerViewer, sourceOf } from "@server/ws/testing/convergence";
import {
  servicesFromBundle,
  snapshotFrames,
  snapshotSizes,
  type ViewerSize,
} from "@server/ws/testing/snapshot-size";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import { asc, eq } from "drizzle-orm";
import { loadBundle } from "../index";
import { SECRET_LABEL } from "../units/dice-roll-log/rolls-1";

const BUNDLE = "dice-display";

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

async function loaded() {
  const r = await loadBundle(BUNDLE, { testMode: true });
  cleanups.push(r.cleanup);
  const db = r.openDb();
  cleanups.unshift(() => closeDb(db));
  return { r, db };
}

const entriesOf = (db: Db) => db.select().from(gameLogEntry).orderBy(asc(gameLogEntry.n)).all();

describe("dice-display bundle (DICEX §13 sprint 4)", () => {
  test("FR-DICEX-42 dice-display loads from empty: combat, then rolls-1, looks and the notation row", async () => {
    const { r, db } = await loaded();
    expect(r.manifest.status).toBe("complete");
    expect(r.manifest.fixtures.slice(-3)).toEqual([
      "rolls-1",
      "dicex-looks",
      "dicex-notation-text",
    ]);
    for (const key of ["player-2", "char-thorn", "thorn-battlemap", "encounter-1"]) {
      expect(r.manifest.fixtures).toContain(key);
    }
    expect(r.manifest.playerLinks.map((p) => p.player)).toEqual(["Player 1", "Player 2"]);
    // The planned encounter for the walkthrough's Start (step 19).
    expect(
      db
        .select()
        .from(encounter)
        .all()
        .map((e) => [e.name, e.status]),
    ).toEqual([["Ambush at the Ford", "planned"]]);
    const players = db.select().from(player).all();
    const p1 = players.find((p) => p.name === "Player 1")?.id as string;
    expect(
      db
        .select()
        .from(diceLook)
        .all()
        .map((l) => l.ownerKey)
        .sort(),
    ).toEqual(["dm", p1].sort());
  }, 30_000);

  test("FR-DICE-35 dice-display log history: rolls-1 lines carry die chips (e4's manual 15 as a d20 + physical)", async () => {
    const { db } = await loaded();
    const rows = entriesOf(db);
    expect(rows.map((e) => [e.n, e.public])).toEqual([
      [1, true],
      [2, false],
      [3, false],
      [4, true],
    ]);
    const lines = rows.map((e) => formatEntry({ ...e, undone: e.undone }).segments);
    for (const segs of lines) expect(segs.some((s) => s.die)).toBe(true);
    const e1 = lines[0]?.filter((s) => s.die).map((s) => s.die?.faces);
    expect(e1).toEqual([20]);
    const e4 = lines[3] ?? [];
    expect(e4.filter((s) => s.die).map((s) => s.die)).toEqual([
      { faces: 20, value: 15, kept: true },
    ]);
    expect(lineText(e4)).toContain("(physical)");
  }, 30_000);
});

/** Figures for the report: whole frame and the three biggest types. */
const fmt = (s: ViewerSize) =>
  `${s.label} ${s.bytes} B (${Object.entries(s.types)
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .slice(0, 3)
    .map(([t, v]) => `${t} ${v.bytes}`)
    .join(", ")})`;

describe("CON-44 dice-display", () => {
  test("CON-44 dice-display snapshots under the ceilings: DM ≤ 1 MiB, every player ≤ 512 KiB", async () => {
    const b = await servicesFromBundle(await loadBundle(BUNDLE, { testMode: true }));
    cleanups.push(b.cleanup);
    const sizes = snapshotSizes(b.s);
    console.log(`CON-44 dice-display: ${sizes.map(fmt).join("; ")}`);
    expect(sizes.map((s) => s.label)).toEqual(["DM", "P1", "P2"]);
    for (const s of sizes)
      expect([s.label, s.bytes <= SNAPSHOT_CEILING[s.role]]).toEqual([s.label, true]);
  }, 60_000);
});

describe("dice-display leak smoke (every player)", () => {
  let r: Awaited<ReturnType<typeof loadBundle>>;
  beforeAll(async () => {
    r = await loadBundle(BUNDLE, { testMode: true });
    cleanups.push(r.cleanup);
  }, 30_000);

  async function scan(label: string) {
    const b = await servicesFromBundle({ ...r, cleanup() {} });
    try {
      const db = b.s.db;
      const cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
      const rows = entriesOf(db);
      const hidden = rows.filter((e) => !e.public).map((e) => e.id);
      expect(hidden).toHaveLength(2);
      const leaks = [SECRET_LABEL, "Perception", '"dmPayload"', ...hidden];
      for (const name of ["Player 1", "Player 2"]) {
        const pid = db.select().from(player).where(eq(player.name, name)).get()?.id as string;
        const v: Viewer = playerViewer(cid, pid);
        const frame = snapshotFrames(b.s).find((f) => f.viewer.playerId === pid);
        expect(frame).toBeDefined();
        const acks = b.s.records.lazyTypes().map((d) => b.s.records.load(sourceOf(b.s), v, d.type));
        const wire = { snapshot: JSON.stringify(frame?.records), acks: JSON.stringify(acks) };
        const found = leaks.flatMap((s) =>
          Object.entries(wire)
            .filter(([, json]) => json.includes(s))
            .map(([where]) => `${label} ${name} ${where}: ${s}`),
        );
        expect(found).toEqual([]);
        // Positive control: the public history arrives (e1 Scimitar, e4 Mira's initiative).
        const all = wire.snapshot + wire.acks;
        expect(all).toContain("Scimitar");
        for (const e of rows.filter((x) => x.public)) expect(all).toContain(e.id);
      }
    } finally {
      b.cleanup();
    }
  }

  test("FR-DICE-15 FR-DICE-36 leak smoke: no player's snapshot or sync.load acks carry the hidden rolls, before and after a restart", async () => {
    await scan("before");
    await scan("after restart");
  }, 60_000);
});

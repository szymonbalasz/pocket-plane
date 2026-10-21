// GEM GM1 over real sockets on `gems` (gems on, Mira's `gems-rolls` lines; DM, `player-1`,
// `player-2`): the Inspiration reroll live for every connection; leak scan per player (frames,
// snapshot, fresh connection, reconnect) for the DM's hidden DM-SECRET-GEM reroll; convergence;
// off → the gem traces go with the resync, on → back.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { GEM_SECRET_LABEL, GEMS_ROLLS } from "@fixtures/units/gems/gems-rolls";
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import type { GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { GEM_SPEND_INTENT } from "@shared/gems/schemas";
import type { Credential } from "@shared/protocol/frames";
import { recordsOf } from "@shared/protocol/store";
import { closeDb, type Db } from "../../db/client";
import { entity, gameLogEntry, player } from "../../db/schema";
import {
  startTestServer,
  TEST_SECRET,
  type TestClient,
  type TestServer,
} from "../../testing/harness";
import { convergence, leakScan } from "../../ws/testing/convergence";
import { SET_FEATURE_INTENT } from "../campaign-management/features";

let h: TestServer;
let db: Db;
let cleanup: () => void;
let tokens: Record<string, string>;
let mira: string;
let lines: Record<string, string>;

beforeAll(async () => {
  const loaded = await loadBundle("gems", { testMode: true, dmSecret: TEST_SECRET });
  cleanup = loaded.cleanup;
  db = loaded.openDb();
  tokens = Object.fromEntries(
    db
      .select()
      .from(player)
      .all()
      .map((r) => [r.name, r.linkToken]),
  );
  mira = db
    .select()
    .from(entity)
    .all()
    .find((e) => e.name === "Mira" && e.kind === "character")?.id as string;
  lines = Object.fromEntries(
    (db.select().from(gameLogEntry).all() as GameLogEntryRecord[])
      .filter((e) => e.kind === "roll" && e.actorName === "Mira")
      .map((e) => [(e.payload as { label: string | null }[])[0]?.label ?? "", e.id]),
  );
  h = await startTestServer({ db, testMode: true, fake: false });
}, 60_000);

afterAll(async () => {
  await h.stop();
  closeDb(db);
  try {
    cleanup();
  } catch {
    // Windows may hold the WAL briefly; a leftover temp dir is harmless.
  }
});

const DM: Credential = { role: "dm", secret: TEST_SECRET };
const P1 = (): Credential => ({ role: "player", token: tokens["Player 1"] as string });
const P2 = (): Credential => ({ role: "player", token: tokens["Player 2"] as string });

async function reply(c: TestClient, name: string, payload: unknown) {
  const intentId = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 3000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}
const ok = async (c: TestClient, name: string, payload: unknown) => {
  const f = await reply(c, name, payload);
  expect(f.type === "reject" ? JSON.stringify(f) : f.type).toBe("ack");
  return f.type === "ack"
    ? (f.result as { held: number; entryId: string; rerollEntryId: string })
    : null;
};
async function until(pred: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("condition not reached in time");
    await Bun.sleep(10);
  }
}
const entry = (c: TestClient, id: string) =>
  recordsOf<GameLogEntryRecord>(c.store, "game-log-entry").find((e) => e.id === id);
const text = (e: GameLogEntryRecord | undefined) => (e ? lineText(formatEntry(e).segments) : null);

describe("gems reroll over real sockets (gems)", () => {
  test("FR-GEM-19 FR-GEM-13 FR-GEM-24 reroll live: P1's e-perc for everyone; the DM's hidden reroll never reaches a player (frames, snapshot, fresh, reconnect); convergence", async () => {
    const dm = await h.live(DM);
    let p1 = await h.live(P1());
    const p2 = await h.live(P2());
    const perc = lines[GEMS_ROLLS.perception] as string;
    const secret = lines[GEM_SECRET_LABEL] as string;
    expect([perc, secret].every(Boolean)).toBe(true);

    // player-1 rerolls Mira's Perception: struck old line + spend + new line for all three.
    const r = await ok(p1, GEM_SPEND_INTENT, {
      characterId: mira,
      gem: "inspiration",
      entryId: perc,
      manual: { diceTotal: 15 },
    });
    await until(() => [dm, p1, p2].every((c) => entry(c, perc)?.supersededBy === r?.rerollEntryId));
    for (const c of [dm, p1, p2]) {
      expect(text(entry(c, r?.entryId as string))).toBe(
        "Mira spends an Inspiration gem — rerolls Perception (7)",
      );
      expect(text(entry(c, r?.rerollEntryId as string))).toBe(
        "Mira — Perception (reroll, was 7): 15 + 3 = 18 (physical)",
      );
    }

    // The DM rerolls the hidden DM-SECRET-GEM line for Mira.
    const start = [p1.frames.length, p2.frames.length];
    const s = await ok(dm, GEM_SPEND_INTENT, {
      characterId: mira,
      gem: "inspiration",
      entryId: secret,
    });
    await until(() => entry(dm, secret)?.supersededBy === s?.rerollEntryId);
    await until(() => [p1, p2].every((c) => entry(c, s?.entryId as string) !== undefined));
    for (const [i, c] of [p1, p2].entries()) {
      expect(text(entry(c, s?.entryId as string))).toBe("Mira spends an Inspiration gem");
      expect(entry(c, s?.rerollEntryId as string)).toBeUndefined();
      expect(JSON.stringify(c.frames.slice(start[i]))).not.toContain(GEM_SECRET_LABEL);
      expect(JSON.stringify(c.frames)).not.toContain(GEM_SECRET_LABEL);
      expect(leakScan(h.s, c)).toEqual([]);
    }
    expect(text(entry(dm, s?.entryId as string))).toBe(
      `Mira spends an Inspiration gem — rerolls ${GEM_SECRET_LABEL} (8)`,
    );
    // A player naming the hidden line → not_found.
    const hidden = await reply(p1, GEM_SPEND_INTENT, {
      characterId: mira,
      gem: "inspiration",
      entryId: s?.rerollEntryId,
    });
    expect(hidden.type === "reject" && hidden.code).toBe("not_found");

    // Fresh connections and a reconnect converge with the live stores; no secret.
    for (const c of [dm, p1, p2]) {
      const fresh = await h.live(c === dm ? DM : c === p1 ? P1() : P2());
      const { live, fresh: f } = convergence(h.s, c, fresh);
      expect(live).toEqual(f);
      if (c !== dm) expect(JSON.stringify(fresh.frames)).not.toContain(GEM_SECRET_LABEL);
      fresh.close();
    }
    p1.close();
    p1 = await h.live(P1());
    expect(entry(p1, perc)?.supersededBy).toBe(r?.rerollEntryId as string);
    expect(JSON.stringify(p1.frames)).not.toContain(GEM_SECRET_LABEL);
    expect(leakScan(h.s, p1)).toEqual([]);

    // FR-GEM-05: off → one resync; the struck lines and spend lines gone, final rolls stay.
    await ok(dm, SET_FEATURE_INTENT, { feature: GEMS_FEATURE, on: false });
    await until(() => [dm, p1, p2].every((c) => entry(c, perc) === undefined));
    for (const c of [dm, p1, p2]) {
      expect(entry(c, r?.entryId as string)).toBeUndefined();
      expect(text(entry(c, r?.rerollEntryId as string))).toBe(
        "Mira — Perception: 15 + 3 = 18 (physical)",
      );
      expect(leakScan(h.s, c)).toEqual([]);
    }
    await ok(dm, SET_FEATURE_INTENT, { feature: GEMS_FEATURE, on: true });
    await until(() => [dm, p1, p2].every((c) => entry(c, perc)?.supersededBy !== undefined));
    for (const c of [dm, p1, p2]) c.close();
  }, 60_000);
});

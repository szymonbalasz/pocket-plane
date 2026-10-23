// RECAP §12 bench gate FR-RECAP-25 (run alone via `bun run bench`): stats' 100-session history
// (`stats/testing.ts`'s `history`: ≈ 92k log entries, 32k `hp_change`) + 12 loot rows a session.
// Gate: one recap ≤ 50 ms for the DM and a player (compute, no memo), mid and newest session.
// Also logged: the memo hit and the ack sizes (FR-RECAP-18: ≤ 64 KB).
import { beforeAll, describe, expect, test } from "bun:test";
import { best, GATE_TIMEOUT, logResults } from "@shared/bench-kit";
import { RECAP_ACK_MAX_BYTES, RECAP_QUERY_INTENT } from "@shared/session-recap/schemas";
import { fixedClock } from "../../commands/context";
import { lootEntry } from "../../db/schema";
import { SessionCache } from "../stats/cache";
import type { StatsRead } from "../stats/compute";
import { history, type StatsSetup, statsSetup } from "../stats/testing";
import { recapBody, recapFor, recapHeader } from "./compose";

const GATE_MS = 50;
const LOOT_PER_SESSION = 12;

/** 12 `world → party` / `party → world` / item rows inside each synthetic session. */
function loot(t: StatsSetup) {
  const cid = t.h.campaignId;
  const t0 = fixedClock("2026-02-01T18:00:00Z").now();
  const rows = [];
  let seq = 0;
  for (let s = 0; s < 100; s++) {
    for (let i = 0; i < LOOT_PER_SESSION; i++) {
      const at = fixedClock(t0 + s * 24 * 3600_000 + i * 60_000 + 5_000).iso();
      const item = i % 4 === 3;
      rows.push({
        id: `b-l-${s}-${i}`,
        campaignId: cid,
        seq: ++seq,
        kind: item ? ("item" as const) : ("loot" as const),
        fromKind: i % 5 === 4 ? ("party" as const) : ("world" as const),
        toKind: i % 5 === 4 ? ("world" as const) : ("party" as const),
        text: item ? `Gem ${i}` : `Purse ${s}.${i}`,
        cp: 0,
        sp: item ? 0 : i,
        ep: 0,
        gp: item ? 0 : 3,
        pp: 0,
        qty: item ? 1 : null,
        createdAt: at,
      });
    }
  }
  for (let i = 0; i < rows.length; i += 200) {
    t.s.db
      .insert(lootEntry)
      .values(rows.slice(i, i + 200))
      .run();
  }
}

describe("RECAP §12 bench gate (100 sessions)", () => {
  let t: StatsSetup;
  beforeAll(() => {
    t = statsSetup();
    history(t);
    loot(t);
  }, 120_000);

  test(
    "FR-RECAP-25 one recap ≤ 50 ms for the DM and a player (mid and newest session)",
    async () => {
      const read = (role: "dm" | "player"): StatsRead => ({
        db: t.s.db,
        viewer: { role, features: [] },
        campaignId: t.h.campaignId,
      });
      const sessions = new SessionCache().sessions(t.s.db, t.h.campaignId);
      const mid = sessions[50] as (typeof sessions)[number];
      const newest = sessions.at(-1) as (typeof sessions)[number];
      const ms: Record<string, number> = {};
      const size: Record<string, number> = {};
      for (const role of ["dm", "player"] as const) {
        const r = read(role);
        for (const [name, s] of [
          ["mid", mid],
          ["newest", newest],
        ] as const) {
          ms[`${role} ${name} ms`] = await best(() => recapBody(r, sessions, s), GATE_MS);
        }
        const body = recapBody(r, sessions, mid);
        expect(body.fights.length).toBeGreaterThan(0);
        expect(body.loot.rows.length).toBe(LOOT_PER_SESSION);
        const ack = recapFor(role, recapHeader({ s: mid, span: mid }), body, null);
        size[`${role} ack B`] = Buffer.byteLength(JSON.stringify({ recap: ack }));
      }
      // A memo hit through the command (the fan-out's 5 other clients, FR-RECAP-29).
      t.clock.advance(1000);
      t.run(RECAP_QUERY_INTENT, { n: mid.fromN });
      const hit = await best(() => t.run(RECAP_QUERY_INTENT, { n: mid.fromN }), GATE_MS);
      logResults("RECAP §12 (100 sessions, 12 loot rows each)", {
        ...ms,
        ...size,
        "memo hit ms": hit,
      });
      for (const v of Object.values(ms)) expect(v).toBeLessThanOrEqual(GATE_MS);
      for (const v of Object.values(size)) expect(v).toBeLessThanOrEqual(RECAP_ACK_MAX_BYTES);
    },
    GATE_TIMEOUT * 2,
  );
});

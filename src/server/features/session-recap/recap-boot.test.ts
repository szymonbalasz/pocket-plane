// Session recap on loaded bundles, in-process: FR-STATS-78 the recap seam (the recap's compose over
// `stats-b` equals the Stats acks it is built from) and the `recap.share` crash seam (#163): one
// transaction with its log row; before-commit → nothing, after-commit → all of it.
import { afterEach, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import {
  type DmRecapResult,
  RECAP_QUERY_INTENT,
  RECAP_SHARE_INTENT,
  SESSION_RECAP_KIND,
} from "@shared/session-recap/schemas";
import {
  type DmFightResult,
  type DmLuckResult,
  type SessionResult,
  STATS_QUERY_INTENT,
} from "@shared/stats/schemas";
import { eq } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { closeDb, type Db } from "../../db/client";
import { stateDigest } from "../../db/digest";
import { campaign, notification, player } from "../../db/schema";
import type { Actor } from "../../events/types";
import { silentLogger } from "../../log";
import { createServices } from "../../services";
import { createTestServices, DM_ACTOR } from "../../testing/services";

afterEach(() => armCrashHook(null));

class Killed extends Error {}
const kill = () => {
  throw new Killed();
};

async function boot(openDb: () => Db) {
  const db = openDb();
  const s = createServices({ config: createTestServices().config, db, log: silentLogger });
  for (const h of s.startHooks) await h.fn(s);
  const cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
  const dm: Actor = { ...DM_ACTOR, campaignId: cid };
  const p1: Actor = {
    role: "player",
    playerId: db.select().from(player).where(eq(player.name, "Player 1")).get()?.id as string,
    campaignId: cid,
  };
  const run = <R>(name: string, input: unknown, actor: Actor = dm) =>
    s.commands.run(name, input, { actor }) as R;
  return { s, db, dm, p1, run, close: () => closeDb(db) };
}

const tidy = (cleanup: () => void) => {
  try {
    cleanup();
  } catch {
    // Windows may hold the temp dir a moment longer; the OS cleans it up.
  }
};

test("FR-STATS-78 recap seam: the recap's compose over stats-b equals the Stats acks it is built from", async () => {
  const loaded = await loadBundle("stats-b", { testMode: true });
  const b = await boot(loaded.openDb);
  try {
    for (const actor of [b.dm, b.p1]) {
      // One actor's Stats answers (4 a second) and the recap (2 a second): separate budgets.
      const recap = b.run<DmRecapResult>(RECAP_QUERY_INTENT, {}, actor).recap;
      if (!recap) throw new Error("no recap");
      const session = b.run<SessionResult>(STATS_QUERY_INTENT, { scope: "session" }, actor);
      expect(recap.awards).toEqual(session.session?.awards ?? []);
      expect(recap.fromN).toBe(session.session?.fromN as number);
      const luck = b.run<DmLuckResult>(STATS_QUERY_INTENT, { scope: "luck" }, actor).luck.rows;
      for (const row of recap.party) {
        const l = luck.find((x) => x.key === row.characterId);
        expect([row.nat20, row.nat1, row.avg]).toEqual([
          l?.nat20 ?? 0,
          l?.nat1 ?? 0,
          l?.avg ?? null,
        ]);
      }
      for (const fight of recap.fights) {
        const stats = b.run<DmFightResult>(
          STATS_QUERY_INTENT,
          { scope: "fight", encounterId: fight.key },
          actor,
        ).fight;
        expect(fight.label).toBe(stats?.label as string);
        const h = stats?.highlights;
        if (!h) throw new Error(`no highlights for ${fight.label}`);
        expect({ mvp: fight.mvp, kills: fight.kills, downed: fight.downed }).toEqual({
          mvp: h.mvp,
          kills: h.kills,
          downed: h.downed,
        });
        if (actor === b.dm) expect(fight.standing).toEqual(h.standing);
      }
    }
  } finally {
    b.close();
    tidy(loaded.cleanup);
  }
}, 120_000);

test("FR-RECAP-20 crash seam: recap.share before / after commit (state:digest)", async () => {
  const loaded = await loadBundle("sp-s9", { testMode: true });
  try {
    const shares = (b: { db: Db }) =>
      b.db.select().from(notification).where(eq(notification.kind, SESSION_RECAP_KIND)).all();
    const share = (b: Awaited<ReturnType<typeof boot>>) =>
      b.run(RECAP_SHARE_INTENT, { fromN: 1, note: "Crash test" });
    let b = await boot(loaded.openDb);
    const before = stateDigest(b.db.$client).sha256;
    armCrashHook({ point: "before-commit", target: RECAP_SHARE_INTENT }, kill);
    expect(() => share(b)).toThrow();
    armCrashHook(null);
    b.close();
    b = await boot(loaded.openDb);
    expect(stateDigest(b.db.$client).sha256).toBe(before);
    expect(shares(b)).toEqual([]);
    armCrashHook({ point: "after-commit", target: RECAP_SHARE_INTENT }, kill);
    expect(() => share(b)).toThrow(Killed);
    armCrashHook(null);
    const committed = stateDigest(b.db.$client).sha256;
    expect(committed).not.toBe(before);
    b.close();
    b = await boot(loaded.openDb);
    expect(stateDigest(b.db.$client).sha256).toBe(committed);
    expect(shares(b).map((n) => n.text)).toEqual([expect.stringMatching(/^Session recap: /)]);
    expect(b.run<DmRecapResult>(RECAP_QUERY_INTENT, {}).recap?.shared?.note).toBe("Crash test");
    b.close();
  } finally {
    tidy(loaded.cleanup);
  }
}, 120_000);

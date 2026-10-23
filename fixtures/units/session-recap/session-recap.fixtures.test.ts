// RECAP §13 fixtures: `recap-loot-haul`, `recap-share-note`; bundles `sp-s9`, `sp-s9-shared` and
// their e2e aliases load from empty, and the recap reads what the units' headers list.
import { afterAll, describe, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import { campaign, notification, player } from "@server/db/schema";
import type { Actor } from "@server/events/types";
import { silentLogger } from "@server/log";
import { createServices } from "@server/services";
import { createTestServices } from "@server/testing/services";
import {
  type DmRecap,
  type PlayerRecap,
  RECAP_QUERY_INTENT,
  SESSION_RECAP_KIND,
} from "@shared/session-recap/schemas";
import { eq } from "drizzle-orm";
import { loadBundle } from "../../index";
import { FIXTURE_SESSION_FROM_N, RECAP_SHARE_NOTE } from "./recap-share-note";

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

async function load(bundle: string) {
  const r = await loadBundle(bundle, { testMode: true });
  cleanups.push(r.cleanup);
  const db = r.openDb();
  cleanups.unshift(() => closeDb(db));
  const s = createServices({ config: createTestServices().config, db, log: silentLogger });
  for (const h of s.startHooks) await h.fn(s);
  const cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
  const dm: Actor = { role: "dm", playerId: null, campaignId: cid };
  const p1: Actor = {
    role: "player",
    playerId: db.select().from(player).where(eq(player.name, "Player 1")).get()?.id as string,
    campaignId: cid,
  };
  const recap = <R>(actor: Actor) =>
    (s.commands.run(RECAP_QUERY_INTENT, {}, { actor }) as { recap: R }).recap;
  return { r, db, dm, p1, recap };
}

describe("session-recap fixtures", () => {
  test("FR-RECAP-14 sp-s9 loads from empty: the recap reads the units' headers", async () => {
    const t = await load("sp-s9");
    expect(t.r.manifest.fixtures.at(-1)).toBe("recap-loot-haul");
    const dm = t.recap<DmRecap>(t.dm);
    const p = t.recap<PlayerRecap>(t.p1);
    expect(dm.fromN).toBe(FIXTURE_SESSION_FROM_N);
    expect(dm.fights.map((f) => f.label)).toEqual([
      "Old Crypt",
      "Bandit Camp",
      "Ambush at the Ford",
    ]);
    expect(dm.fights[1]?.kills.events.map((e) => [e.to, e.hidden])).toEqual([
      ["Bandit", false],
      ["Bandit Captain", true],
    ]);
    expect(dm.fights[1]?.standing.map((s) => s.name)).toEqual(["Bandit 2", "Bandit 3"]);
    expect(p.fights.map((f) => f.label.replace(/ · .*/, ""))).toEqual([
      "Fight 1",
      "Fight 2",
      "Fight 3",
    ]);
    expect(p.fights[1]?.kills.events.map((e) => e.to)).toEqual(["Bandit"]);
    const tally = (x: DmRecap | PlayerRecap) =>
      (x.party ?? []).slice(0, 2).map((r) => [r.name, r.dealt, r.kills, r.downed]);
    expect(tally(dm)).toEqual([
      ["Thorn", 63, 3, 1],
      ["Mira", 25, 1, 1],
    ]);
    expect(tally(p)).toEqual([
      ["Thorn", 43, 2, 1],
      ["Mira", 25, 1, 1],
    ]);
    expect(dm.rolls.rows).toHaveLength(6);
    expect(dm.rolls.rows.filter((x) => x.hidden).map((x) => x.name)).toEqual(["Thorn"]);
    expect(p.rolls?.rows).toHaveLength(4);
    expect(p.loot).toEqual(dm.loot);
    expect(dm.loot.rows).toHaveLength(13);
    expect(dm.loot.rows.slice(-4).map((x) => x.text)).toEqual([
      "Bandit Camp strongbox",
      "Healer's fee",
      "Bandit captain's map",
      "Silver ring",
    ]);
    expect(dm.loot.totals).toEqual({
      coins: { cp: 0, sp: 55, ep: 0, gp: 109, pp: 5 },
      items: [
        { name: "Potion of healing", qty: 2 },
        { name: "Torch", qty: 10 },
        { name: "Rope (50 ft)", qty: 1 },
        { name: "Bandit captain's map", qty: 1 },
      ],
    });
  }, 120_000);

  test("FR-RECAP-22 sp-s9-shared: one share with the note, Notable rolls left out for players", async () => {
    const t = await load("sp-s9-shared");
    const rows = t.db
      .select()
      .from(notification)
      .where(eq(notification.kind, SESSION_RECAP_KIND))
      .all();
    expect(rows.map((n) => [n.audience, n.state])).toEqual([["all", "info"]]);
    const p = t.recap<PlayerRecap>(t.p1);
    expect(p.shared).toMatchObject({ note: RECAP_SHARE_NOTE, omit: ["rolls"] });
    expect(p.rolls).toBeUndefined();
    expect(t.recap<DmRecap>(t.dm).rolls.rows).toHaveLength(6);
  }, 120_000);

  test("FR-RECAP-14 e2e aliases load", async () => {
    for (const bundle of ["sp-s9-e2e", "sp-s9-shared-e2e"]) {
      const r = await loadBundle(bundle, { testMode: true });
      cleanups.push(r.cleanup);
      expect(r.manifest.status).toBe("complete");
    }
  }, 240_000);
});

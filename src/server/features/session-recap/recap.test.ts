// Session recap in-process (RECAP §13): the read path per role (FR-RECAP-01–09), the sections
// (FR-RECAP-12–16), the rate limit and memo (FR-RECAP-05, -29), the share (FR-RECAP-20–23), over
// stats' started ambush (Mira = Player 1, Thorn = Player 2; Goblin, Goblin 2 visible; Wolf, Elite
// hidden).
import { describe, expect, test } from "bun:test";
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import { CBT_INTENTS, type EncounterRecord } from "@shared/combat-tracker/schemas";
import { GEM_ADJUST_INTENT } from "@shared/gems/schemas";
import {
  type DmRecap,
  type PlayerRecap,
  RECAP_FIGHTS_MAX,
  RECAP_LOOT_MAX,
  RECAP_NOTE_MAX,
  RECAP_QUERY_INTENT,
  RECAP_ROLLS_MAX,
  RecapShareInput,
  SESSION_RECAP_KIND,
  SessionRecapPayload,
} from "@shared/session-recap/schemas";
import { and, eq } from "drizzle-orm";
import { eventLog, gameLogEntry, notification } from "../../db/schema";
import { SET_FEATURE_INTENT } from "../campaign-management/features";
import { createEncounter } from "../combat-tracker/encounters";
import { applyHp } from "../combat-tracker/hp";
import { startCommand } from "../combat-tracker/lifecycle";
import { notificationKindOf } from "../notifications/helpers";
import { notificationKinds } from "../notifications/kinds";
import { addItem } from "../party-board/commands";
import { recapSetup } from "./testing";

const HOUR = 60 * 60 * 1000;
type T = ReturnType<typeof recapSetup>;

const shares = (t: T) =>
  t.s.db.select().from(notification).where(eq(notification.kind, SESSION_RECAP_KIND)).all();

/** Ends fight `prev`, starts a fresh one (Mira, Thorn vs 1 Goblin), Thorn hits the Goblin for 1. */
function nextFight(t: T, prev: string, name: string): string {
  t.run(CBT_INTENTS.end, { encounterId: prev });
  const enc = t.run<EncounterRecord>(createEncounter.name, {
    name,
    partyCharacterIds: null,
    entries: [{ definitionId: t.h.goblinId, quantity: 1 }],
  });
  t.run(startCommand.name, { encounterId: enc.id, sceneId: t.sceneId });
  const cs = t.combatants(enc.id);
  t.run(applyHp.name, {
    combatantId: cs.find((c) => c.kind === "monster")?.id,
    kind: "damage",
    amount: 1,
    public: true,
    sourceId: cs.find((c) => c.entityId === t.thornId)?.id,
  });
  return enc.id;
}

describe("FR-RECAP-01 read path", () => {
  test("FR-RECAP-01 read-only: no row, event, log row or seq", () => {
    const t = recapSetup();
    t.hp("Goblin", "damage", 3, { from: "Thorn" });
    const count = () => ({
      log: t.s.db.select().from(eventLog).all().length,
      entries: t.s.db.select().from(gameLogEntry).all().length,
      notes: t.s.db.select().from(notification).all().length,
      events: t.events.length,
    });
    const before = count();
    t.recap();
    t.recap(t.p1);
    expect(count()).toEqual(before);
  });

  test("FR-RECAP-02 any n resolves to its session; an unlisted or unknown n → not_found", () => {
    const t = recapSetup();
    t.hp("Goblin", "damage", 3, { from: "Thorn" });
    const first = t.recap() as DmRecap;
    expect(first.fromN).toBe(1);
    expect(t.recap(t.h.dm, first.toN)?.fromN).toBe(first.fromN);
    // A second sitting with only a hidden line: the DM lists it, players don't.
    t.clock.advance(7 * HOUR);
    const hidden = t.roll("Thorn", 12, { public: false });
    const n = t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, hidden.entryId)).get()
      ?.n as number;
    expect(t.recap(t.h.dm, n)?.fromN).toBe(n);
    expect(t.err(() => t.recap(t.p1, n)).code).toBe("not_found");
    expect(t.err(() => t.recap(t.h.dm, 9999)).code).toBe("not_found");
    // Players' newest is the first sitting.
    expect(t.recap<PlayerRecap>(t.p1)?.fromN).toBe(first.fromN);
  });

  test("FR-RECAP-17 empty states: players with no session → null; the DM's session with nothing counted", () => {
    const t = recapSetup();
    // Start rolled initiative on DM-only lines: the DM lists a session, players none yet.
    expect(t.recap(t.p1)).toBeNull();
    const r = t.recap() as DmRecap;
    expect([r.fights, r.party, r.loot.rows, r.rolls.rows]).toEqual([[], [], [], []]);
    expect(r.awards.every((a) => a.value === null)).toBe(true);
  });
});

describe("FR-RECAP-03 filter, then aggregate", () => {
  test("FR-RECAP-03 same recap for player-1 and player-2", () => {
    const t = recapSetup();
    t.hp("Goblin", "damage", 5, { from: "Thorn" });
    t.hp("Wolf", "damage", 6, { from: "Mira", public: false });
    t.roll("Mira", 20, { actor: t.p1 });
    t.roll("Thorn", 20, { public: false });
    expect(t.recap(t.p1)).toEqual(t.recap(t.p2));
  });

  test("FR-RECAP-03 undone and superseded excluded", () => {
    const t = recapSetup();
    t.hp("Goblin", "damage", 3, { from: "Thorn" });
    t.undo(t.hp("Goblin", "damage", 4, { from: "Thorn" }));
    const old = t.roll("Thorn", 1, { actor: t.p2 });
    const reroll = t.roll("Thorn", 20, { actor: t.p2 });
    t.s.db
      .update(gameLogEntry)
      .set({ supersededBy: reroll.entryId })
      .where(eq(gameLogEntry.id, old.entryId))
      .run();
    t.gate().bump(t.h.campaignId);
    for (const actor of [t.h.dm, t.p1]) {
      const r = t.recap(actor) as DmRecap;
      const thorn = r.party.find((p) => p.name === "Thorn");
      expect(thorn).toMatchObject({ dealt: 3, nat1: 0, nat20: 1 });
      expect(r.rolls.rows.map((x) => x.natural)).toEqual([20]);
    }
  });

  test("FR-RECAP-03 gems-tagged lines skipped while off", () => {
    const t = recapSetup();
    t.hp("Goblin", "damage", 5, { from: "Thorn" });
    t.run(SET_FEATURE_INTENT, { feature: GEMS_FEATURE, on: true });
    t.clock.advance(7 * HOUR);
    t.run(GEM_ADJUST_INTENT, { characterId: t.thornId, gem: "inspiration", delta: 1 });
    const gemOnly = t.recap() as DmRecap;
    expect(gemOnly.fromN).toBeGreaterThan(1);
    t.run(SET_FEATURE_INTENT, { feature: GEMS_FEATURE, on: false });
    // Off: the gem line is skipped for every viewer, the DM too: its sitting is gone.
    expect(t.recap()?.fromN).toBe(1);
    expect(t.err(() => t.recap(t.h.dm, gemOnly.fromN)).code).toBe("not_found");
  });

  test("FR-RECAP-07 three sittings (injected clock) → three recaps", () => {
    const t = recapSetup();
    const keys: number[] = [];
    for (const dmg of [2, 3, 4]) {
      t.hp("Goblin 2", "damage", dmg, { from: "Mira" });
      keys.push((t.recap() as DmRecap).fromN);
      t.clock.advance(7 * HOUR);
    }
    expect(new Set(keys).size).toBe(3);
    expect(keys.map((n) => (t.recap(t.h.dm, n) as DmRecap).party[0]?.dealt)).toEqual([2, 3, 4]);
  });
});

describe("FR-RECAP-08 per role", () => {
  test("FR-RECAP-08 FR-RECAP-09 players: neutral labels, no hidden monster or roll; the DM: names, marks, standing, DM dice", () => {
    const t = recapSetup();
    t.hp("Wolf", "damage", 999, { from: "Thorn", public: false });
    t.hp("Goblin", "damage", 30, { from: "Mira" });
    t.roll("Thorn", 20, { public: false });
    const dm = t.recap() as DmRecap;
    const fight = dm.fights[0];
    expect(fight?.label).toBe("Ambush at the Ford");
    expect(fight?.kills.events.map((e) => [e.to, e.hidden])).toEqual([
      ["Wolf", true],
      ["Goblin", false],
    ]);
    expect(fight?.kills.events[1]?.overkill).toBeGreaterThan(0);
    expect(fight?.standing.map((s) => s.name)).toEqual(["Goblin 2", "Elite Goblin Warrior"]);
    expect(dm.rolls.rows).toEqual([expect.objectContaining({ name: "Thorn", hidden: true })]);
    const p = t.recap<PlayerRecap>(t.p1) as PlayerRecap;
    const text = JSON.stringify(p);
    for (const leak of [
      "Wolf",
      "Elite",
      "Ambush at the Ford",
      '"hidden"',
      '"standing"',
      '"overkill"',
    ]) {
      expect(text).not.toContain(leak);
    }
    expect(p.fights[0]?.label).toMatch(/^Fight 1 · /);
    expect(p.rolls?.rows).toEqual([]);
  });
});

describe("FR-RECAP-12–16 sections", () => {
  test("FR-RECAP-12 fight lines per role: oldest first, running, ≤ 12 then more", () => {
    const t = recapSetup();
    t.hp("Goblin", "damage", 2, { from: "Thorn" });
    let prev = t.enc.id;
    for (let i = 1; i <= RECAP_FIGHTS_MAX; i++) prev = nextFight(t, prev, `Fight ${i + 1}`);
    // 13 fights with a fact: 12 listed, oldest first, then "+1 more".
    for (const actor of [t.h.dm, t.p1]) {
      const r = t.recap(actor) as DmRecap;
      expect(r.fights).toHaveLength(RECAP_FIGHTS_MAX);
      expect(r.fightsMore).toBe(1);
      expect(r.fights[0]?.status).toBe("ended");
      expect(r.fights[0]?.duration).not.toBeNull();
    }
    expect((t.recap() as DmRecap).fights[0]?.label).toBe("Ambush at the Ford");
  });

  test("FR-RECAP-13 party rows: companion roll-up, by Dealt", () => {
    const t = recapSetup();
    t.run(CBT_INTENTS.setCompanion, {
      combatantId: t.id("Goblin 2"),
      owner: { characterId: t.miraId },
    });
    t.hp("Goblin", "damage", 7, { from: "Goblin 2" });
    t.hp("Goblin 2", "damage", 2, { from: "Thorn" });
    t.roll("Thorn", 20, { actor: t.p2 });
    for (const actor of [t.h.dm, t.p1]) {
      const r = t.recap(actor) as DmRecap;
      expect(r.party.map((p) => [p.name, p.dealt, p.kills])).toEqual([
        ["Mira", 7, 1],
        ["Thorn", 2, 0],
      ]);
      expect(r.party[1]).toMatchObject({ nat20: 1, avg: 20 });
    }
  });

  test("FR-RECAP-14 loot range: between sessions → earlier; moves out; totals complete past 60", () => {
    const t = recapSetup();
    t.hp("Goblin", "damage", 1, { from: "Thorn" });
    t.loot({ text: "Chest", gp: 10 });
    t.clock.advance(3 * HOUR);
    // In the ≥ 6 h gap: the earlier session's.
    t.loot({ text: "Gap coins", sp: 5 });
    t.move({ from: { kind: "party" }, to: { kind: "character", characterId: t.miraId }, gp: 4 });
    t.move({ from: { kind: "world" }, to: { kind: "character", characterId: t.thornId }, gp: 2 });
    t.run(addItem.name, { name: "Map", qty: 1, notes: "" });
    t.clock.advance(4 * HOUR);
    t.hp("Goblin 2", "damage", 1, { from: "Thorn" });
    for (let i = 0; i < RECAP_LOOT_MAX + 1; i++) t.loot({ text: `Coin ${i}`, cp: 1 });
    const first = t.recap(t.h.dm, 1) as DmRecap;
    expect(first.loot.rows.map((r) => r.text)).toEqual(["Chest", "Gap coins", "", "Map"]);
    expect(first.loot.rows[2]).toMatchObject({
      holder: { kind: "character", name: "Thorn" },
      coins: { gp: 2 },
    });
    expect(first.loot.totals).toEqual({
      coins: { cp: 0, sp: 5, ep: 0, gp: 12, pp: 0 },
      items: [{ name: "Map", qty: 1 }],
    });
    const second = t.recap() as DmRecap;
    expect(second.loot.rows).toHaveLength(RECAP_LOOT_MAX);
    expect(second.loot.more).toBe(1);
    expect(second.loot.totals.coins.cp).toBe(RECAP_LOOT_MAX + 1);
    expect(t.recap<PlayerRecap>(t.p1)?.loot).toEqual(second.loot);
  });

  test("FR-RECAP-14 stores rows never in a recap (a hidden Stores with coins and an item)", () => {
    const t = recapSetup();
    t.hp("Goblin", "damage", 1, { from: "Thorn" });
    const { strongholdId } = t.run<{ strongholdId: string }>("hold.create", {
      name: "HIDDEN-KEEP",
    });
    const stores = { kind: "stores", strongholdId };
    t.move({ from: { kind: "world" }, to: stores, gp: 77, text: "STORES-SECRET-COIN" });
    t.run(addItem.name, {
      name: "STORES-SECRET-ITEM",
      qty: 1,
      notes: "",
      holder: stores,
    });
    t.loot({ text: "Public chest", gp: 1 });
    for (const actor of [t.h.dm, t.p1, t.p2]) {
      const r = t.recap(actor) as DmRecap;
      const text = JSON.stringify(r);
      expect(text).not.toContain("STORES-SECRET");
      expect(text).not.toContain("HIDDEN-KEEP");
      expect(r.loot.rows.map((x) => x.text)).toEqual(["Public chest"]);
      expect(r.loot.totals.coins.gp).toBe(1);
    }
  });

  test("FR-RECAP-15 nat lines: initiative out, ≤ 12 then more, players public only", () => {
    const t = recapSetup();
    t.roll("Mira", 20, { actor: t.p1, category: "initiative" });
    t.roll("Mira", 1, { actor: t.p1 });
    for (let i = 0; i < RECAP_ROLLS_MAX; i++) t.roll("Thorn", 20, { actor: t.p2 });
    t.roll("Thorn", 20, { public: false });
    const dm = t.recap() as DmRecap;
    expect(dm.rolls.rows).toHaveLength(RECAP_ROLLS_MAX);
    expect(dm.rolls.rows[0]).toMatchObject({ name: "Mira", natural: 1, hidden: false });
    expect(dm.rolls.more).toBe(2);
    const p = t.recap<PlayerRecap>(t.p1) as PlayerRecap;
    expect(p.rolls?.more).toBe(1);
    expect(p.rolls?.rows.every((r) => !("hidden" in r))).toBe(true);
    // Each row names its listing entry.
    const ids = new Set(
      t.s.db
        .select()
        .from(gameLogEntry)
        .all()
        .map((e) => e.id),
    );
    expect(dm.rolls.rows.every((r) => ids.has(r.id))).toBe(true);
  });

  test("FR-RECAP-16 awards: the session's nine, as Stats' Session tab", () => {
    const t = recapSetup();
    t.hp("Goblin", "damage", 9, { from: "Thorn" });
    for (const actor of [t.h.dm, t.p1]) {
      const r = t.recap(actor) as DmRecap;
      expect(r.awards).toEqual(t.session(actor).session?.awards ?? []);
    }
  });
});

describe("FR-RECAP-05 rate limit and FR-RECAP-29 memo", () => {
  test("FR-RECAP-05 rate limit coalesces: ≤ 2 computes per actor a second; the excess gets the last answer, else conflict", () => {
    const t = recapSetup();
    for (let i = 0; i < 3; i++) {
      t.hp("Goblin 2", "damage", 1, { from: "Mira" });
      t.clock.advance(7 * HOUR);
    }
    const keys = t
      .memory()
      .cache.sessions(t.s.db, t.h.campaignId)
      .map((x) => x.fromN);
    expect(keys).toHaveLength(3);
    t.clock.advance(1000);
    const ask = (n: number) => t.run(RECAP_QUERY_INTENT, { n });
    ask(keys[0] as number);
    ask(keys[1] as number);
    // A third computed answer in the same second, with no memo for it: refused.
    expect(t.err(() => ask(keys[2] as number)).code).toBe("conflict");
    // A stale memo: coalesced into the last answer (no compute).
    t.gate().bump(t.h.campaignId);
    const computed = t.gate().computed;
    expect(ask(keys[0] as number)).toBeTruthy();
    expect(t.gate().computed).toBe(computed);
    // Another actor has its own budget.
    expect(t.run(RECAP_QUERY_INTENT, { n: keys[2] }, t.p1)).toBeTruthy();
  });

  test("FR-RECAP-29 seven concurrent recap.query → ≤ 2 computes", () => {
    const t = recapSetup();
    t.hp("Goblin", "damage", 3, { from: "Thorn" });
    t.clock.advance(1000);
    const before = t.gate().computed;
    const actors = [t.h.dm, t.p1, t.p2, t.p1, t.p2, t.p1, t.p2];
    const answers = actors.map((a) => t.run(RECAP_QUERY_INTENT, {}, a));
    expect(t.gate().computed - before).toBeLessThanOrEqual(2);
    expect(answers[1]).toEqual(answers[2]);
  });

  test("FR-RECAP-29 an undo / a new loot row recomputes, an unrelated line does not", () => {
    const t = recapSetup();
    t.run(SET_FEATURE_INTENT, { feature: GEMS_FEATURE, on: true });
    const hit = t.hp("Goblin", "damage", 3, { from: "Thorn" });
    t.recap();
    const computed = () => t.gate().computed;
    let c = computed();
    // An unrelated line (a gem award: no roll, no fact).
    t.run(GEM_ADJUST_INTENT, { characterId: t.thornId, gem: "inspiration", delta: 1 });
    t.recap();
    expect(computed()).toBe(c);
    t.undo(hit);
    expect((t.recap() as DmRecap).party).toEqual([]);
    expect(computed()).toBe(c + 1);
    c = computed();
    t.loot({ text: "Purse", gp: 3 });
    expect((t.recap() as DmRecap).loot.rows.map((r) => r.text)).toEqual(["Purse"]);
    expect(computed()).toBe(c + 1);
  });
});

describe("FR-RECAP-20–23 share", () => {
  test("FR-RECAP-20 note cleaning and 280 clip; omit keys checked", () => {
    const long = `  Cleared\u0007 the camp ${"x".repeat(400)}  `;
    const parsed = RecapShareInput.parse({ fromN: 1, note: long, omit: ["rolls", "party"] });
    expect(parsed.note?.startsWith("Cleared the camp")).toBe(true);
    expect([...(parsed.note ?? "")].length).toBe(RECAP_NOTE_MAX);
    expect(parsed.omit).toEqual(["party", "rolls"]);
    expect(RecapShareInput.safeParse({ fromN: 1, omit: ["header"] }).success).toBe(false);
    expect(RecapShareInput.safeParse({ fromN: 1, note: "x".repeat(2000) }).success).toBe(false);
  });

  test("FR-RECAP-20 share: one row + log; player forbidden; unknown fromN not_found", () => {
    const t = recapSetup();
    t.hp("Goblin", "damage", 3, { from: "Thorn" });
    const logBefore = t.s.db.select().from(eventLog).all().length;
    const { notificationId } = t.share({ fromN: 1, note: "Well fought", omit: ["loot"] });
    const rows = shares(t);
    expect(rows.map((r) => [r.id, r.audience, r.state, r.text])).toEqual([
      [notificationId, "all", "info", expect.stringMatching(/^Session recap: /)],
    ]);
    expect(t.s.db.select().from(eventLog).all().length).toBe(logBefore + 1);
    expect(t.err(() => t.share({ fromN: 1 }, t.p1)).code).toBe("forbidden");
    expect(t.err(() => t.share({ fromN: 2 })).code).toBe("not_found");
    expect(t.err(() => t.share({ fromN: 1, omit: ["fights"] as never })).code).toBe("invalid");
  });

  test("FR-RECAP-21 FR-RECAP-23 payload player-safe: players' clipped times, label, note, omit", () => {
    const t = recapSetup();
    t.roll("Thorn", 12, { public: false });
    t.clock.advance(60_000);
    t.hp("Goblin", "damage", 3, { from: "Thorn" });
    t.share({ fromN: 1, note: "Hi" });
    const row = shares(t)[0];
    const payload = SessionRecapPayload.parse(row?.payload);
    const p = t.recap<PlayerRecap>(t.p1) as PlayerRecap;
    expect(payload).toEqual({
      fromN: 1,
      toN: p.toN,
      from: p.from,
      to: p.to,
      label: p.label,
      note: "Hi",
      omit: [],
    });
    expect(payload.from).not.toBe((t.recap() as DmRecap).from);
    expect(row?.text).toBe(`Session recap: ${p.label}`);
  });

  test("FR-RECAP-22 omit per role; the newest share of the session wins", () => {
    const t = recapSetup();
    t.hp("Goblin", "damage", 3, { from: "Thorn" });
    t.roll("Thorn", 20, { actor: t.p2 });
    t.share({ fromN: 1, note: "First", omit: ["rolls", "awards"] });
    let p = t.recap<PlayerRecap>(t.p1) as PlayerRecap;
    expect(p.shared).toMatchObject({ note: "First", omit: ["rolls", "awards"] });
    expect(p.rolls).toBeUndefined();
    expect(p.awards).toBeUndefined();
    expect(p.party).toBeDefined();
    const dm = t.recap() as DmRecap;
    expect(dm.rolls.rows).toHaveLength(1);
    expect(dm.shared?.omit).toEqual(["rolls", "awards"]);
    t.clock.advance(1000);
    t.share({ fromN: 1, note: "Second" });
    p = t.recap<PlayerRecap>(t.p1) as PlayerRecap;
    expect(p.shared).toMatchObject({ note: "Second", omit: [] });
    expect(p.rolls?.rows).toHaveLength(1);
  });

  test("FR-RECAP-23 kind registered: info, audience all, payload ≤ 2 KB", () => {
    const def = notificationKindOf(SESSION_RECAP_KIND);
    expect(def?.payloadMaxBytes).toBe(2048);
    expect(notificationKinds.find((k) => k.kind === SESSION_RECAP_KIND)?.toastClass).toBe("info");
    // A max note of 4-byte characters still fits.
    const t = recapSetup();
    t.hp("Goblin", "damage", 3, { from: "Thorn" });
    t.share({ fromN: 1, note: "😀".repeat(RECAP_NOTE_MAX), omit: ["party", "loot", "rolls"] });
    const row = t.s.db
      .select()
      .from(notification)
      .where(and(eq(notification.kind, SESSION_RECAP_KIND)))
      .get();
    expect(Buffer.byteLength(JSON.stringify(row?.payload))).toBeLessThanOrEqual(2048);
  });
});

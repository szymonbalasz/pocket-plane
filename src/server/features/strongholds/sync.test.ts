// REM / HOLD §13 over real sockets on the `reminders-strongholds` bundle: leak scans per player
// (snapshot, every frame, `sync.load` acks for `reminder`, `stronghold`, `party-item`; the loot
// window) before / after a reconnect, after an owner change and after a show → hide round trip;
// a DM-only edit sends players no frame; reconnect purges and reloads only what is visible now.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { REM_MIRA_CHARM } from "@fixtures/units/reminders/rem-mira-charm";
import { REM_THORN_OWN } from "@fixtures/units/reminders/rem-thorn-own";
import { REM_SECRET_THORN } from "@fixtures/units/reminders/rem-thorn-secret";
import { GREYSTONE } from "@fixtures/units/strongholds/hold-greystone";
import { REM_SECRET_VAULT } from "@fixtures/units/strongholds/hold-greystone-reminders";
import { HOLD_SECRET_GEM } from "@fixtures/units/strongholds/hold-greystone-stores";
import { TOWER } from "@fixtures/units/strongholds/hold-tower-secret";
import { PARTY_ITEM_TYPE } from "@shared/party-board/schemas";
import { LOOT_ENTRY_TYPE, STORES_COIN_TYPE } from "@shared/party-loot/schemas";
import type { Credential } from "@shared/protocol/frames";
import { REMINDER_TYPE } from "@shared/reminders/schemas";
import {
  STRONGHOLD_INDEX_TYPE,
  STRONGHOLD_TYPE,
  type StrongholdRecord,
} from "@shared/strongholds/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { campaign, entity, player, reminder, stronghold } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { leakScan } from "../../ws/testing/convergence";

const DM: Credential = { role: "dm", secret: TEST_SECRET };
const LAZY = [REMINDER_TYPE, STRONGHOLD_TYPE, PARTY_ITEM_TYPE];

async function answer(c: TestClient, intentId: string) {
  for (;;) {
    const f = await c.next(undefined, 3000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}
const ok = async (c: TestClient, id: string) => {
  const a = await answer(c, id);
  expect(a.type === "reject" ? JSON.stringify(a) : a.type).toBe("ack");
  return a as { type: "ack"; result?: unknown };
};
const loadAll = async (c: TestClient) => {
  for (const type of LAZY) await ok(c, c.load(type));
};
const held = (c: TestClient, type: string) => Object.values(c.store.records[type] ?? {});

describe("REM / HOLD §13 sockets (player-1, player-2)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let pid: Record<string, string>;
  let ids: { greystone: string; tower: string; mira: string; thorn: string; vault: string };
  let dm: TestClient;
  let p1: TestClient;
  let p2: TestClient;
  const cred = (name: string): Credential => ({ role: "player", token: links[name] as string });

  /** Strings no player may receive (FR-REM-16, FR-HOLD-10), plus per-player ones. */
  const common = () => [
    REM_SECRET_THORN,
    REM_SECRET_VAULT,
    GREYSTONE.vault,
    GREYSTONE.spy,
    HOLD_SECRET_GEM,
    TOWER.name,
    TOWER.notes,
    TOWER.item,
    ids.tower,
    ids.vault,
  ];
  const p1Forbidden = () => [...common(), REM_THORN_OWN];
  const p2Forbidden = () => [...common(), REM_MIRA_CHARM];

  /**
   * Raw-frame scan (from `from`) + record scan + the sprint-9 shape rules for player records.
   * After a visibility change (`from` > 0) the scan covers the store, not earlier load acks: an ack
   * legitimately held a row before the DM hid it.
   */
  function expectClean(c: TestClient, forbidden: string[], label: string, from = 0) {
    const raw = c.raw().slice(from);
    expect([label, forbidden.filter((s) => raw.includes(s))]).toEqual([label, []]);
    const view = from > 0 ? { store: c.store } : c;
    expect([label, leakScan(h.s, view)]).toEqual([label, []]);
    const bad: string[] = [];
    for (const type of [REMINDER_TYPE, STRONGHOLD_TYPE, LOOT_ENTRY_TYPE, STRONGHOLD_INDEX_TYPE]) {
      for (const r of held(c, type) as Record<string, unknown>[]) {
        for (const k of ["seq", "updatedAt", "storesHidden", "itemHidden", "dmOnly", "linkHidden"])
          if (k in r) bad.push(`${type}/${r.id}: ${k}`);
        const ends = [r.from, r.to].map((e) => (e as { kind?: string } | undefined)?.kind);
        if (r.kind === "move" && ends.includes("world") && ends.includes("party"))
          bad.push(`${type}/${r.id}: world ↔ party move`);
      }
    }
    expect([label, bad]).toEqual([label, []]);
  }

  beforeAll(async () => {
    const loaded = await loadBundle("reminders-strongholds", {
      dmSecret: TEST_SECRET,
      testMode: true,
    });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    const players = db.select().from(player).all();
    links = Object.fromEntries(players.map((r) => [r.name, r.linkToken]));
    pid = Object.fromEntries(players.map((r) => [r.name, r.id]));
    const fixture = db
      .select()
      .from(campaign)
      .all()
      .find((x) => x.name === "Fixture Campaign")?.id;
    const chars = db
      .select()
      .from(entity)
      .all()
      .filter((e) => e.campaignId === fixture);
    const holds = db.select().from(stronghold).all();
    const grey = holds.find((x) => x.name === GREYSTONE.name);
    ids = {
      greystone: grey?.id as string,
      tower: holds.find((x) => x.name === TOWER.name)?.id as string,
      mira: chars.find((e) => e.name === "Mira")?.id as string,
      thorn: chars.find((e) => e.name === "Thorn")?.id as string,
      vault: grey?.facilities.find((f) => f.name === GREYSTONE.vault)?.id as string,
    };
    h = await startTestServer({ db, fake: false });
    dm = await h.live(DM);
    p1 = await h.live(cred("Player 1"));
    p2 = await h.live(cred("Player 2"));
  });

  afterAll(async () => {
    await h.stop();
    closeDb(db);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  });

  test("FR-REM-16 leak scan · FR-HOLD-10 leak scan: snapshots, loads, frames; before and after a reconnect", async () => {
    for (const c of [dm, p1, p2]) {
      const snap = c.frames.find((f) => f.type === "snapshot");
      if (snap?.type !== "snapshot") throw new Error("no snapshot");
      // FR-REM-29 / FR-HOLD-37: lazy types are absent from every snapshot.
      expect(snap.records[REMINDER_TYPE]).toBeUndefined();
      expect(snap.records[STRONGHOLD_TYPE]).toBeUndefined();
    }
    // `stronghold-index` / `stores-coin`: the DM both, players Greystone only.
    const idx = (c: TestClient) =>
      held(c, STRONGHOLD_INDEX_TYPE)
        .map((r) => (r as { id: string }).id)
        .sort();
    expect(idx(dm)).toEqual([ids.greystone, ids.tower].sort());
    for (const c of [p1, p2]) {
      expect(idx(c)).toEqual([ids.greystone]);
      expect(held(c, STORES_COIN_TYPE).map((r) => (r as { id: string }).id)).toEqual([
        ids.greystone,
      ]);
    }
    for (const c of [dm, p1, p2]) await loadAll(c);
    const texts = (c: TestClient) =>
      held(c, REMINDER_TYPE)
        .map((r) => (r as { text: string }).text.split(" ")[0])
        .sort();
    expect(texts(dm)).toHaveLength(6);
    expect(texts(p1)).toEqual(["Fresh", REM_MIRA_CHARM, "Steam"].sort());
    expect(texts(p2)).toEqual(["Fresh", REM_THORN_OWN, "Steam"].sort());
    // Greystone without vault / spy for players; no Tower.
    for (const c of [p1, p2]) {
      const holds = held(c, STRONGHOLD_TYPE) as StrongholdRecord[];
      expect(holds.map((x) => x.name)).toEqual([GREYSTONE.name]);
      expect(holds[0]?.facilities).toHaveLength(5);
      expect(holds[0]?.staff.map((m) => m.name)).toEqual(["Brenna", "Tobin"]);
      expect((held(c, PARTY_ITEM_TYPE) as { name: string }[]).map((i) => i.name)).not.toContain(
        HOLD_SECRET_GEM,
      );
    }
    expectClean(p1, p1Forbidden(), "p1 initial");
    expectClean(p2, p2Forbidden(), "p2 initial");
    expect(leakScan(h.s, dm)).toEqual([]);
    // A fresh connection (reconnect) loading the same types: clean, and the same rows.
    const again = await h.live(cred("Player 2"));
    await loadAll(again);
    expectClean(again, p2Forbidden(), "p2 reconnect");
    expect(texts(again)).toEqual(texts(p2));
    again.close();
  });

  test("FR-HOLD-09 DM-only facility edit sends players no frame", async () => {
    const vault = (effect: string) =>
      dm.intent("hold.saveFacility", {
        strongholdId: ids.greystone,
        facility: { id: ids.vault, name: GREYSTONE.vault, state: "built", effect, dmOnly: true },
      });
    const g = h.s.db
      .select()
      .from(stronghold)
      .all()
      .find((x) => x.id === ids.greystone);
    const spy = g?.staff.find((m) => m.name === GREYSTONE.spy);
    const steps: (() => string)[] = [
      () => vault("HOLD-SECRET-VAULT moved the ledger"),
      () =>
        dm.intent("hold.saveStaff", {
          strongholdId: ids.greystone,
          staff: { ...spy, notes: "Reports to the baron", dmOnly: true },
        }),
      () =>
        dm.intent("hold.moveRow", {
          strongholdId: ids.greystone,
          list: "facilities",
          id: ids.vault,
          index: 0,
        }),
      () => dm.intent("hold.update", { strongholdId: ids.tower, notes: `${TOWER.notes} again` }),
    ];
    for (const send of steps) {
      await ok(dm, send());
      await Promise.all([p1.expectNoFrame(300), p2.expectNoFrame(300)]);
    }
    // Hidden notes: the flip itself is a visible change; edits after it send nothing.
    await ok(dm, dm.intent("hold.update", { strongholdId: ids.greystone, notesDmOnly: true }));
    const flip = await p1.next("event", 2000);
    expect(flip.changes.map((c) => c.type)).toEqual([STRONGHOLD_TYPE]);
    await p2.next("event", 2000);
    await ok(
      dm,
      dm.intent("hold.update", { strongholdId: ids.greystone, notes: "NOTES-WHILE-HIDDEN" }),
    );
    await Promise.all([p1.expectNoFrame(300), p2.expectNoFrame(300)]);
    const hidden = ["Reports to the baron", "NOTES-WHILE-HIDDEN"];
    for (const [c, forbidden] of [
      [p1, p1Forbidden()],
      [p2, p2Forbidden()],
    ] as const) {
      const raw = c.raw();
      expect([...forbidden, ...hidden].filter((s) => raw.includes(s))).toEqual([]);
    }
    // Shown again (the notes reach players now), so the later scans compare like with like:
    // an earlier load ack legitimately held the notes before they were hidden.
    await ok(
      dm,
      dm.intent("hold.update", {
        strongholdId: ids.greystone,
        notes: GREYSTONE.notes,
        notesDmOnly: false,
      }),
    );
    await Promise.all([p1.next("event", 2000), p2.next("event", 2000)]);
    expectClean(p1, [...p1Forbidden(), hidden[0] as string], "p1 after DM-only edits");
    expectClean(p2, [...p2Forbidden(), hidden[0] as string], "p2 after DM-only edits");
  });

  test("FR-REM-05 owner copy follows the PC (Thorn → player-1 over a real socket)", async () => {
    const own = h.s.db
      .select()
      .from(reminder)
      .all()
      .find((r) => r.text.startsWith(REM_THORN_OWN));
    const p2Mark = p2.raw().length;
    await ok(
      dm,
      dm.intent("char.edit", { creatureId: ids.thorn, set: { ownerPlayerId: pid["Player 1"] } }),
    );
    const until = async (pred: () => boolean) => {
      const end = Date.now() + 2000;
      while (!pred()) {
        if (Date.now() > end) throw new Error("not reached");
        await Bun.sleep(10);
      }
    };
    try {
      await until(() => p1.store.records[REMINDER_TYPE]?.[own?.id as string] !== undefined);
      await until(() => p2.store.records[REMINDER_TYPE]?.[own?.id as string] === undefined);
      // The DM-only Thorn reminder reached nobody; player-2's new frames carry no Thorn reminder.
      expect(p2.raw().slice(p2Mark)).not.toContain(REM_SECRET_THORN);
      expectClean(p1, common(), "p1 after owner change");
      expectClean(p2, [...p2Forbidden(), REM_THORN_OWN], "p2 after owner change", p2Mark);
      // A fresh player-2 connection holds no Thorn reminder at all.
      const fresh = await h.live(cred("Player 2"));
      await loadAll(fresh);
      expectClean(fresh, [...p2Forbidden(), REM_THORN_OWN], "p2 fresh after owner change");
      fresh.close();
    } finally {
      // Back to player-2 (keeps later tests' fixture meaning).
      await ok(
        dm,
        dm.intent("char.edit", { creatureId: ids.thorn, set: { ownerPlayerId: pid["Player 2"] } }),
      );
    }
    await until(() => p2.store.records[REMINDER_TYPE]?.[own?.id as string] !== undefined);
  });

  test("FR-HOLD-10 show → hide round trip: after the hide, new frames are clean", async () => {
    await ok(dm, dm.intent("hold.update", { strongholdId: ids.tower, dmOnly: false }));
    const until = async (pred: () => boolean) => {
      const end = Date.now() + 2000;
      while (!pred()) {
        if (Date.now() > end) throw new Error("not reached");
        await Bun.sleep(10);
      }
    };
    await until(() => p1.store.records[STRONGHOLD_INDEX_TYPE]?.[ids.tower] !== undefined);
    expect(p1.raw()).toContain(TOWER.name);
    const mark = { p1: p1.raw().length, p2: p2.raw().length };
    await ok(dm, dm.intent("hold.update", { strongholdId: ids.tower, dmOnly: true }));
    await until(() => p1.store.records[STRONGHOLD_INDEX_TYPE]?.[ids.tower] === undefined);
    await until(() => p2.store.records[STRONGHOLD_INDEX_TYPE]?.[ids.tower] === undefined);
    // Upserts after the hide never name the Tower (deletes may carry the ids players held).
    for (const [c, from] of [
      [p1, mark.p1],
      [p2, mark.p2],
    ] as const) {
      const raw = c.raw().slice(from);
      for (const s of [TOWER.name, TOWER.notes, TOWER.item]) expect(raw).not.toContain(s);
      expect(leakScan(h.s, { store: c.store })).toEqual([]);
      for (const type of [STRONGHOLD_TYPE, STRONGHOLD_INDEX_TYPE, STORES_COIN_TYPE])
        expect(c.store.records[type]?.[ids.tower]).toBeUndefined();
    }
    // A fresh connection after the hide: clean from the first byte.
    const fresh = await h.live(cred("Player 1"));
    await loadAll(fresh);
    expectClean(fresh, p1Forbidden(), "p1 fresh after hide");
    fresh.close();
  });

  test("FR-REM-30 reconnect · FR-HOLD-38 reconnect: the snapshot purges lazy rows; a reload shows only what is visible now", async () => {
    const c = await h.live(cred("Player 2"));
    await loadAll(c);
    const own = h.s.db
      .select()
      .from(reminder)
      .all()
      .find((r) => r.text.startsWith(REM_THORN_OWN));
    expect(c.store.records[REMINDER_TYPE]?.[own?.id as string]).toBeDefined();
    c.close();
    // While away: the DM hides player-2's reminder and Greystone.
    await ok(
      dm,
      dm.intent("rem.save", {
        id: own?.id,
        target: { kind: "character", characterId: ids.thorn },
        text: own?.text,
        dmOnly: true,
      }),
    );
    await ok(dm, dm.intent("hold.update", { strongholdId: ids.greystone, dmOnly: true }));
    const back = await h.live(cred("Player 2"));
    const snap = back.frames.find((f) => f.type === "snapshot");
    if (snap?.type !== "snapshot") throw new Error("no snapshot");
    expect(snap.records[REMINDER_TYPE]).toBeUndefined();
    expect(snap.records[STRONGHOLD_INDEX_TYPE]).toEqual([]);
    await loadAll(back);
    expect(held(back, STRONGHOLD_TYPE)).toEqual([]);
    const texts = held(back, REMINDER_TYPE).map((r) => (r as { text: string }).text);
    expect(texts.some((t) => t.startsWith(REM_THORN_OWN))).toBe(false);
    // Steam Rooms' reminder is hidden with Greystone (FR-REM-06).
    expect(texts.some((t) => t.startsWith("Steam"))).toBe(false);
    expectClean(back, [...p2Forbidden(), REM_THORN_OWN, GREYSTONE.name], "p2 back");
    back.close();
    // Restore.
    await ok(dm, dm.intent("hold.update", { strongholdId: ids.greystone, dmOnly: false }));
  });
});

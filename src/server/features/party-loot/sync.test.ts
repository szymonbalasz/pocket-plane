// LOOT §13 integration over real sockets: the `party-loot` bundle, live adds / edits / moves,
// event order before ack, scope leak scan, reconnect, campaign switch, restart, window.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { SECOND_LOOT_TEXT } from "@fixtures/units/party-loot/loot-second";
import {
  type Coins,
  LOOT_ENTRY_TYPE,
  type LootEntryRecord,
  PARTY_POT_TYPE,
  type PartyPotRecord,
  WALLET_TYPE,
  type WalletRecord,
} from "@shared/party-loot/schemas";
import { CloseCode } from "@shared/protocol/codes";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { campaign, entity, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { DM_ACTOR, TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";
import { activateCampaign } from "../campaign-management/commands";
import { seedLoot } from "./testing";

const DM = { role: "dm" as const, secret: TEST_SECRET };
const c = (x: Partial<Coins>): Coins => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...x });
const coinsOnly = ({ cp, sp, ep, gp, pp }: Coins): Coins => ({ cp, sp, ep, gp, pp });

const entriesOf = (cl: TestClient) =>
  (Object.values(cl.store.records[LOOT_ENTRY_TYPE] ?? {}) as LootEntryRecord[]).sort(
    (a, b) => a.seq - b.seq,
  );
const potOf = (cl: TestClient) =>
  coinsOnly(Object.values(cl.store.records[PARTY_POT_TYPE] ?? {})[0] as PartyPotRecord);
const walletOf = (cl: TestClient, id: string) => {
  const w = cl.store.records[WALLET_TYPE]?.[id] as WalletRecord | undefined;
  return w ? coinsOnly(w) : c({});
};
/** Next event frame (skips presence changes). */
async function nextEvent(cl: TestClient) {
  for (;;) {
    const e = await cl.next("event", 1000);
    if (e.cause.name !== "presence") return e;
  }
}
/** Event cause names up to the ack of `intentId`. */
async function untilAck(cl: TestClient, intentId: string) {
  const names: string[] = [];
  for (;;) {
    const f = await cl.next(undefined, 1000);
    if (f.type === "event" && f.cause.intentId === intentId) names.push(f.cause.name);
    if (f.type === "ack" && f.intentId === intentId) return { names, ack: f };
    if (f.type === "reject" && f.intentId === intentId) throw new Error(`rejected: ${f.code}`);
  }
}
const barrier = async (cl: TestClient) => {
  cl.send({ type: "ping" });
  await cl.next("pong");
};

describe("party-loot bundle over WS (LOOT §13)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let tokens: Record<string, string>;
  let ids: Record<string, string>;
  let camps: Record<string, string>;
  const p = (name: string) => ({ role: "player" as const, token: tokens[name] as string });
  const mira = () => ({ kind: "character" as const, characterId: ids.Mira as string });
  const thorn = () => ({ kind: "character" as const, characterId: ids.Thorn as string });

  beforeAll(async () => {
    const loaded = await loadBundle("party-loot", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    const rows = <T extends { name: string }>(r: T[], f: (x: T) => string) =>
      Object.fromEntries(r.map((x) => [x.name, f(x)]));
    tokens = rows(db.select().from(player).all(), (x) => x.linkToken);
    ids = rows(db.select().from(entity).all(), (x) => x.id);
    camps = rows(db.select().from(campaign).all(), (x) => x.id);
    h = await startTestServer({ db, fake: false });
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

  test("LOOT §13 step 1–2: DM and players see the same pot, wallets and log; no second-campaign data", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    for (const cl of [dm, p1, p2]) {
      expect(potOf(cl)).toEqual(c({ pp: 5, gp: 30 }));
      expect(walletOf(cl, ids.Mira as string)).toEqual(c({ gp: 21 }));
      expect(walletOf(cl, ids.Thorn as string)).toEqual(c({ gp: 8, sp: 30 }));
      const e = entriesOf(cl);
      expect(e).toHaveLength(9);
      expect(e[2]).toMatchObject({ text: "Silver idol", gp: 50 });
      expect(typeof e[2]?.editedAt).toBe("string");
      expect(e.slice(5).map((x) => [x.from.kind, x.to.kind])).toEqual([
        ["party", "character"],
        ["party", "character"],
        ["character", "character"],
        ["character", "world"],
      ]);
      // Scope leak scan: the second campaign's entry, notification and 1 gp never appear.
      expect(cl.raw()).not.toContain(SECOND_LOOT_TEXT);
      expect(leakScan(h.s, cl)).toEqual([]);
    }
    expect(entriesOf(p1)).toEqual(entriesOf(dm));
    for (const cl of [dm, p1, p2]) cl.close();
  });

  test("FR-LOOT-03 FR-LOOT-13 DM add: LootAdded then NotificationCreated before ack; live to players", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const started = performance.now();
    const intentId = dm.intent("loot.add", { text: "Silver dagger", gp: 50 });
    const { names, ack } = await untilAck(dm, intentId);
    expect(names).toEqual(["LootAdded", "NotificationCreated"]);
    const entryId = (ack.result as { entryId: string }).entryId;
    const e1 = await nextEvent(p1);
    expect(e1.cause.name).toBe("LootAdded");
    expect(e1.changes.map((x) => [x.type, x.op])).toEqual([
      [LOOT_ENTRY_TYPE, "upsert"],
      [PARTY_POT_TYPE, "upsert"],
    ]);
    const e2 = await nextEvent(p1);
    expect(e2.changes[0]).toMatchObject({
      type: "notification",
      data: { kind: "loot-received", text: "Party loot: Silver dagger (50 gp)" },
    });
    expect(performance.now() - started).toBeLessThan(1000);
    expect(potOf(p1)).toEqual(c({ pp: 5, gp: 80 }));
    expect(entriesOf(p1).at(-1)?.id).toBe(entryId);

    // A spend → LootAdded only.
    const spend = dm.intent("loot.add", { text: "Paid the ferryman", gp: -40 });
    expect((await untilAck(dm, spend)).names).toEqual(["LootAdded"]);
    expect((await nextEvent(p1)).cause.name).toBe("LootAdded");
    await p1.expectNoFrame(150);
    expect(potOf(p1)).toEqual(c({ pp: 5, gp: 40 }));

    // Players can't add or edit.
    p1.intent("loot.add", { text: "Mine", gp: 1 }, "padd");
    expect(await p1.next("reject")).toMatchObject({ intentId: "padd", code: "forbidden" });
    p1.intent("loot.edit", { entryId, text: "x", cp: 0, sp: 0, ep: 0, gp: 1, pp: 0 }, "pedit");
    expect(await p1.next("reject")).toMatchObject({ intentId: "pedit", code: "forbidden" });
    await dm.expectNoFrame(150);
    for (const cl of [dm, p1]) cl.close();
  });

  test("FR-LOOT-04 edit: LootEdited live, pot updated, no notification frame", async () => {
    const dm = await h.live(DM);
    const p2 = await h.live(p("Player 2"));
    const dagger = entriesOf(dm).find((e) => e.text === "Silver dagger") as LootEntryRecord;
    const before = potOf(dm);
    const id = dm.intent("loot.edit", {
      entryId: dagger.id,
      text: "Silver dagger",
      ...c({ gp: 5 }),
    });
    expect((await untilAck(dm, id)).names).toEqual(["LootEdited"]);
    const ev = await nextEvent(p2);
    expect(ev.changes.map((x) => x.type)).toEqual([LOOT_ENTRY_TYPE, PARTY_POT_TYPE]);
    await p2.expectNoFrame(150);
    expect(potOf(p2)).toEqual({ ...before, gp: before.gp - 45 });
    expect(entriesOf(p2).find((e) => e.id === dagger.id)?.editedAt).not.toBeNull();
    for (const cl of [dm, p2]) cl.close();
  });

  test("FR-LOOT-07 FR-LOOT-08 player moves: allowed ones live to the DM; others forbidden", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const mira0 = walletOf(dm, ids.Mira as string);
    const thorn0 = walletOf(dm, ids.Thorn as string);
    const pot0 = potOf(dm);

    const a = p2.intent("loot.move", { from: thorn(), to: mira(), gp: 3, text: "Thanks" });
    expect((await untilAck(p2, a)).names).toEqual(["CoinMoved"]);
    const ev = await nextEvent(dm);
    expect(ev.changes.map((x) => x.type)).toEqual([LOOT_ENTRY_TYPE, WALLET_TYPE, WALLET_TYPE]);
    const b = p1.intent("loot.move", { from: { kind: "party" }, to: mira(), gp: 10 });
    expect((await untilAck(p1, b)).names).toEqual(["CoinMoved"]);
    await nextEvent(dm);
    await barrier(dm);
    expect(walletOf(dm, ids.Mira as string)).toEqual({ ...mira0, gp: mira0.gp + 13 });
    expect(walletOf(dm, ids.Thorn as string)).toEqual({ ...thorn0, gp: thorn0.gp - 3 });
    expect(potOf(dm)).toEqual({ ...pot0, gp: pot0.gp - 10 });

    p1.intent("loot.move", { from: { kind: "party" }, to: thorn(), gp: 1 }, "x1");
    expect(await p1.next("reject")).toMatchObject({ intentId: "x1", code: "forbidden" });
    p1.intent("loot.move", { from: mira(), to: { kind: "world" }, gp: 1 }, "x2");
    expect(await p1.next("reject")).toMatchObject({ intentId: "x2", code: "forbidden" });
    p1.intent("loot.move", { from: mira(), to: mira(), gp: 1 }, "x3");
    expect(await p1.next("reject")).toMatchObject({ intentId: "x3", code: "invalid" });
    await dm.expectNoFrame(150);
    for (const cl of [dm, p1, p2]) cl.close();
  });

  test("LOOT §11 player offline during an add: the reconnect snapshot has the entry, pot and notification", async () => {
    const dm = await h.live(DM);
    const p2 = await h.live(p("Player 2"));
    p2.close();
    await p2.closed;
    const id = dm.intent("loot.add", { text: "Ruby" });
    await untilAck(dm, id);
    const back = await h.live(p("Player 2"));
    expect(entriesOf(back).at(-1)).toMatchObject({ text: "Ruby" });
    expect(potOf(back)).toEqual(potOf(dm));
    const notes = Object.values(back.store.records.notification ?? {}) as { text: string }[];
    expect(notes.some((n) => n.text === "Party loot: Ruby")).toBe(true);
    const fresh = await h.live(DM);
    const cv = convergence(h.s, dm, fresh);
    expect(cv.live).toEqual(cv.fresh);
    for (const cl of [dm, back, fresh]) cl.close();
  });

  test("LOOT §11 campaign switch: 4409, then only the second campaign's loot; back again", async () => {
    const dm = await h.live(DM);
    h.s.commands.run(
      activateCampaign,
      { id: camps["Second Campaign"] as string },
      { actor: DM_ACTOR },
    );
    expect((await dm.closed).code).toBe(CloseCode.campaignInactive);
    const dm2 = await h.live(DM);
    expect(entriesOf(dm2).map((e) => e.text)).toEqual([SECOND_LOOT_TEXT]);
    expect(potOf(dm2)).toEqual(c({ gp: 1 }));
    expect(dm2.store.records[WALLET_TYPE]).toEqual({});
    h.s.commands.run(
      activateCampaign,
      { id: camps["Fixture Campaign"] as string },
      { actor: DM_ACTOR },
    );
    expect((await dm2.closed).code).toBe(CloseCode.campaignInactive);
    const dm3 = await h.live(DM);
    expect(dm3.raw()).not.toContain(SECOND_LOOT_TEXT);
    dm3.close();
  });

  test("LOOT §11 restart on the same DB → identical snapshots", async () => {
    const snap = async () => {
      const out: Record<string, unknown> = {};
      for (const [k, cred] of Object.entries({
        dm: DM,
        p1: p("Player 1"),
        p2: p("Player 2"),
      })) {
        const cl = await h.live(cred);
        out[k] = {
          entries: cl.store.records[LOOT_ENTRY_TYPE],
          pot: cl.store.records[PARTY_POT_TYPE],
          wallets: cl.store.records[WALLET_TYPE],
        };
        cl.close();
      }
      return out;
    };
    const before = await snap();
    await h.restart();
    expect(await snap()).toEqual(before);
  });
});

describe("FR-LOOT-11 window over WS (ADR-0029)", () => {
  let h: TestServer;
  beforeAll(async () => {
    h = await startTestServer({ fake: false });
  });
  afterAll(async () => {
    await h.stop();
  });

  test("FR-LOOT-11 105 entries → newest 100; an edit below the floor is live; convergence incl. pot + wallets", async () => {
    const t = seedLoot(h.s);
    const first = h.s.commands.run("loot.add", { text: "oldest", gp: 7 }, { actor: t.dm }) as {
      entryId: string;
    };
    for (let i = 1; i < 105; i++) {
      if (i % 3 === 0) {
        h.s.commands.run("loot.move", { from: t.party, to: t.mira, cp: 1 }, { actor: t.dm });
      } else {
        h.s.commands.run("loot.add", { text: `e${i}`, cp: 2 }, { actor: t.dm });
      }
    }
    const dm = await h.live(DM);
    const pl = await h.live({ role: "player", token: t.p1.linkToken });
    for (const cl of [dm, pl]) {
      expect(entriesOf(cl)).toHaveLength(100);
      expect(cl.store.records[LOOT_ENTRY_TYPE]?.[first.entryId]).toBeUndefined();
      // The pot still counts the oldest entry.
      expect(potOf(cl).gp).toBe(7);
    }
    h.s.commands.run(
      "loot.edit",
      { entryId: first.entryId, text: "oldest", ...c({ gp: 9 }) },
      { actor: t.dm },
    );
    for (const cl of [dm, pl]) {
      const ev = await nextEvent(cl);
      expect(ev.changes[0]).toMatchObject({ id: first.entryId, op: "upsert", data: { gp: 9 } });
      expect(potOf(cl).gp).toBe(9);
    }
    for (const [live, cred] of [
      [dm, DM],
      [pl, { role: "player" as const, token: t.p1.linkToken }],
    ] as const) {
      const fresh = await h.live(cred);
      expect(fresh.store.records[LOOT_ENTRY_TYPE]?.[first.entryId]).toBeUndefined();
      const cv = convergence(h.s, live, fresh);
      expect(cv.live).toEqual(cv.fresh);
      expect(live.store.records[WALLET_TYPE]).toEqual(fresh.store.records[WALLET_TYPE] ?? {});
      fresh.close();
    }
    dm.close();
    pl.close();
  });
});

// PARTY §13 slice 3 over real sockets on the `party-board` bundle: `loot.split` live to every
// player before the DM's ack (walkthrough step 10 numbers), a player's split → forbidden, item rows
// in the loot window's snapshot and their edit `conflict`, campaign scope (a split in the Second
// Campaign never reaches a Fixture Campaign socket) and the reconnect snapshot.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { SPLIT_TEXT } from "@shared/party-board/schemas";
import {
  type Coins,
  LOOT_ENTRY_TYPE,
  type LootEntryRecord,
  PARTY_POT_TYPE,
  type PartyPotRecord,
  WALLET_TYPE,
  type WalletRecord,
} from "@shared/party-loot/schemas";
import type { Credential } from "@shared/protocol/frames";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { campaign, entity, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { DM_ACTOR, TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";
import { createEntity } from "../entities/commands";
import { miraBlock } from "../entities/testing";
import { lootSplit } from "./commands";

const DM: Credential = { role: "dm", secret: TEST_SECRET };
const c = (x: Partial<Coins>): Coins => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...x });
const coinsOnly = ({ cp, sp, ep, gp, pp }: Coins): Coins => ({ cp, sp, ep, gp, pp });
const potOf = (cl: TestClient) =>
  coinsOnly(Object.values(cl.store.records[PARTY_POT_TYPE] ?? {})[0] as PartyPotRecord);
const walletOf = (cl: TestClient, id: string) => {
  const w = cl.store.records[WALLET_TYPE]?.[id] as WalletRecord | undefined;
  return w ? coinsOnly(w) : c({});
};
const entriesOf = (cl: TestClient) =>
  (Object.values(cl.store.records[LOOT_ENTRY_TYPE] ?? {}) as LootEntryRecord[]).sort(
    (a, b) => a.seq - b.seq,
  );
async function nextEvent(cl: TestClient) {
  for (;;) {
    const e = await cl.next("event", 1000);
    if (e.cause.name !== "presence") return e;
  }
}
async function untilAck(cl: TestClient, intentId: string) {
  const names: string[] = [];
  for (;;) {
    const f = await cl.next(undefined, 1000);
    if (f.type === "event" && f.cause.intentId === intentId) names.push(f.cause.name);
    if (f.type === "ack" && f.intentId === intentId) return { names, ack: f };
    if (f.type === "reject" && f.intentId === intentId) throw new Error(`rejected: ${f.code}`);
  }
}

describe("loot.split + item rows over WS (PARTY §13, party-board bundle)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let tokens: Record<string, string>;
  let playerIds: Record<string, string>;
  let ids: Record<string, string>;
  let camps: Record<string, string>;
  const p = (name: string): Credential => ({ role: "player", token: tokens[name] as string });

  beforeAll(async () => {
    const loaded = await loadBundle("party-board", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    const rows = <T extends { name: string }>(r: T[], f: (x: T) => string) =>
      Object.fromEntries(r.map((x) => [x.name, f(x)]));
    tokens = rows(db.select().from(player).all(), (x) => x.linkToken);
    playerIds = rows(db.select().from(player).all(), (x) => x.id);
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

  test("FR-PARTY-25 item rows reach every client in the loot window; edit → conflict", async () => {
    const dm = await h.live(DM);
    const p2 = await h.live(p("Player 2"));
    for (const cl of [dm, p2]) {
      const items = entriesOf(cl).filter((e) => e.kind === "item");
      expect(items.map((e) => [e.text, e.qty, e.from.kind, e.to.kind])).toEqual([
        ["Potion of healing", 2, "world", "party"],
        ["Torch", 10, "world", "party"],
        ["Rope (50 ft)", 1, "world", "party"],
        ["Torch", 2, "party", "character"],
      ]);
      expect(items.every((e) => coinsOnly(e).gp === 0)).toBe(true);
      // Non-item rows carry no `qty` on the wire.
      expect(entriesOf(cl).filter((e) => e.kind !== "item" && "qty" in e)).toEqual([]);
    }
    const torch = entriesOf(dm).find((e) => e.text === "Torch") as LootEntryRecord;
    dm.intent("loot.edit", { entryId: torch.id, text: "Torches", ...c({}) }, "edit-item");
    expect(await dm.next("reject")).toMatchObject({
      intentId: "edit-item",
      code: "conflict",
      message: "Item moves can't be edited — move it back",
    });
    await p2.expectNoFrame(150);
    for (const cl of [dm, p2]) cl.close();
  });

  test("FR-PARTY-26 DM split Mira + Thorn of 5 pp, 30 gp: CoinSplit before ack, live to both players; player split forbidden", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const mira = ids.Mira as string;
    const thorn = ids.Thorn as string;
    for (const cl of [dm, p1, p2]) expect(potOf(cl)).toEqual(c({ pp: 5, gp: 30 }));
    const mira0 = walletOf(dm, mira);
    const thorn0 = walletOf(dm, thorn);

    p1.intent("loot.split", { characterIds: [mira], gp: 30 }, "p-split");
    expect(await p1.next("reject")).toMatchObject({ intentId: "p-split", code: "forbidden" });

    const started = performance.now();
    const id = dm.intent("loot.split", { characterIds: [mira, thorn], pp: 5, gp: 30 });
    const { names, ack } = await untilAck(dm, id);
    expect(names).toEqual(["CoinSplit"]);
    const { entryIds } = ack.result as { entryIds: string[] };
    expect(entryIds).toHaveLength(2);
    for (const cl of [p1, p2]) {
      const ev = await nextEvent(cl);
      expect(ev.cause.name).toBe("CoinSplit");
      expect(ev.changes.map((x) => [x.type, x.op])).toEqual([
        [LOOT_ENTRY_TYPE, "upsert"],
        [LOOT_ENTRY_TYPE, "upsert"],
        [PARTY_POT_TYPE, "upsert"],
        [WALLET_TYPE, "upsert"],
        [WALLET_TYPE, "upsert"],
      ]);
      expect(performance.now() - started).toBeLessThan(1000);
    }
    for (const cl of [dm, p1, p2]) {
      expect(potOf(cl)).toEqual(c({ pp: 1 }));
      expect(walletOf(cl, mira)).toEqual({ ...mira0, pp: mira0.pp + 2, gp: mira0.gp + 15 });
      expect(walletOf(cl, thorn)).toEqual({ ...thorn0, pp: thorn0.pp + 2, gp: thorn0.gp + 15 });
      const split = entriesOf(cl).slice(-2);
      expect(split.map((e) => [e.id, e.kind, e.text, e.to])).toEqual([
        [entryIds[0] as string, "move", SPLIT_TEXT, { kind: "character", characterId: mira }],
        [entryIds[1] as string, "move", SPLIT_TEXT, { kind: "character", characterId: thorn }],
      ]);
    }
    await p2.expectNoFrame(150);

    // Reconnect: the snapshot has the same rows, pot and wallets as the live store.
    const back = await h.live(p("Player 2"));
    expect(potOf(back)).toEqual(c({ pp: 1 }));
    const cv = convergence(h.s, p2, back);
    expect(cv.live).toEqual(cv.fresh);
    expect(back.store.records[WALLET_TYPE]).toEqual(p2.store.records[WALLET_TYPE] ?? {});
    for (const cl of [dm, p1, p2, back]) cl.close();
  });

  test("FR-PARTY-26 campaign scope: a Second Campaign split never reaches a Fixture Campaign socket, live or after reconnect", async () => {
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const dmSecond = { ...DM_ACTOR, campaignId: camps["Second Campaign"] as string };
    const stranger = h.s.commands.run(
      createEntity.name,
      {
        kind: "character",
        name: "SECOND-SPLIT-PC",
        ownerPlayerId: playerIds["Second Player"],
        statBlock: miraBlock,
      },
      { actor: dmSecond },
    ) as { id: string };
    const r = h.s.commands.run(
      lootSplit,
      { characterIds: [stranger.id], cp: 777 },
      { actor: dmSecond },
    ) as { entryIds: string[] };
    await Promise.all([p1, p2].map((cl) => cl.expectNoFrame(150)));
    const back = await h.live(p("Player 2"));
    for (const cl of [p1, p2, back]) {
      const raw = cl.raw();
      expect(raw).not.toContain(stranger.id);
      expect(raw).not.toContain(r.entryIds[0] as string);
      expect(raw).not.toContain("SECOND-SPLIT-PC");
      expect(leakScan(h.s, cl)).toEqual([]);
    }
    for (const cl of [p1, p2, back]) cl.close();
  });
});

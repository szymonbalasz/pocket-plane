// DICEX §13 sprint 4 integration over real sockets on `dice-display`: every public roll source
// opens exactly one roll popup per live frame on the DM, player-1 and player-2 (the roller too),
// one named row with the entry's totals (FR-DICEX-39, -40); `cbt.start`'s monster initiative is
// one DM popup with a row per monster and none for players; snapshots, a reconnect snapshot and
// an undo upsert of an old entry open none. The client side is the real code: `newRollEntries`
// per frame (store before / after, replayed from the frames) → `createRollPopups().add`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import {
  type AttackResult,
  COMBATANT_TYPE,
  type CombatantRecord,
  ENCOUNTER_TYPE,
  type EncounterRecord,
  HP_CHANGE_TYPE,
  type HpChangeRecord,
  type RollDamageResult,
} from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryView } from "@shared/dice-roll-log/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { Credential, EventFrame, ServerFrame } from "@shared/protocol/frames";
import { applyEvent, applySnapshot, emptyStore, type RecordStore } from "@shared/protocol/store";
import { SCENE_TYPE, type SceneRecord } from "@shared/scenes-map/schemas";
import { popupRows } from "@ui/features/dice-extras/popup-logic";
import { createRollPopups, type RollPopup } from "@ui/features/dice-extras/popups";
import { createDiceExtrasStore } from "@ui/features/dice-extras/store";
import { newRollEntries } from "@ui/features/dice-extras/throw-source";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { campaign, entity, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";

const DM: Credential = { role: "dm", secret: TEST_SECRET };
type Role = "dm" | "p1" | "p2";
const ROLES: Role[] = ["dm", "p1", "p2"];

async function answer(c: TestClient, intentId: string) {
  for (;;) {
    const f = await c.next(undefined, 3000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}
async function ok<T>(c: TestClient, name: string, payload: unknown): Promise<T> {
  const f = await answer(c, c.intent(name, payload));
  expect([name, f.type, f.type === "reject" ? f : null]).toEqual([name, "ack", null]);
  return (f as { result: T }).result;
}
const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
const all = <T>(c: TestClient, type: string) => Object.values(c.store.records[type] ?? {}) as T[];

/** No-op timers: popups stay as `add` left them. */
const timers = { setTimeout: () => 0, clearTimeout: () => {}, now: () => 0 };

/**
 * One client's view of the frames, replayed as the client store does: a snapshot replaces the
 * store (never a popup, FR-DICEX-11); each event frame's new `roll` entries feed the popups.
 */
interface Watch {
  c: TestClient;
  /** Next unread frame index. */
  at: number;
  store: RecordStore;
}
interface FramePopups {
  cause: string;
  /** Every game-log upsert of the frame (incl. ones that open no popup). */
  upserts: GameLogEntryView[];
  entries: GameLogEntryView[];
}
interface Seen {
  frames: FramePopups[];
  /** Frames that opened a popup. */
  rolled: FramePopups[];
  popups: RollPopup[];
}

function drain(w: Watch): FramePopups[] {
  const out: FramePopups[] = [];
  while (w.at < w.c.frames.length) {
    const f = w.c.frames[w.at++] as ServerFrame;
    if (f.type === "snapshot") {
      w.store = applySnapshot(f);
      continue;
    }
    if (f.type !== "event") continue;
    const r = applyEvent(w.store, f as EventFrame);
    if (!r.ok) throw new Error(`seq gap at ${f.seq}`);
    const entries = newRollEntries(f, w.store, r.store);
    w.store = r.store;
    const upserts = f.changes
      .filter((x) => x.type === GAME_LOG_ENTRY_TYPE && x.op === "upsert")
      .map((x) => x.data as GameLogEntryView);
    out.push({ cause: f.cause.name, upserts, entries });
  }
  return out;
}

/** A fresh popups store fed with the frames' new roll entries, as the dice-extras runtime does. */
function popupsOf(frames: FramePopups[]): Seen {
  const popups = createRollPopups(createDiceExtrasStore(timers), () => false, timers);
  const rolled: FramePopups[] = [];
  for (const f of frames) {
    if (f.entries.length === 0) continue;
    rolled.push(f);
    const id = popups.add({ entries: f.entries, looks: {}, big: null, threeD: false });
    expect([f.cause, id]).toEqual([f.cause, f.entries[0]?.id as string]);
  }
  return { frames, rolled, popups: popups.api.getState().popups };
}

/** Payload item totals of an entry, read as the popup does (`payload` only). */
const payloadTotals = (e: GameLogEntryView) =>
  (Array.isArray(e.payload) ? e.payload : []).map((i) => (i as { total: number }).total);

describe("FR-DICEX-39 FR-DICEX-40 roll popups per source over sockets (dice-display)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let miraId: string;
  const c: Record<Role, TestClient> = {} as Record<Role, TestClient>;
  const w: Record<Role, Watch> = {} as Record<Role, Watch>;
  const cred = (name: string): Credential => ({ role: "player", token: links[name] as string });
  const watch = (r: Role, client: TestClient) => {
    c[r] = client;
    w[r] = { c: client, at: 0, store: emptyStore() };
  };
  const mira = () =>
    all<CombatantRecord>(c.p1, COMBATANT_TYPE).find((x) => x.name === "Mira") as CombatantRecord;

  /** Runs `act`, waits for every client, returns what each client's popups got from it. */
  async function run(act: () => Promise<void>): Promise<Record<Role, Seen>> {
    for (const r of ROLES) {
      await barrier(c[r]);
      drain(w[r]);
    }
    await act();
    const out = {} as Record<Role, Seen>;
    for (const r of ROLES) {
      await barrier(c[r]);
      out[r] = popupsOf(drain(w[r]));
    }
    return out;
  }

  /** One popup per client, from one frame, one public row: `actor`, the entry's totals. */
  function expectOnePopup(label: string, seen: Record<Role, Seen>, actor: string, id?: string) {
    const ids = new Set<string>();
    for (const r of ROLES) {
      const s = seen[r];
      const tag = `${label} @${r}`;
      expect([tag, s.rolled.map((f) => f.cause)]).toEqual([tag, [expect.any(String)]]);
      expect([tag, s.popups.length]).toEqual([tag, 1]);
      const p = s.popups[0] as RollPopup;
      const rows = popupRows(p.entries);
      expect([tag, rows.length]).toEqual([tag, 1]);
      const e = p.entries[0] as GameLogEntryView;
      const row = rows[0];
      expect([tag, row?.actor, row?.hidden]).toEqual([tag, actor, false]);
      expect([tag, row?.items.map((i) => i.total)]).toEqual([tag, payloadTotals(e)]);
      expect([tag, payloadTotals(e).length > 0]).toEqual([tag, true]);
      ids.add(e.id);
    }
    expect([label, ids.size]).toEqual([label, 1]);
    if (id) expect([label, [...ids]]).toEqual([label, [id]]);
  }

  beforeAll(async () => {
    const loaded = await loadBundle("dice-display", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    const active = db
      .select()
      .from(campaign)
      .all()
      .find((x) => x.active)?.id;
    links = Object.fromEntries(
      db
        .select()
        .from(player)
        .all()
        .filter((p) => p.campaignId === active)
        .map((r) => [r.name, r.linkToken]),
    );
    miraId = db
      .select()
      .from(entity)
      .all()
      .find((e) => e.campaignId === active && e.name === "Mira")?.id as string;
    h = await startTestServer({ db, fake: false });
    watch("dm", await h.live(DM));
    watch("p1", await h.live(cred("Player 1")));
    watch("p2", await h.live(cred("Player 2")));
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

  test("FR-DICEX-39 popup gets every public roll source: dice.roll (player tray / roll bar / notation)", async () => {
    let entryId = "";
    const seen = await run(async () => {
      ({ entryId } = await ok<{ entryId: string }>(c.p1, "dice.roll", {
        expression: "2d6+3",
        label: "Notation test",
      }));
    });
    expectOnePopup("player dice.roll", seen, "Player 1", entryId);
    expect(popupRows(seen.p2.popups[0]?.entries ?? [])[0]?.items[0]?.label).toBe("Notation test");
  });

  test("FR-DICEX-39 popup gets every public roll source: DM public dice.roll", async () => {
    let entryId = "";
    const seen = await run(async () => {
      ({ entryId } = await ok<{ entryId: string }>(c.dm, "dice.roll", {
        expression: "1d20",
        public: true,
        label: "DM public",
      }));
    });
    expectOnePopup("DM public dice.roll", seen, "DM", entryId);
  });

  test("FR-DICEX-39 popup gets every public roll source: char.roll check / save / skill / attack (Mira)", async () => {
    const kinds = [
      { kind: "check", ability: "str" },
      { kind: "save", ability: "dex" },
      { kind: "skill", skill: "perception" },
      { kind: "attack" },
    ];
    for (const k of kinds) {
      let entryId = "";
      const seen = await run(async () => {
        ({ entryId } = await ok<{ entryId: string }>(c.p1, "char.roll", {
          characterId: miraId,
          ...k,
        }));
      });
      expectOnePopup(`char.roll ${k.kind}`, seen, "Mira", entryId);
    }
  });

  test("FR-DICEX-40 cbt.start: one DM popup, one named row per monster; players none", async () => {
    const enc = all<EncounterRecord>(c.dm, ENCOUNTER_TYPE).find(
      (e) => e.name === "Ambush at the Ford",
    ) as EncounterRecord;
    const scene = all<SceneRecord>(c.dm, SCENE_TYPE).find((s) => s.name === "Goblin Ambush");
    const seen = await run(async () => {
      await ok(c.dm, "cbt.start", { encounterId: enc.id, sceneId: scene?.id });
    });
    const monsters = all<CombatantRecord>(c.dm, COMBATANT_TYPE).filter(
      (x) => x.encounterId === enc.id && x.kind === "monster",
    );
    // encounter-1: Goblin × 2, Wolf, Elite.
    expect(monsters).toHaveLength(4);
    expect(seen.dm.rolled.map((f) => f.cause)).toEqual(["EncounterStarted"]);
    expect(seen.dm.popups).toHaveLength(1);
    const rows = popupRows(seen.dm.popups[0]?.entries ?? []);
    expect(rows.map((r) => r.actor).sort()).toEqual(monsters.map((m) => m.name).sort());
    expect(rows.every((r) => r.hidden && r.items.length === 1)).toBe(true);
    // One named row per monster, never a "· N rolls" summary.
    expect(rows.some((r) => /rolls/.test(r.actor))).toBe(false);
    expect(seen.dm.popups[0]?.hidden).toBe(true);
    for (const r of ["p1", "p2"] as const) {
      expect(seen[r].frames.some((f) => f.cause === "EncounterStarted")).toBe(true);
      expect([r, seen[r].rolled, seen[r].popups]).toEqual([r, [], []]);
    }
  });

  test("FR-DICEX-39 popup gets every public roll source: cbt.rollInitiative (PC, player-1)", async () => {
    const seen = await run(async () => {
      await ok(c.p1, "cbt.rollInitiative", { combatantIds: [mira().id] });
    });
    expectOnePopup("cbt.rollInitiative PC", seen, "Mira");
  });

  test("FR-DICEX-39 popup gets every public roll source: cbt.attack and cbt.rollDamage (player-1)", async () => {
    const both = await run(async () => {
      await ok<AttackResult>(c.p1, "cbt.attack", { attackerId: mira().id });
    });
    expectOnePopup("cbt.attack both", both, "Mira");

    const toHit = await run(async () => {
      await ok<AttackResult>(c.p1, "cbt.attack", { attackerId: mira().id, rolls: "toHit" });
    });
    expectOnePopup("cbt.attack toHit", toHit, "Mira");

    const dmg = await run(async () => {
      const r = await ok<RollDamageResult>(c.p1, "cbt.rollDamage", { attackerId: mira().id });
      expect(r.attached).toBe(true);
    });
    expectOnePopup("cbt.rollDamage (player completes own card)", dmg, "Mira");
  });

  test("FR-DICEX-39 popup gets every public roll source: DM completes a player's to-hit card (FR-CBT-71)", async () => {
    await run(async () => {
      await ok<AttackResult>(c.p1, "cbt.attack", { attackerId: mira().id, rolls: "toHit" });
    });
    const seen = await run(async () => {
      const r = await ok<RollDamageResult>(c.dm, "cbt.rollDamage", { attackerId: mira().id });
      expect(r.attached).toBe(true);
    });
    expectOnePopup("DM cbt.rollDamage on player card", seen, "Mira");
  });

  test("FR-DICEX-39 popup gets every public roll source: cbtx.rollConcentration and cbtx.rollDeathSave (player-1)", async () => {
    await ok(c.dm, "cbtx.setConcentration", { target: { characterId: miraId }, label: "Bless" });
    // Mira takes 1: the concentration card goes to player-1 (its action owner).
    await ok(c.dm, "cbt.applyHp", { combatantId: mira().id, kind: "damage", amount: 1 });
    for (const r of ROLES) await barrier(c[r]);
    const card = all<NotificationRecord>(c.p1, "notification").find(
      (n) => n.kind === "cbtx-concentration" && n.state === "pending",
    ) as NotificationRecord;
    expect(card).toBeDefined();
    const conc = await run(async () => {
      await ok(c.p1, "cbtx.rollConcentration", { notificationId: card.id });
    });
    expectOnePopup("cbtx.rollConcentration", conc, "Mira");

    // Down to 0: dying → death save.
    await ok(c.dm, "cbt.applyHp", { combatantId: mira().id, kind: "damage", amount: 99 });
    const death = await run(async () => {
      await ok(c.p1, "cbtx.rollDeathSave", { characterId: miraId });
    });
    expectOnePopup("cbtx.rollDeathSave", death, "Mira");
  });

  test("FR-DICEX-39 snapshot, reconnect and undo upserts open no popup", async () => {
    // Undo (FR-CBT-35): the latest HP change → its old log entry upserted `undone`.
    const latest = all<HpChangeRecord>(c.dm, HP_CHANGE_TYPE)
      .filter((x) => !x.undone)
      .sort((a, b) => b.seq - a.seq)[0] as HpChangeRecord;
    expect(latest).toBeDefined();
    const undo = await run(async () => {
      await ok(c.dm, "cbt.undo", { expectedHpChangeId: latest.id });
    });
    const undone = undo.dm.frames.flatMap((f) => f.upserts).filter((e) => e.undone);
    expect(undone.length).toBeGreaterThan(0);
    for (const r of ROLES) expect([r, undo[r].rolled, undo[r].popups]).toEqual([r, [], []]);

    // Reconnect: the snapshot (full of roll entries) opens none; the next live roll opens one.
    for (const [r, name] of [
      ["p1", "Player 1"],
      ["p2", "Player 2"],
    ] as const) {
      c[r].close();
      await c[r].closed;
      watch(r, await h.live(cred(name)));
      await barrier(c[r]);
      const frames = drain(w[r]);
      expect(all<GameLogEntryView>(c[r], GAME_LOG_ENTRY_TYPE).some((e) => e.kind === "roll")).toBe(
        true,
      );
      expect([r, popupsOf(frames).popups]).toEqual([r, []]);
    }
    const dmFresh = await h.live(DM);
    const dmFrames = drain({ c: dmFresh, at: 0, store: emptyStore() });
    expect(popupsOf(dmFrames).popups).toEqual([]);
    dmFresh.close();

    let entryId = "";
    const after = await run(async () => {
      ({ entryId } = await ok<{ entryId: string }>(c.p2, "dice.roll", { expression: "1d8" }));
    });
    expectOnePopup("player-2 dice.roll after reconnect", after, "Player 2", entryId);
  });
});

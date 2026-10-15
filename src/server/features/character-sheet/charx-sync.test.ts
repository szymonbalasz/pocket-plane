// CHARX §13 integration over real sockets on the `character-sheet-full` bundle: visibility
// (FR-CHARX-35/36), creation + live edits, concurrent per-field merge, lock, owner reassignment
// frames (FR-CHARX-13/37), leak scan, convergence, restart.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { CHARX_APPROVED_KIND, CHARX_DRAFT_KIND } from "@shared/character-sheet/notes";
import { CREATURE_SHEET_TYPE, type CreatureSheetRecord } from "@shared/character-sheet/sheet";
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE, REDACTED_CHARACTER_KEYS } from "@shared/entities/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { entity, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";
import { NOTIFICATION_TYPE } from "../notifications/helpers";

const DM = { role: "dm" as const, secret: TEST_SECRET };

/** Ack / reject of one intent; other frames are left for the store. */
async function answer(c: TestClient, intentId: string) {
  for (;;) {
    const f = await c.next(undefined, 1500);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}
/** Polls the client's store until `pred` holds (≤ `ms`). */
async function until(pred: () => boolean, ms = 1000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("condition not reached in time");
    await Bun.sleep(10);
  }
}
const ent = (c: TestClient, id: string) =>
  c.store.records[ENTITY_TYPE]?.[id] as Record<string, unknown> | undefined;
const sheetOf = (c: TestClient, id: string) =>
  c.store.records[CREATURE_SHEET_TYPE]?.[id] as CreatureSheetRecord | undefined;
const sheetIds = (c: TestClient) => Object.keys(c.store.records[CREATURE_SHEET_TYPE] ?? {}).sort();

/** Every `creature-sheet` id any frame `c` received carried (snapshot or event). */
function sheetIdsInFrames(c: TestClient): string[] {
  const ids = new Set<string>();
  for (const f of c.frames) {
    if (f.type === "snapshot") {
      for (const r of (f.records[CREATURE_SHEET_TYPE] ?? []) as { entityId: string }[]) {
        ids.add(r.entityId);
      }
    }
    if (f.type === "event") {
      for (const ch of f.changes) if (ch.type === CREATURE_SHEET_TYPE) ids.add(ch.id);
    }
  }
  return [...ids].sort();
}

/** Kinds of every `notification` row any frame `c` received carried (snapshot or event). */
function noteKindsInFrames(c: TestClient): string[] {
  const kinds = new Set<string>();
  for (const f of c.frames) {
    if (f.type === "snapshot") {
      for (const r of (f.records[NOTIFICATION_TYPE] ?? []) as { kind: string }[]) kinds.add(r.kind);
    }
    if (f.type === "event") {
      for (const ch of f.changes) {
        const after = (ch as { after?: { kind?: string } }).after;
        if (ch.type === NOTIFICATION_TYPE && after?.kind) kinds.add(after.kind);
      }
    }
  }
  return [...kinds].sort();
}
type Note = { kind: string; state: string; text: string; audiencePlayerId: string | null };
const notesOf = (c: TestClient, kind: string) =>
  Object.values(c.store.records[NOTIFICATION_TYPE] ?? {}).filter(
    (n) => (n as Note).kind === kind,
  ) as Note[];

describe("character-sheet-full bundle over WS", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let tokens: Record<string, string>;
  let ids: Record<string, string>;
  const p = (name: string) => ({ role: "player" as const, token: tokens[name] as string });

  beforeAll(async () => {
    const loaded = await loadBundle("character-sheet-full", {
      dmSecret: TEST_SECRET,
      testMode: true,
    });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    tokens = Object.fromEntries(
      db
        .select({ name: player.name, token: player.linkToken })
        .from(player)
        .all()
        .map((r) => [r.name, r.token]),
    );
    ids = Object.fromEntries(
      db
        .select()
        .from(entity)
        .all()
        .map((e) => [e.name, e.id]),
    );
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

  test("FR-CHARX-35 FR-CHARX-36 snapshot: DM every sheet; owner own; other players summary only", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const mira = ids.Mira as string;
    const sela = ids.Sela as string;
    const elite = ids["Elite Goblin Warrior"] as string;
    expect(sheetIds(dm)).toEqual([mira, sela, elite].sort());
    expect(sheetIds(p1)).toEqual([mira]);
    expect(sheetIds(p2)).toEqual([sela]);
    expect(sheetOf(p1, mira)).toMatchObject({ locked: true, notes: "MIRA-NOTE-7" });
    expect(sheetOf(p2, sela)).toMatchObject({ status: "draft", notes: "SELA-NOTE-3" });
    // The one whitelist: exactly the shared keys (the test imports the list, not a copy).
    expect(Object.keys(ent(p2, mira) ?? {}).sort()).toEqual([...REDACTED_CHARACTER_KEYS].sort());
    expect(ent(p2, mira)).toMatchObject({ level: 1, className: "Fighter", species: "Human" });
    expect(Object.keys(ent(p1, sela) ?? {}).sort()).toEqual([...REDACTED_CHARACTER_KEYS].sort());
    // NPC sheets: never to players.
    for (const c of [p1, p2]) {
      expect(ent(c, elite)).toBeUndefined();
      expect(c.raw()).not.toContain("NPC-NOTE-9");
      expect(c.raw()).not.toContain("Elite Goblin Warrior");
    }
    for (const c of [dm, p1, p2]) c.close();
  });

  test("FR-CHARX-41 FR-CHARX-42 visibility per button: player rolls public, DM per category / override; others summary only", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const mira = ids.Mira as string;
    const sela = ids.Sela as string;
    const block = ent(dm, mira)?.statBlock as { attacks: { id: string; name: string }[] };
    const attacks = block.attacks;
    const lc = attacks.find((a) => a.name === "Light crossbow")?.id as string;
    const gb = sheetOf(dm, sela)?.spells.find((s) => s.name === "Guiding Bolt")?.id as string;
    const entryOf = (c: TestClient, id: string) =>
      c.store.records[GAME_LOG_ENTRY_TYPE]?.[id] as
        | { public: boolean; category: string; rollIds: string[] }
        | undefined;
    const roll = async (c: TestClient, payload: object) => {
      const f = await answer(c, c.intent("char.roll", payload));
      expect(f.type).toBe("ack");
      return (f as { result: { entryId: string; rollIds: string[] } }).result;
    };
    // Player: Attack (to-hit only), Damage, Attack + damage → public lines for everyone.
    const btns = [
      ["toHit", 1, "attack"],
      ["damage", 1, "damage"],
      ["attack", 2, "attack"],
    ] as const;
    for (const [kind, n, category] of btns) {
      const r = await roll(p1, { characterId: mira, kind, attackId: lc });
      expect(r.rollIds).toHaveLength(n);
      await until(() => entryOf(p2, r.entryId) !== undefined);
      expect(entryOf(p2, r.entryId)).toMatchObject({ public: true, category });
    }
    const st = await roll(p2, { characterId: sela, kind: "spellToHit", spellId: gb });
    expect(st.rollIds).toHaveLength(1);
    await until(() => entryOf(p1, st.entryId) !== undefined);
    // DM, categories at defaults (hidden): DM-only; the per-category override shows it.
    for (const [kind] of btns) {
      const hidden = await roll(dm, { characterId: mira, kind, attackId: lc });
      const shown = await roll(dm, { characterId: mira, kind, attackId: lc, public: true });
      await until(() => entryOf(p2, shown.entryId) !== undefined);
      expect(entryOf(dm, hidden.entryId)).toMatchObject({ public: false });
      for (const c of [p1, p2]) expect(entryOf(c, hidden.entryId)).toBeUndefined();
    }
    // Rolling never leaks the stat block: other players keep the redacted whitelist.
    expect(Object.keys(ent(p2, mira) ?? {}).sort()).toEqual([...REDACTED_CHARACTER_KEYS].sort());
    expect(Object.keys(ent(p1, sela) ?? {}).sort()).toEqual([...REDACTED_CHARACTER_KEYS].sort());
    expect(p2.raw()).not.toContain("MIRA-NOTE-7");
    for (const c of [dm, p1, p2]) c.close();
  });

  test("FR-CHARX-08 FR-CHARX-15 FR-CHARX-28 player creates Brin; DM + player edits merge per field ≤ 1 s", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const create = p1.intent("char.create", { name: "Brin" });
    const ack = await answer(p1, create);
    expect(ack.type).toBe("ack");
    const brin = (ack as { result: { characterId: string } }).result.characterId;
    ids.Brin = brin;
    await until(() => sheetOf(dm, brin)?.status === "draft");
    await until(() => ent(p2, brin) !== undefined);
    expect(sheetOf(p1, brin)).toMatchObject({ status: "draft" });
    expect(Object.keys(ent(p2, brin) ?? {}).sort()).toEqual([...REDACTED_CHARACTER_KEYS].sort());
    // G8 (FR-CHARX-45): the DM's pending card within 1 s; no player ever receives it.
    await until(() => notesOf(dm, CHARX_DRAFT_KIND).length === 1);
    expect(notesOf(dm, CHARX_DRAFT_KIND)[0]).toMatchObject({
      state: "pending",
      text: "Player 1 made a character: Brin. Awaiting your approval",
    });

    const e1 = p1.intent("char.edit", {
      creatureId: brin,
      set: {
        classes: [{ name: "Rogue", level: 1, hitDie: "d8" }],
        abilities: { str: 8, dex: 16, con: 12, int: 10, wis: 10, cha: 10 },
        skills: { stealth: "expertise" },
        notes: "BRIN-NOTE-1",
      },
    });
    expect((await answer(p1, e1)).type).toBe("ack");
    // Concurrent: DM sets AC while the player sets HP max; both survive.
    const started = performance.now();
    const a = dm.intent("char.edit", { creatureId: brin, set: { ac: 15 } });
    const b = p1.intent("char.edit", { creatureId: brin, set: { hpMax: 10 } });
    expect((await answer(dm, a)).type).toBe("ack");
    expect((await answer(p1, b)).type).toBe("ack");
    const both = (c: TestClient) => {
      const sb = ent(c, brin)?.statBlock as { ac: number; hpMax: number } | undefined;
      return sb?.ac === 15 && sb.hpMax === 10 && ent(c, brin)?.hpCurrent === 10;
    };
    await until(() => both(dm));
    await until(() => both(p1));
    expect(performance.now() - started).toBeLessThan(1000);
    await until(() => ent(p2, brin)?.className === "Rogue");
    expect(p2.raw()).not.toContain("BRIN-NOTE-1");

    // Stealth = 3 + 2 × 2 (expertise): the server builds the roll.
    const r = p1.intent("char.roll", { characterId: brin, kind: "skill", skill: "stealth" });
    expect((await answer(p1, r)).type).toBe("ack");
    await until(() =>
      Object.values(p2.store.records[GAME_LOG_ENTRY_TYPE] ?? {}).some(
        (e) => (e as { actorName: string }).actorName === "Brin",
      ),
    );
    // One open draft.
    const again = p1.intent("char.create", { name: "Brin Two" });
    expect(await answer(p1, again)).toMatchObject({ type: "reject", code: "conflict" });
    for (const c of [dm, p1, p2]) c.close();
  });

  test("FR-CHARX-10 FR-CHARX-12 approve, lock: player edit forbidden; roll, HP, counters still work", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const brin = ids.Brin as string;
    for (const [name, payload] of [
      ["char.approve", { characterId: brin }],
      ["char.setLock", { characterId: brin, locked: true }],
    ] as const) {
      expect((await answer(dm, dm.intent(name, payload))).type).toBe("ack");
    }
    await until(() => sheetOf(p1, brin)?.locked === true && sheetOf(p1, brin)?.status === "ready");
    // G8 (FR-CHARX-45/46): card resolved for the DM; the owner (only) gets the approval.
    await until(() => notesOf(p1, CHARX_APPROVED_KIND).length === 1);
    expect(notesOf(p1, CHARX_APPROVED_KIND)[0]).toMatchObject({
      state: "info",
      text: "Brin was approved by the DM: ready to play",
    });
    await until(() => notesOf(dm, CHARX_DRAFT_KIND)[0]?.state === "resolved");
    const ed = p1.intent("char.edit", { creatureId: brin, set: { ac: 18 } });
    expect(await answer(p1, ed)).toMatchObject({
      type: "reject",
      code: "forbidden",
      message: "Locked by the DM",
    });
    for (const [name, payload] of [
      ["char.roll", { characterId: brin, kind: "skill", skill: "stealth" }],
      ["char.adjustHp", { characterId: brin, delta: -2 }],
      ["char.useResource", { characterId: brin, resource: { hitDie: "d8" }, delta: 1 }],
    ] as const) {
      expect((await answer(p1, p1.intent(name, payload))).type).toBe("ack");
    }
    await until(() => ent(p1, brin)?.hpCurrent === 8 && sheetOf(p1, brin)?.hitDiceUsed.d8 === 1);
    for (const c of [dm, p1]) c.close();
  });

  test("FR-CHARX-13 FR-CHARX-37 reassign Kell: old owner gets the sheet delete + summary; new owner full", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    // The DM needs an owner (FR-CHARX-08); then with Player 2's id.
    const cr = dm.intent("char.create", { name: "Kell" });
    expect(await answer(dm, cr)).toMatchObject({ type: "reject", code: "invalid" });
    const p2Id = (ent(dm, ids.Sela as string) as { ownerPlayerId: string }).ownerPlayerId;
    const ok = await answer(dm, dm.intent("char.create", { name: "Kell", ownerPlayerId: p2Id }));
    const kell = (ok as { result: { characterId: string } }).result.characterId;
    ids.Kell = kell;
    await until(
      () => sheetOf(p2, kell)?.status === "ready" && ent(p2, kell)?.statBlock !== undefined,
    );
    const p1Id = (ent(dm, ids.Mira as string) as { ownerPlayerId: string }).ownerPlayerId;
    const mv = dm.intent("char.edit", {
      creatureId: kell,
      set: { ownerPlayerId: p1Id, notes: "KELL" },
    });
    expect((await answer(dm, mv)).type).toBe("ack");
    await until(() => sheetOf(p2, kell) === undefined);
    await until(() => sheetOf(p1, kell)?.notes === "KELL");
    expect(Object.keys(ent(p2, kell) ?? {}).sort()).toEqual([...REDACTED_CHARACTER_KEYS].sort());
    expect(ent(p1, kell)).toHaveProperty("statBlock");
    // The last frame for Kell's sheet that player 2 received is a delete.
    const last = p2.frames
      .flatMap((f) => (f.type === "event" ? f.changes : []))
      .filter((ch) => ch.type === CREATURE_SHEET_TYPE && ch.id === kell)
      .at(-1);
    expect(last?.op).toBe("delete");
    expect(p2.raw()).not.toContain("KELL");
    for (const c of [dm, p1, p2]) c.close();
  });

  test("CHARX §13 leak scan, convergence, restart → identical snapshots", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    // Live traffic on every sheet, then scan what each player ever received.
    const edits = [
      ["char.edit", { creatureId: ids.Mira, set: { notes: "MIRA-NOTE-7b" } }],
      ["char.edit", { creatureId: ids.Sela, set: { notes: "SELA-NOTE-3b" } }],
      ["char.edit", { creatureId: ids["Elite Goblin Warrior"], set: { notes: "NPC-NOTE-9b" } }],
      ["char.putRow", { creatureId: ids.Mira, list: "items", row: { name: "MIRA-ROPE" } }],
    ] as const;
    for (const [name, payload] of edits) {
      expect((await answer(dm, dm.intent(name, payload))).type).toBe("ack");
    }
    await until(() => sheetOf(p1, ids.Mira as string)?.items.length === 4);
    await until(() => sheetOf(p2, ids.Sela as string)?.notes === "SELA-NOTE-3b");
    for (const s of ["MIRA-NOTE-7", "NPC-NOTE-9", "MIRA-ROPE", "BRIN-NOTE-1"]) {
      expect(p2.raw()).not.toContain(s);
    }
    for (const s of ["SELA-NOTE-3", "NPC-NOTE-9"]) expect(p1.raw()).not.toContain(s);
    expect(sheetIdsInFrames(p2)).toEqual([ids.Sela as string]);
    expect(sheetIdsInFrames(p1).sort()).toEqual([ids.Brin, ids.Kell, ids.Mira].sort() as string[]);
    for (const c of [dm, p1, p2]) expect(leakScan(h.s, c)).toEqual([]);
    // G8 leak scan: no player frame carries a draft card; Player 2 never Brin's approval.
    expect(noteKindsInFrames(p1)).not.toContain(CHARX_DRAFT_KIND);
    expect(noteKindsInFrames(p2)).not.toContain(CHARX_DRAFT_KIND);
    expect(noteKindsInFrames(p2)).not.toContain(CHARX_APPROVED_KIND);
    expect(noteKindsInFrames(p1)).toContain(CHARX_APPROVED_KIND);
    for (const [live, cred] of [
      [dm, DM],
      [p1, p("Player 1")],
      [p2, p("Player 2")],
    ] as const) {
      const fresh = await h.live(cred);
      const c = convergence(h.s, live, fresh);
      expect(c.live[CREATURE_SHEET_TYPE]).toEqual(c.fresh[CREATURE_SHEET_TYPE] ?? {});
      expect(c.live[ENTITY_TYPE]).toEqual(c.fresh[ENTITY_TYPE] ?? {});
      fresh.close();
    }
    for (const c of [dm, p1, p2]) c.close();

    const snap = async () => {
      const out: Record<string, unknown> = {};
      for (const [k, cred] of Object.entries({ dm: DM, p1: p("Player 1"), p2: p("Player 2") })) {
        const client = await h.live(cred);
        out[k] = {
          entities: client.store.records[ENTITY_TYPE],
          sheets: client.store.records[CREATURE_SHEET_TYPE],
        };
        client.close();
      }
      return out;
    };
    const before = await snap();
    await h.restart();
    expect(await snap()).toEqual(before);
  });

  test("FR-CHARX-45 a pending draft card survives a restart (DM snapshot); players never get it", async () => {
    const p1 = await h.live(p("Player 1"));
    const ack = await answer(p1, p1.intent("char.create", { name: "Quill" }));
    expect(ack.type).toBe("ack");
    p1.close();
    await h.restart();
    const dm = await h.live(DM);
    const quill = notesOf(dm, CHARX_DRAFT_KIND).filter((n) => n.state === "pending");
    expect(quill.map((n) => n.text)).toEqual([
      "Player 1 made a character: Quill. Awaiting your approval",
    ]);
    for (const name of ["Player 1", "Player 2"]) {
      const c = await h.live(p(name));
      expect(noteKindsInFrames(c)).not.toContain(CHARX_DRAFT_KIND);
      c.close();
    }
    dm.close();
  });
});

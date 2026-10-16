// FOG §13 Invisible leak tests (#210, FR-FOG-45 / -46) over real sockets on the `vision` bundle,
// Goblin Ambush active: static clear never counts for an invisible token; only a player whose
// source has Sees invisible and the token in sight receives it; the party still sees invisible
// PCs; the combatant is party-level (FR-FOG-14); `invisible` is never on a player wire.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  until,
  type VisionHarness,
  visionHarness,
} from "@fixtures/units/fog-of-war/vision-harness";
import { FOG_INTENTS as F } from "@shared/fog-of-war/schemas";
import { MAP_INTENTS as I, TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { eventLog, token } from "../../db/schema";

const PARTY = ["Mira", "Thorn"];
// `seesInvisible` absent in `char.edit` keeps the stored value (FR-CHARX-53): send it explicitly.
const MIRA = { visionFt: 30, darkvisionFt: 0, seesMagicalDarkness: false, seesInvisible: false };
const THORN = { visionFt: 0, darkvisionFt: 60, seesMagicalDarkness: true };

describe("FOG §13 Invisible (#210): FR-FOG-45 / -46 per player", () => {
  let t: VisionHarness;
  beforeAll(async () => {
    t = await visionHarness();
  });
  afterAll(async () => {
    await t.stop();
  });

  const invisible = (name: string, on: boolean) =>
    t.ok(t.dm, F.setInvisible, { tokenId: t.id(name), invisible: on });
  const row = (name: string) =>
    t.db
      .select()
      .from(token)
      .where(eq(token.id, t.id(name)))
      .get();
  const combatantNames = (w: "p1" | "p2") =>
    Object.values(t.c[w].store.records.combatant ?? {}).map((r) => (r as { name: string }).name);

  test("FR-FOG-46 Goblin moved into the revealed nook (inside both polygons) → P1 and P2 get it", async () => {
    await t.move(t.dm, "Goblin", 1, 10);
    await t.expectSee({ p1: [...PARTY, "Goblin"], p2: [...PARTY, "Goblin"] });
  });

  test("FR-FOG-45 / -46 setInvisible on → one TokenInvisibleSet, both delete (static clear never counts); DM row invisible + fogged", async () => {
    const m = t.mark();
    const n = t.db.select().from(eventLog).all().length;
    await invisible("Goblin", true);
    await t.expectSee({ p1: PARTY, p2: PARTY }, m);
    for (const w of ["p1", "p2"] as const) {
      const ev = t.events(t.c[w], m[w], "TokenInvisibleSet");
      expect(ev).toHaveLength(1);
      expect(ev[0]?.changes).toEqual([{ type: TOKEN_TYPE, id: t.id("Goblin"), op: "delete" }]);
    }
    expect(t.db.select().from(eventLog).all().length).toBe(n + 1);
    await until(
      () =>
        (t.dm.store.records[TOKEN_TYPE]?.[t.id("Goblin")] as TokenRecord | undefined)?.invisible ===
        true,
    );
    expect(t.dm.store.records[TOKEN_TYPE]?.[t.id("Goblin")]).toMatchObject({
      invisible: true,
      fogged: true,
    });
    expect(row("Goblin")?.seenBy).toEqual([]);
  });

  test("FR-FOG-46 Thorn's Sees invisible on → P2 upsert, P1 nothing; no P1 frame names Goblin (snapshot + resync too)", async () => {
    const m = t.mark();
    await t.senses("Thorn", { ...THORN, seesInvisible: true });
    await t.expectSee({ p1: PARTY, p2: [...PARTY, "Goblin"] }, m);
    expect(JSON.stringify(t.c.p1.frames.slice(m.p1))).not.toContain(t.id("Goblin"));
    // `vision.inv` lists Thorn's polygon (index into see ++ dark).
    expect(t.visionOf(t.c.p2, "p2")?.inv).toEqual([0]);
    expect(t.visionOf(t.c.p1, "p1")).not.toHaveProperty("inv");
  });

  test("FR-FOG-45 a player → forbidden; same value → no-op (no event); invisible + hidden → nobody", async () => {
    const a = await t.send(t.c.p1, F.setInvisible, { tokenId: t.id("Goblin"), invisible: false });
    expect(a).toMatchObject({ type: "reject", code: "forbidden" });
    const n = t.db.select().from(eventLog).all().length;
    await invisible("Goblin", true);
    expect(t.db.select().from(eventLog).all().length).toBe(n);
    const unknown = await t.send(t.dm, F.setInvisible, { tokenId: "nope", invisible: true });
    expect(unknown).toMatchObject({ type: "reject", code: "not_found" });
    await t.ok(t.dm, I.setTokenHidden, { tokenId: t.id("Goblin"), hidden: true });
    await t.expectSee({ p1: PARTY, p2: PARTY });
    await t.ok(t.dm, I.setTokenHidden, { tokenId: t.id("Goblin"), hidden: false });
    await t.expectSee({ p1: PARTY, p2: [...PARTY, "Goblin"] });
  });

  test("FR-FOG-46 Goblin back at (12, 6) invisible, Mira (7, 5) with d1 open → P1 nothing; Mira's Sees invisible on → P1 upsert", async () => {
    await t.move(t.dm, "Goblin", 12, 6);
    await t.setDoor(0);
    await t.move(t.c.p1, "Mira", 7, 5);
    await t.expectSee({ p1: PARTY, p2: PARTY });
    const m = t.mark();
    await t.senses("Mira", { ...MIRA, seesInvisible: true });
    await t.expectSee({ p1: [...PARTY, "Goblin"], p2: PARTY }, m);
  });

  test("FR-FOG-11 / -15 P1's can't-see `not_found` and drag audience follow Sees invisible", async () => {
    await t.senses("Mira", MIRA);
    await t.expectSee({ p1: PARTY, p2: PARTY });
    for (const name of [I.checkMove, I.moveToken]) {
      const a = await t.send(t.c.p1, name, { tokenId: t.id("Goblin"), col: 3, row: 3 });
      expect(a).toMatchObject({ type: "reject", code: "not_found" });
    }
    let m = t.mark();
    t.drag(t.dm, "Goblin", [12, 5]);
    t.drag(t.dm, "Goblin", "end");
    await Bun.sleep(150);
    expect(t.drags(t.c.p1, m.p1)).toEqual([]);
    expect(t.drags(t.c.p2, m.p2)).toEqual([]);
    await t.senses("Mira", { ...MIRA, seesInvisible: true });
    await t.expectSee({ p1: [...PARTY, "Goblin"], p2: PARTY });
    m = t.mark();
    t.drag(t.dm, "Goblin", [12, 5]);
    t.drag(t.dm, "Goblin", "end");
    await until(() => t.drags(t.c.p1, m.p1).length === 2);
    expect(t.drags(t.c.p2, m.p2)).toEqual([]);
  });

  test("FR-FOG-14 combat: the invisible Goblin's combatant reaches both once P1 sees it; hidden for both while nobody does", async () => {
    const enc = Object.values(t.dm.store.records.encounter ?? {}) as { id: string; name: string }[];
    const encounterId = enc.find((e) => e.name === "Ambush at the Ford")?.id as string;
    await t.ok(t.dm, "cbt.start", { encounterId, sceneId: t.ambushId });
    await until(() => combatantNames("p1").includes("Goblin"));
    await until(() => combatantNames("p2").includes("Goblin"));
    // P2 gets the row (party-level), never the token.
    expect(t.names(t.c.p2)).not.toContain("Goblin");
    await t.senses("Mira", MIRA);
    await until(() => !combatantNames("p1").includes("Goblin"));
    await until(() => !combatantNames("p2").includes("Goblin"));
    await t.senses("Mira", { ...MIRA, seesInvisible: true });
    await until(() => combatantNames("p2").includes("Goblin"));
  });

  test("FR-FOG-45 duplicate copies `invisible`; owned Mira set invisible → P1 and P2 unchanged (party rule)", async () => {
    const dup = (await t.ok(t.dm, I.duplicateToken, { tokenId: t.id("Goblin") })) as {
      tokenId: string;
    };
    expect(t.db.select().from(token).where(eq(token.id, dup.tokenId)).get()?.invisible).toBe(true);
    await t.ok(t.dm, I.deleteToken, { tokenId: dup.tokenId });
    const m = t.mark();
    await invisible("Mira", true);
    await t.expectSee({ p1: [...PARTY, "Goblin"], p2: PARTY }, m);
    for (const w of ["p1", "p2"] as const) {
      expect(t.events(t.c[w], m[w], "TokenInvisibleSet")[0]?.changes ?? []).toEqual([]);
    }
    await invisible("Mira", false);
  });

  test("FR-FOG-46 Invisible off re-derives by FR-FOG-34 in the same event; `invisible` never on a player wire", async () => {
    await t.senses("Mira", MIRA);
    await t.expectSee({ p1: PARTY, p2: PARTY });
    const m = t.mark();
    await invisible("Goblin", false);
    await t.expectSee({ p1: [...PARTY, "Goblin"], p2: PARTY }, m);
    expect(t.events(t.c.p1, m.p1, "TokenInvisibleSet")[0]?.changes.map((c) => c.op)).toContain(
      "upsert",
    );
    for (const w of ["p1", "p2"] as const) expect(t.c[w].raw()).not.toContain('"invisible"');
  });
});

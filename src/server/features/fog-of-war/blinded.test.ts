// FOG §13 sprint-4 Blinded (V10, FR-FOG-48; seams S6, OQ-FOG-61): fog's `effectHooks` line over
// real sockets on `vision-party` (`player-1` = Mira, `player-2` = Thorn; Goblin Ambush active,
// out of combat). Each state: snapshot + every frame, a fresh connection and a `resync`
// (`expectSee`). Then the pure part: a Blinded source has no polygon, the chip reason, the cache
// key's Blinded bit, the party's non-source rule for a secret Blinded.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type VisionHarness, visionHarness } from "@fixtures/units/fog-of-war/vision-harness";
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import { FOG_INTENTS as F, VISION_TYPE, type VisionRecord } from "@shared/fog-of-war/schemas";
import { NORMAL_SENSES, prepareScene } from "@shared/fog-of-war/vision";
import { FOG_SIGHT_HINT, MAP_INTENTS as I } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { scene, sceneFog } from "../../db/schema";
import { type Blinded, partyOf, type SourceToken, sightKey, sourcesVision } from "./sight";

const PARTY = ["Mira", "Thorn"];

describe("FOG §13 V10 Blinded walkthrough (player-1, player-2)", () => {
  let t: VisionHarness;
  let miraBlinded = "";
  beforeAll(async () => {
    t = await visionHarness("vision-party");
  });
  afterAll(async () => {
    await t.stop();
  });
  const party = (on: boolean) => t.ok(t.dm, F.setPartyVision, { on });
  const blind = async (name: string, secret = false) => {
    const r = await t.ok(t.dm, CBTX_INTENTS.addEffect, {
      targets: [{ characterId: t.charId(name) }],
      kind: "condition",
      condition: "blinded",
      ...(secret ? { secret: true } : {}),
    });
    return (r.effectIds as string[])[0] as string;
  };
  const unblind = (effectId: string) => t.ok(t.dm, CBTX_INTENTS.endEffect, { effectId });
  const townStale = () => {
    const town = t.db.select().from(scene).all().find((s) => s.name === "Town")?.id as string;
    return t.db.select().from(sceneFog).where(eq(sceneFog.sceneId, town)).get()?.visionStale;
  };
  /** P's own `vision` as P holds it; another player's copy as `w` holds it. */
  const copy = (w: "p1" | "p2", of: "p1" | "p2") =>
    t.c[w].store.records[VISION_TYPE]?.[`${t.ambushId}:${t.pid[of]}`] as VisionRecord | undefined;
  /** Every frame of a client since `from`, as one string. */
  const rawSince = (w: "p1" | "p2", from: number) => JSON.stringify(t.c[w].frames.slice(from));

  test("FR-FOG-48 Blinded on Thorn (party off): P2 blind with reason `blinded`, keeps only Thorn; his other source scene (Town) → `visionStale`; ended → own sight", async () => {
    expect(townStale()).toBe(false);
    let m = t.mark();
    const e = await blind("Thorn");
    await t.expectSee({ p1: PARTY, p2: ["Thorn"] }, m);
    expect(copy("p2", "p2")).toMatchObject({ blind: true, reason: "blinded", see: [], dark: [] });
    expect(t.events(t.c.p2, m.p2, "EffectsAdded")).toHaveLength(1);
    expect(townStale()).toBe(true);
    m = t.mark();
    await unblind(e);
    await t.expectSee({ p1: PARTY, p2: PARTY }, m);
    expect(copy("p2", "p2")?.blind).toBe(false);
    expect("reason" in (copy("p2", "p2") ?? {})).toBe(false);
  });

  test("FR-FOG-48 Blinded on Mira with Goblin in sight (party off): P1 `vision {blind: true}` + deletes in the effect's event; P2 unchanged", async () => {
    await t.setDoor(0);
    let m = t.mark();
    await t.move(t.c.p1, "Mira", 7, 5);
    await t.expectSee({ p1: [...PARTY, "Goblin"], p2: PARTY }, m);
    m = t.mark();
    miraBlinded = await blind("Mira");
    await t.expectSee({ p1: ["Mira"], p2: PARTY }, m);
    const ev = t.events(t.c.p1, m.p1, "EffectsAdded");
    expect(ev).toHaveLength(1);
    const ops = ev[0]?.changes.map((c) => `${c.type}:${c.op}`) ?? [];
    expect(ops).toContain(`${VISION_TYPE}:upsert`);
    expect(ev[0]?.changes.filter((c) => c.op === "delete").map((c) => c.id)).toEqual(
      expect.arrayContaining([t.id("Goblin"), t.id("Thorn")]),
    );
    expect(copy("p1", "p1")).toMatchObject({ blind: true, reason: "blinded" });
  });

  test("FR-FOG-48 / -50 party on: Blinded P1 keeps the party's sight; P2's copy says `blind`, never the reason; Thorn blinded too → party-blind; both ended → own sight", async () => {
    let m = t.mark();
    await party(true);
    await t.expectSee({ p1: PARTY, p2: PARTY }, m, { party: true });
    expect(copy("p1", "p1")).toMatchObject({ blind: true, reason: "blinded" });
    const p1ForP2 = copy("p2", "p1");
    expect(p1ForP2?.blind).toBe(true);
    expect(p1ForP2 && "reason" in p1ForP2).toBe(false);
    m = t.mark();
    const e = await blind("Thorn");
    await t.expectSee({ p1: ["Mira"], p2: ["Thorn"] }, m, { party: true });
    m = t.mark();
    await unblind(e);
    await t.expectSee({ p1: PARTY, p2: PARTY }, m, { party: true });
    m = t.mark();
    await party(false);
    await unblind(miraBlinded);
    await t.expectSee({ p1: [...PARTY, "Goblin"], p2: PARTY }, m, { party: true });
    expect(copy("p1", "p1")?.blind).toBe(false);
  });

  test("FR-FOG-48 secret Blinded (OQ-FOG-61): P1 chip reason `unknown`; no P1 or P2 frame says Blinded or names the effect; party on → P2's copy of P1 is a non-source (`blind: false`, no polygons); a drag gives no sight", async () => {
    let m = t.mark();
    const e = await blind("Mira", true);
    await t.expectSee({ p1: ["Mira"], p2: PARTY }, m, { party: true });
    expect(copy("p1", "p1")).toMatchObject({ blind: true, reason: "unknown", see: [], dark: [] });
    const probe = await t.ok(t.c.p1, I.checkMove, { tokenId: t.id("Mira"), col: 7, row: 6 });
    expect((probe.hints as { guard: string }[]).some((h) => h.guard === FOG_SIGHT_HINT)).toBe(
      false,
    );
    await party(true);
    await t.expectSee({ p1: PARTY, p2: PARTY }, m, { party: true });
    expect(copy("p2", "p1")).toEqual({
      id: `${t.ambushId}:${t.pid.p1}`,
      sceneId: t.ambushId,
      playerId: t.pid.p1,
      blind: false,
      see: [],
      dark: [],
      src: [],
    });
    expect(copy("p1", "p1")).toMatchObject({ blind: true, reason: "unknown" });
    for (const w of ["p1", "p2"] as const) {
      const raw = rawSince(w, m[w]);
      expect(raw).not.toContain("Blinded");
      expect(raw).not.toContain("blinded");
      expect(raw).not.toContain(e);
      expect(raw).not.toContain('"secret"');
    }
    m = t.mark();
    await party(false);
    await unblind(e);
    await t.expectSee({ p1: [...PARTY, "Goblin"], p2: PARTY }, m, { party: true });
    for (const w of ["p1", "p2"] as const) expect(rawSince(w, m[w])).not.toContain("blinded");
  });
});

describe("FR-FOG-48 Blinded sources (pure)", () => {
  const occ = prepareScene([], [], [0, 0, 20, 14]);
  const src = (id: string, blinded: Blinded, x = 5): SourceToken => ({
    id,
    tokenId: id,
    playerId: "p",
    col: x,
    row: 5,
    size: "medium",
    x: x + 0.5,
    y: 5.5,
    senses: NORMAL_SENSES,
    blinded,
  });

  test("FR-FOG-48 Blinded source → no polygon, blind reason (`blinded`; `unknown` with a secret one among the causes)", () => {
    const one = sourcesVision(occ, [src("a", "open")]);
    expect(one).toMatchObject({ blind: true, reason: "blinded", see: [], dark: [], src: [] });
    expect(one.secret).toBe(false);
    const both = sourcesVision(occ, [src("a", "open"), src("b", "secret", 8)]);
    expect(both).toMatchObject({ blind: true, reason: "unknown", secret: true });
    const mixed = sourcesVision(occ, [src("a", "open"), src("b", false, 8)]);
    expect(mixed.blind).toBe(false);
    expect(mixed.src).toEqual(["b"]);
    expect(mixed.reason).toBeUndefined();
    const none = sourcesVision(occ, [src("b", false)]);
    expect(none.blind).toBe(false);
    expect(none.see).toHaveLength(1);
  });

  test("FR-FOG-38 / -48 the cache key carries each source's Blinded bit", () => {
    const keys = (["open", "secret", false] as const).map((b) => sightKey("base", [src("a", b)]));
    expect(new Set(keys).size).toBe(3);
  });

  test("FR-FOG-48 / -50 party: a secret-Blinded player is a non-source (not party-blind with another sighted player; their polygons none)", () => {
    const secret = sourcesVision(occ, [src("a", "secret")]);
    const open = sourcesVision(occ, [src("a", "open")]);
    const sees = sourcesVision(occ, [src("b", false)]);
    expect(partyOf([open])?.blind).toBe(true);
    expect(partyOf([secret])?.blind).toBe(false);
    expect(partyOf([secret])?.polys).toEqual([]);
    expect(partyOf([secret, sees])?.polys).toHaveLength(1);
    expect(partyOf([open, sees])?.blind).toBe(false);
  });
});

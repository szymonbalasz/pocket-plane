// FOG §13 sprint-4 rows (V6 plumbing; V8 sends it from `map.checkMove`): FR-FOG-53 `fog.sight`
// audience (active scene, token holders, the owner when the DM drags, the party while party
// vision is on, nobody while party-blind, never the DM) over real sockets through a test intent
// whose result carries the signal, and FR-FOG-43 View as → Party (`sync.loadScene {viewAs:
// "party"}`: every player's `vision` + `fog-explored`; convergence on the loaded set; a player →
// forbidden). `vision-party` bundle, Goblin Ambush active.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  answer,
  DM,
  type VisionHarness,
  visionHarness,
} from "@fixtures/units/fog-of-war/vision-harness";
import {
  FOG_INTENTS as F,
  FOG_EXPLORED_TYPE,
  FOG_SIGNALS,
  type FogSightPayload,
  VISION_TYPE,
} from "@shared/fog-of-war/schemas";
import { SYNC_LOAD_SCENE, VIEW_AS_PARTY } from "@shared/protocol/scene-window";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type CommandDef, defineCommand } from "../../commands/commands";
import { token } from "../../db/schema";
import { withSignals } from "../../ws/signals";
import { convergence } from "../../ws/testing/convergence";
import { fogSightAudience } from "./sight-signal";

/** Stands in for V8's `map.checkMove` hint: `fog.sight` for a token, audience per FR-FOG-53. */
const probe = defineCommand({
  name: "test.sightProbe",
  input: z.object({ tokenId: z.string() }),
  roles: ["dm", "player"],
  execute({ tokenId }, env) {
    const t = env.tx.select().from(token).where(eq(token.id, tokenId)).get();
    if (!t) return {};
    const payload: FogSightPayload = {
      sceneId: t.sceneId,
      tokenId,
      see: [[0, 0, 1, 0, 1, 1]],
      dark: [],
    };
    const audience = fogSightAudience(env.tx, t, env.actor);
    return withSignals({}, [{ name: FOG_SIGNALS.sight, payload, audience }]);
  },
});

describe("FR-FOG-53 fog.sight audience (V6 plumbing)", () => {
  let t: VisionHarness;
  beforeAll(async () => {
    t = await visionHarness("vision-party");
    t.h.s.commands.register(probe as unknown as CommandDef);
    t.h.s.intents.add(probe.name);
  });
  afterAll(async () => {
    await t.stop();
  });
  const sights = (w: "p1" | "p2", from: number) =>
    t.c[w].frames.slice(from).filter((f) => f.type === "signal" && f.name === FOG_SIGNALS.sight);
  const sightProbe = async (who: "dm" | "p1" | "p2", name: string) => {
    const c = who === "dm" ? t.dm : t.c[who];
    const id = c.intent(probe.name, { tokenId: t.id(name) });
    await answer(c, id);
    await Bun.sleep(30);
  };

  test("FR-FOG-53 party off: the owner's own probe reaches nobody; the DM's probe of Thorn reaches only Thorn's owner; never the DM", async () => {
    let m = t.mark();
    await sightProbe("p1", "Mira");
    expect(sights("p1", m.p1)).toEqual([]);
    expect(sights("p2", m.p2)).toEqual([]);
    m = t.mark();
    const dmFrames = t.dm.frames.length;
    await sightProbe("dm", "Thorn");
    expect(sights("p2", m.p2)).toHaveLength(1);
    expect(sights("p1", m.p1)).toEqual([]);
    expect(t.dm.frames.slice(dmFrames).some((f) => f.type === "signal")).toBe(false);
    expect(sights("p2", m.p2)[0]).toMatchObject({ from: { role: "dm" } });
  });

  test("FR-FOG-53 party on: every other holder gets it; a prep-scene token reaches no player; party-blind → nobody", async () => {
    await t.send(t.dm, F.setPartyVision, { on: true });
    let m = t.mark();
    await sightProbe("p1", "Mira");
    expect(sights("p2", m.p2)).toHaveLength(1);
    expect(sights("p1", m.p1)).toEqual([]);
    // A token on a prep scene (Town): no player frame.
    const town = t.db
      .select()
      .from(token)
      .all()
      .find((x) => x.name === "Mira" && x.sceneId !== t.ambushId);
    m = t.mark();
    const id = t.dm.intent(probe.name, { tokenId: town?.id as string });
    await answer(t.dm, id);
    await Bun.sleep(30);
    expect(sights("p1", m.p1)).toEqual([]);
    expect(sights("p2", m.p2)).toEqual([]);
    // Party-blind: both PCs into the darkness, Thorn without see-through.
    await t.senses("Thorn", { visionFt: 0, darkvisionFt: 60, seesMagicalDarkness: false });
    await t.move(t.dm, "Mira", 12, 9);
    await t.move(t.dm, "Thorn", 11, 9);
    m = t.mark();
    await sightProbe("dm", "Thorn");
    expect(sights("p1", m.p1)).toEqual([]);
    expect(sights("p2", m.p2)).toEqual([]);
    // Restore.
    await t.senses("Thorn", {
      visionFt: 0,
      darkvisionFt: 60,
      seesMagicalDarkness: true,
      seesInvisible: true,
    });
    await t.move(t.dm, "Mira", 2, 7);
    await t.move(t.dm, "Thorn", 2, 9);
    await t.send(t.dm, F.setPartyVision, { on: false });
  });

  test("FR-FOG-43 View as → Party: `sync.loadScene {viewAs: party}` returns every player's `vision` and `fog-explored`; convergence on the loaded set; a player → forbidden", async () => {
    // Memory for both players first (Explored is on): move each source a cell and back.
    await t.move(t.c.p1, "Mira", 2, 6);
    await t.move(t.c.p2, "Thorn", 2, 10);
    const id = t.dm.loadViewAs(t.ambushId, VIEW_AS_PARTY);
    const ack = (await answer(t.dm, id)) as {
      type: string;
      result?: { records: Record<string, { playerId: string }[]> };
    };
    expect(ack.type).toBe("ack");
    const recs = ack.result?.records ?? {};
    expect((recs[VISION_TYPE] ?? []).map((r) => r.playerId).sort()).toEqual(
      [t.pid.p1, t.pid.p2].sort(),
    );
    expect((recs[FOG_EXPLORED_TYPE] ?? []).map((r) => r.playerId).sort()).toEqual(
      [t.pid.p1, t.pid.p2].sort(),
    );
    // The DM wire: Thorn's `inv` is there (DM full).
    expect(JSON.stringify(recs[VISION_TYPE])).toContain('"inv"');
    // Convergence on the loaded `(sceneId, "party")` set: a later move follows as an event.
    await t.move(t.c.p1, "Mira", 2, 7);
    const fresh = await t.h.live(DM);
    fresh.loadScene(t.ambushId);
    const fid = fresh.loadViewAs(t.ambushId, VIEW_AS_PARTY);
    await answer(fresh, fid);
    const conv = convergence(t.h.s, t.dm, fresh);
    for (const type of [VISION_TYPE, FOG_EXPLORED_TYPE]) {
      expect(conv.live[type] ?? {}).toEqual(conv.fresh[type] ?? {});
      expect(Object.keys(conv.live[type] ?? {})).toHaveLength(2);
    }
    fresh.close();
    // A player sending it → forbidden.
    const r = await t.send(t.c.p1, SYNC_LOAD_SCENE, { sceneId: t.ambushId, viewAs: VIEW_AS_PARTY });
    expect(r).toMatchObject({ type: "reject", code: "forbidden" });
    await t.move(t.c.p2, "Thorn", 2, 9);
  });
});

// ASSET §13 leak property: with test-only record types that carry asset IDs (visible /
// hidden / redacted without the ID / scene-scoped), after every step of a random change
// sequence, every asset ID found by string scan in a player's frames sits in a record that
// player may see at that point. Asset uploads run in the same sequence.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { defineEvent } from "@shared/events";
import type { ServerFrame } from "@shared/protocol/frames";
import { z } from "zod";
import { type CommandDef, defineCommand } from "../../commands/commands";
import type { TestClient } from "../../testing/harness";
import { defineRecordType } from "../../ws/records";
import { requireAsset } from "./commands";
import { ingestAsset } from "./ingest";
import { type AssetServer, startAssetServer, TEST_SECRET, testPng } from "./testing";

const Mode = z.enum(["visible", "hidden", "redacted"]);
const Item = z.object({
  id: z.string(),
  campaignId: z.string(),
  mode: Mode,
  assetId: z.string(),
});
type Item = z.infer<typeof Item>;
const SceneItem = z.object({
  id: z.string(),
  campaignId: z.string(),
  sceneId: z.string(),
  assetId: z.string(),
});
type SceneItem = z.infer<typeof SceneItem>;

const LeakChanged = defineEvent({
  type: "LeakChanged",
  payload: z.object({}),
  logged: false,
  undoable: false,
});

/** mulberry32: deterministic sequence. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let h: AssetServer;
beforeAll(async () => {
  h = await startAssetServer({ testMode: true });
});
afterAll(async () => {
  await h.stop();
});

test("FR-ASSET-12 leak property: player frames carry asset IDs only inside records they may see", async () => {
  const s = h.s;
  const items = new Map<string, Item>();
  const sceneItems = new Map<string, SceneItem>();
  let activeScene: string | null = null;

  s.records.register(
    defineRecordType<Item>({
      type: "leak-item",
      scope: "campaign",
      schema: Item,
      idOf: (r) => r.id,
      campaignOf: (r) => r.campaignId,
      visibility: (r) => (r.mode === "visible" ? "full" : r.mode),
      redact: (r) => ({ id: r.id, campaignId: r.campaignId, mode: r.mode }),
      snapshot: (_src, v) => [...items.values()].filter((r) => r.campaignId === v.campaignId),
    }),
  );
  s.records.register(
    defineRecordType<SceneItem>({
      type: "leak-scene-item",
      scope: "scene",
      schema: SceneItem,
      idOf: (r) => r.id,
      campaignOf: (r) => r.campaignId,
      sceneOf: (r) => r.sceneId,
      visibility: () => "full",
      snapshot: (_src, v) => [...sceneItems.values()].filter((r) => r.campaignId === v.campaignId),
    }),
  );
  s.records.provideActiveScene(() => activeScene, { replace: true });
  s.commands.registerEvent(LeakChanged);

  const setItem = defineCommand({
    name: "leak.setItem",
    input: z.object({ id: z.string(), mode: Mode, assetId: z.string() }),
    execute({ id, mode, assetId }, env) {
      requireAsset(env, assetId);
      const campaignId = env.actor.campaignId as string;
      const before = items.get(id) ?? null;
      const after: Item = { id, campaignId, mode, assetId };
      items.set(id, after);
      env.emit({
        type: LeakChanged.type,
        campaignId,
        payload: {},
        changes: [{ type: "leak-item", id, before, after }],
      });
    },
  });
  const setSceneItem = defineCommand({
    name: "leak.setSceneItem",
    input: z.object({ id: z.string(), sceneId: z.string(), assetId: z.string() }),
    execute({ id, sceneId, assetId }, env) {
      requireAsset(env, assetId);
      const campaignId = env.actor.campaignId as string;
      const before = sceneItems.get(id) ?? null;
      const after: SceneItem = { id, campaignId, sceneId, assetId };
      sceneItems.set(id, after);
      env.emit({
        type: LeakChanged.type,
        campaignId,
        payload: {},
        changes: [{ type: "leak-scene-item", id, before, after }],
      });
    },
  });
  s.commands.register(setItem as unknown as CommandDef);
  s.commands.register(setSceneItem as unknown as CommandDef);

  const dm = h.dmActor;
  const assetIds: string[] = [];
  const upload = async (seed: number) => {
    const r = await ingestAsset(
      s,
      { bytes: await testPng(seed), filename: `a${seed}.png` },
      { actor: dm },
    );
    assetIds.push(r.asset.id);
  };
  for (let i = 0; i < 4; i++) await upload(i);

  const players = [
    await h.live({ role: "player", token: h.p1.linkToken }),
    await h.live({ role: "player", token: h.p2.linkToken }),
  ];
  await h.live({ role: "dm", secret: TEST_SECRET });
  const cursors = players.map(() => 0);

  /** Asset IDs a player may hold right now (ground truth, independent of the server). */
  const allowed = () => {
    const out = new Set<string>();
    for (const r of items.values()) if (r.mode === "visible") out.add(r.assetId);
    for (const r of sceneItems.values()) if (r.sceneId === activeScene) out.add(r.assetId);
    return out;
  };
  const barrier = async (c: TestClient) => {
    // Frames are ordered on the socket: once the pong is in, the step's frames are too.
    c.send({ type: "ping" });
    await c.next("pong");
  };
  /** Asset IDs inside record data the frame delivers. */
  const inRecords = (f: ServerFrame): string[] => {
    const datas: unknown[] =
      f.type === "snapshot"
        ? Object.values(f.records).flat()
        : f.type === "event"
          ? f.changes.map((c) => c.data)
          : [];
    return datas.flatMap((d) => {
      const id = (d as { assetId?: unknown } | undefined)?.assetId;
      return typeof id === "string" ? [id] : [];
    });
  };

  let seenAny = 0;
  const check = async (step: string) => {
    const ok = allowed();
    for (const [pi, c] of players.entries()) {
      await barrier(c);
      const fresh = c.frames.slice(cursors[pi]);
      cursors[pi] = c.frames.length;
      for (const f of fresh) {
        const text = JSON.stringify(f);
        const carried = new Set(inRecords(f));
        for (const id of assetIds) {
          if (!text.includes(id)) continue;
          seenAny += 1;
          // Found by scan → must be a record field, and that record visible to the player now.
          expect({ step, id, inRecord: carried.has(id) }).toEqual({ step, id, inRecord: true });
          expect({ step, id, allowed: ok.has(id) }).toEqual({ step, id, allowed: true });
        }
      }
    }
  };

  const rand = rng(20261012);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)] as T;
  const modes = Mode.options;
  const scenes = ["scene-a", "scene-b", "scene-c"];
  for (let step = 0; step < 150; step++) {
    const op = rand();
    const label = `step ${step}`;
    if (op < 0.45) {
      s.commands.run(
        setItem,
        { id: `item-${Math.floor(rand() * 6)}`, mode: pick(modes), assetId: pick(assetIds) },
        { actor: dm },
      );
    } else if (op < 0.75) {
      s.commands.run(
        setSceneItem,
        { id: `sitem-${Math.floor(rand() * 4)}`, sceneId: pick(scenes), assetId: pick(assetIds) },
        { actor: dm },
      );
    } else if (op < 0.9) {
      // Scene switch: players resync (as scenes-map's activation does, FR-SYNC-11).
      activeScene = rand() < 0.2 ? null : pick(scenes);
      s.hub?.resync((c) => c.role === "player");
    } else {
      await upload(100 + step);
    }
    await check(label);
  }

  // Final convergence: each player's store holds exactly the allowed IDs.
  const ok = allowed();
  for (const c of players) {
    const held = new Set(
      Object.values(c.store.records)
        .flatMap((byId) => Object.values(byId))
        .flatMap((r) => {
          const id = (r as { assetId?: unknown }).assetId;
          return typeof id === "string" ? [id] : [];
        }),
    );
    expect([...held].sort()).toEqual([...ok].sort());
    expect(c.store.records.asset).toBeUndefined();
  }
  // The property was exercised, and some assets were never visible to anyone.
  expect(seenAny).toBeGreaterThan(10);
}, 30_000);

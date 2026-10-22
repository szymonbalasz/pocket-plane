// DICEX §12 sprint-8 CON-44 (TT0; ceilings DM 1.5 MiB since #256, players 512 KiB; never raised):
// the realistic-heavy harness on `session-sim`, then every table-tools row at its cap with
// max-length strings, written straight to the tables (the commands are TT1–TT4): 200 macros (one
// player holds 3 lists × 24 = 72), 5 open + 14 closed requests at 12 targets (the window keeps
// 10 closed), 60 pending prompts (12 PCs, 2 per player), the pause card + 4 sound picks, 50
// sounds. Per-type bounds from the spec (review A #1): in the DM frame `roll-macro` ≤ 76 KB,
// `roll-request` ≤ 72 KB, prompts ≤ 64 KB; no `roll-request` / `audio-asset` key in any player
// frame; `audio-asset` is lazy (0 B in every snapshot).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { library } from "@fixtures/index";
import {
  AUDIO_ASSET_TYPE,
  AUDIO_LIBRARY_CAP,
  AUDIO_MAX_BYTES,
} from "@shared/assets-pipeline/audio";
import { PAUSE_MESSAGE_MAX } from "@shared/campaign-management/table-state";
import { MACRO_NAME_MAX, MACROS_PER_CAMPAIGN, ROLL_MACRO_TYPE } from "@shared/dice-extras/macros";
import {
  CLOSED_REQUESTS_WINDOW,
  OPEN_REQUESTS_MAX,
  promptText,
  REQUEST_TARGETS_MAX,
  type RequestRoll,
  type RequestTarget,
  ROLL_REQUEST_KIND,
  ROLL_REQUEST_TYPE,
} from "@shared/dice-extras/requests";
import { LABEL_MAX } from "@shared/dice-roll-log/schemas";
import { ENTITY_NAME_MAX } from "@shared/entities/schemas";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { defineCommand } from "../../commands/commands";
import { asset, campaign, entity, player, rollMacro, rollRequest } from "../../db/schema";
import type { Actor } from "../../events/types";
import { loadInProcess } from "../../features/fixtures-adapters/loader";
import { notify } from "../../features/notifications/helpers";
import { SNAPSHOT_CEILING, snapshotTypeBytes } from "../hub";
import {
  buildRealisticHeavy,
  servicesFromBundle,
  snapshotFrames,
  snapshotSizes,
  type ViewerSize,
} from "./snapshot-size";

/** DICEX §12 (review A #1): per-type bounds in the DM frame. */
const MACROS_MAX = 76_000;
const REQUESTS_MAX = 72_000;
const PROMPTS_MAX = 64_000;
/** One player's worst: 72 macros + 10 prompts (+ the campaign fields), DICEX §12 +39,339 B. */
const PLAYER_MAX = 40_000;

const AT = "2026-10-21T20:00:00.000Z";
const x = (n: number, p = "") => (p + "x".repeat(n)).slice(0, n);
/** 59 chars, 6 dice terms (30 dice): the longest canonical notation FR-DICE-01 lets us store. */
const LONG_EXPR = Array(6).fill("5d1000kh5").join("+");
const LONG_ROLL: RequestRoll = { kind: "custom", key: null, expression: LONG_EXPR };

/** Prompts made through `notify` (validation, caps and seq as `dicex.request` will). */
const seedPrompts = defineCommand({
  name: "test.ttPrompts",
  input: z.strictObject({
    prompts: z.array(z.strictObject({ playerId: z.string(), payload: z.unknown() })),
  }),
  execute({ prompts }, env) {
    return prompts.map((p) =>
      notify(env, {
        kind: ROLL_REQUEST_KIND,
        audience: "player",
        audiencePlayerId: p.playerId,
        text: promptText(x(LABEL_MAX, "Label "), 40),
        payload: p.payload,
        action: { label: "Roll", role: "player", playerId: p.playerId },
      }),
    );
  },
});

describe("CON-44 table tools (DICEX §12 sprint 8, TT0)", () => {
  let b: Awaited<ReturnType<typeof servicesFromBundle>>;
  let before: ViewerSize[];
  let after: ViewerSize[];
  let promptBytes: number[];
  let loadBytes: number;
  let worstPlayer = "";
  beforeAll(async () => {
    b = await servicesFromBundle(await loadInProcess(library, "session-sim", { testMode: true }));
    buildRealisticHeavy(b.s);
    b.s.commands.register(seedPrompts);
    const db = b.s.db;
    const cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
    const dm: Actor = { role: "dm", playerId: null, campaignId: cid };
    before = snapshotSizes(b.s);
    const players = db.select().from(player).where(eq(player.campaignId, cid)).all();
    expect(players).toHaveLength(6);
    const pcs = db
      .select()
      .from(entity)
      .where(and(eq(entity.campaignId, cid), eq(entity.kind, "character")))
      .all()
      .filter((e) => e.ownerPlayerId !== null);
    const [p1] = players;
    if (!p1) throw new Error("no players");
    worstPlayer = p1.id;
    // 12 targets: 2 PCs per player (fabricated ids where the harness has fewer PCs).
    const targets = players.flatMap((p, i) =>
      [0, 1].map((k) => ({
        characterId: pcs.filter((c) => c.ownerPlayerId === p.id)[k]?.id ?? x(36, `pc${i}${k}-`),
        playerId: p.id,
      })),
    );
    expect(targets).toHaveLength(REQUEST_TARGETS_MAX);

    // Macros at the cap: player 1 holds 3 lists × 24 (Me + 2 PCs); the rest are the DM's.
    const lists: { playerId: string | null; creatureId: string | null }[] = [
      { playerId: p1.id, creatureId: null },
      { playerId: p1.id, creatureId: targets[0]?.characterId ?? null },
      { playerId: p1.id, creatureId: targets[1]?.characterId ?? null },
    ];
    for (let i = 0; lists.length * 24 < MACROS_PER_CAMPAIGN; i++) {
      lists.push({ playerId: null, creatureId: i === 0 ? null : x(36, `npc${i}-`) });
    }
    let n = 0;
    for (const list of lists) {
      for (let order = 0; order < 24 && n < MACROS_PER_CAMPAIGN; order++, n++) {
        db.insert(rollMacro)
          .values({
            id: x(36, `macro${n}-`),
            campaignId: cid,
            ...list,
            name: x(MACRO_NAME_MAX, `Macro ${n} `),
            expression: LONG_EXPR,
            category: "ability-check",
            order,
            createdBy: list.playerId,
            updatedAt: AT,
          })
          .run();
      }
    }

    // Prompts: 5 open requests × 12 targets, through `notify`.
    const notes: string[][] = [];
    for (let r = 0; r < OPEN_REQUESTS_MAX; r++) {
      notes.push(
        b.s.commands.run(
          seedPrompts,
          {
            prompts: targets.map((t) => ({
              playerId: t.playerId,
              payload: {
                requestId: x(36, `req${r}-`),
                characterId: t.characterId,
                characterName: x(ENTITY_NAME_MAX, "PC "),
                roll: LONG_ROLL,
                label: x(LABEL_MAX, "Label "),
                dc: 40,
                mode: "disadvantage",
              },
            })),
          },
          { actor: dm },
        ) as string[],
      );
    }

    // Requests: 5 open (targets waiting) + 14 closed (answered); the window keeps 10 closed.
    const target = (t: (typeof targets)[number], note: string, open: boolean): RequestTarget => ({
      characterId: t.characterId,
      playerId: t.playerId,
      name: x(ENTITY_NAME_MAX, "PC "),
      notificationId: note,
      state: open ? "open" : "declined",
      entryId: open ? null : x(36, "entry-"),
      total: open ? null : -9999,
      natural: open ? null : 20,
      success: open ? null : false,
      at: open ? null : AT,
    });
    for (let r = 0; r < OPEN_REQUESTS_MAX + CLOSED_REQUESTS_WINDOW + 4; r++) {
      const open = r < OPEN_REQUESTS_MAX;
      db.insert(rollRequest)
        .values({
          id: x(36, `req${r}-`),
          campaignId: cid,
          seq: open ? 1000 + r : r + 1,
          roll: LONG_ROLL,
          label: x(LABEL_MAX, "Label "),
          dc: 40,
          dcShown: false,
          mode: "disadvantage",
          results: "public",
          state: open ? "open" : "closed",
          targets: targets.map((t, i) => target(t, notes[r]?.[i] ?? x(36, "note-"), open)),
          createdAt: AT,
          closedAt: open ? null : AT,
        })
        .run();
    }

    // Pause card + 4 sound picks on the campaign row; 50 sounds in the library.
    db.update(campaign)
      .set({
        pause: {
          message: x(PAUSE_MESSAGE_MAX, "Pizza break "),
          imageAssetId: x(22, "img"),
          backAt: AT,
          startedAt: AT,
        },
        alertSounds: { turn: x(22, "a"), request: x(22, "b"), pause: x(22, "c"), resume: "none" },
      })
      .where(eq(campaign.id, cid))
      .run();
    for (let i = 0; i < AUDIO_LIBRARY_CAP; i++) {
      db.insert(asset)
        .values({
          id: x(22, `snd${i}`),
          campaignId: cid,
          seq: 100_000 + i,
          name: x(80, `Sound ${i} `),
          hash: x(64, `hash${i}`),
          mime: "audio/mpeg",
          bytes: AUDIO_MAX_BYTES,
          width: 0,
          height: 0,
          displayWidth: 0,
          displayHeight: 0,
          createdAt: AT,
          tags: [],
          kind: "audio",
          durationMs: 5000,
        })
        .run();
    }

    after = snapshotSizes(b.s);
    promptBytes = snapshotFrames(b.s).map(({ records }) => {
      const prompts = ((records.notification ?? []) as { kind: string; state: string }[]).filter(
        (r) => r.kind === ROLL_REQUEST_KIND && r.state === "pending",
      );
      return snapshotTypeBytes({ p: prompts })[0]?.[1] ?? 0;
    });
    const dmViewer = snapshotFrames(b.s)[0]?.viewer;
    if (!dmViewer) throw new Error("no DM viewer");
    loadBytes = Buffer.byteLength(
      JSON.stringify(
        b.s.records.load({ db, presence: { list: () => [] } }, dmViewer, AUDIO_ASSET_TYPE),
      ),
    );
  }, 180_000);
  afterAll(() => b.cleanup());

  test("FR-DICEX-93 CON-44 table tools at the caps: ceilings hold; DM roll-macro ≤ 76 KB, roll-request ≤ 72 KB, prompts ≤ 64 KB", () => {
    const [dm, ...players] = after;
    if (!dm) throw new Error("no DM frame");
    const deltas = after.map((v, i) => v.bytes - (before[i]?.bytes ?? 0));
    const macros = dm.types[ROLL_MACRO_TYPE];
    const requests = dm.types[ROLL_REQUEST_TYPE];
    console.log(
      `TT CON-44: DM ${before[0]?.bytes} → ${dm.bytes} B (+${deltas[0]}; ${SNAPSHOT_CEILING.dm - dm.bytes} B left); roll-macro ${macros?.bytes} B (${macros?.rows}), roll-request ${requests?.bytes} B (${requests?.rows}), prompts ${promptBytes[0]} B; players max ${Math.max(...players.map((p) => p.bytes))} B (+${Math.min(...deltas.slice(1))}…+${Math.max(...deltas.slice(1))}), prompts ≤ ${Math.max(...promptBytes.slice(1))} B; audio-asset load of ${AUDIO_LIBRARY_CAP} = ${loadBytes} B`,
    );
    expect(dm.bytes).toBeLessThan(SNAPSHOT_CEILING.dm);
    for (const p of players) expect(p.bytes).toBeLessThan(SNAPSHOT_CEILING.player);
    expect(macros?.rows).toBe(MACROS_PER_CAMPAIGN);
    expect(macros?.bytes ?? Infinity).toBeLessThanOrEqual(MACROS_MAX);
    // FR-DICEX-73: open pinned + the newest 10 closed.
    expect(requests?.rows).toBe(OPEN_REQUESTS_MAX + CLOSED_REQUESTS_WINDOW);
    expect(requests?.bytes ?? Infinity).toBeLessThanOrEqual(REQUESTS_MAX);
    expect(promptBytes[0] ?? Infinity).toBeLessThanOrEqual(PROMPTS_MAX);
    for (const d of deltas.slice(1)) expect(d).toBeLessThanOrEqual(PLAYER_MAX);
  });

  test("FR-DICEX-92 FR-ASSET-57 no roll-request / audio-asset in a player frame; macros and prompts per player", () => {
    const frames = snapshotFrames(b.s);
    for (const f of frames) {
      expect(Object.keys(f.records)).not.toContain(AUDIO_ASSET_TYPE);
      if (f.viewer.role === "dm") continue;
      expect(Object.keys(f.records)).not.toContain(ROLL_REQUEST_TYPE);
      const macros = (f.records[ROLL_MACRO_TYPE] ?? []) as { playerId: string | null }[];
      expect(macros.every((m) => m.playerId === f.viewer.playerId)).toBe(true);
      expect(macros).toHaveLength(f.viewer.playerId === worstPlayer ? 72 : 0);
      const prompts = (
        (f.records.notification ?? []) as { kind: string; audiencePlayerId: string | null }[]
      ).filter((r) => r.kind === ROLL_REQUEST_KIND);
      expect(prompts).toHaveLength(2 * OPEN_REQUESTS_MAX);
      expect(prompts.every((r) => r.audiencePlayerId === f.viewer.playerId)).toBe(true);
    }
  });

  test("FR-ASSET-61 sounds add 0 B to every snapshot; FR-CAMP-50 pause + picks reach every viewer", () => {
    const frames = snapshotFrames(b.s);
    for (const f of frames) {
      const assets = (f.records.asset ?? []) as { id: string }[];
      expect(assets.some((a) => a.id.startsWith("snd"))).toBe(false);
      const [camp] = f.records.campaign as { pause?: unknown; alertSounds?: unknown }[];
      expect(camp?.pause).toBeDefined();
      expect(camp?.alertSounds).toBeDefined();
    }
    // The library is only a load (DICEX §12: 50 sounds ≈ 13.8 KB); far under one frame.
    expect(loadBytes).toBeLessThan(20_000);
  });
});

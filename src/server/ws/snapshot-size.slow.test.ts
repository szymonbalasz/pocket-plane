// CON-44 snapshot ceilings + live-sync §12 build time (#163): session-sim and a "realistic
// heavy" session built through commands. DM ≤ 768 KiB, players ≤ 512 KiB (the < 200 ms DM build
// is timed in ./snapshot-build.bench.ts).
// Worst-case rows per core (seams S14): PARTY S5 adds an open `handout-present` for every player;
// CMP S5 (track C) 20 homebrew entries × 4 attachment images (0 B); CAMP S5 (track K) the
// longest colour key on every player + the DM, every notification stamped by a player; CBT S6
// (track CP) 24 owned combatants with max cards and 18 present pets.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { EFFECT_TYPE, TEMP_HP_MAX } from "@shared/combat-extras/schemas";
import {
  COMBATANT_TYPE,
  ENCOUNTER_ENTRY_TYPE,
  HIT_RULING_TYPE,
} from "@shared/combat-tracker/schemas";
import { GAME_LOG_WINDOW } from "@shared/dice-roll-log/schemas";
import { EFFECT_PRESET_TYPE } from "@shared/effect-modifiers/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { CHARACTER_GEMS_TYPE } from "@shared/gems/schemas";
import { HANDOUT_PRESENT_TYPE } from "@shared/party-board/schemas";
import {
  AOE_TEMPLATE_TYPE,
  MAP_SETTINGS_TYPE,
  SCENE_PROP_TYPE,
  SCENE_STRUCTURE_TYPE,
} from "@shared/scene-tools/schemas";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { INGEST, type IngestResult } from "../features/assets-pipeline/commands";
import { processImage } from "../features/assets-pipeline/image";
import { testPng } from "../features/assets-pipeline/testing";
import { setFeature } from "../features/campaign-management/features";
import { PUT_ENTRY } from "../features/compendium/homebrew";
import { writeWorstPresents } from "../features/party-board/testing";
import { SNAPSHOT_CEILING } from "./hub";
import {
  buildRealisticHeavy,
  CREATURE_SHEET_TYPE,
  fillSceneToCap,
  HEAVY,
  SCENE_TOKEN_CAP,
  sceneLoadSizes,
  servicesFromBundle,
  snapshotFrames,
  snapshotSizes,
  type ViewerSize,
} from "./testing/snapshot-size";

/** ADR-0041: a `sync.loadScene` result stays under the player ceiling (512 KiB). */
const SCENE_LOAD_MAX = 512 * 1024;
const sessionSim = async () =>
  servicesFromBundle(await loadBundle("session-sim", { testMode: true }));

function expectUnderCeilings(sizes: ViewerSize[]) {
  for (const v of sizes) {
    const ceiling = v.role === "dm" ? SNAPSHOT_CEILING.dm : SNAPSHOT_CEILING.player;
    expect({ viewer: v.label, over: v.bytes > ceiling }).toEqual({ viewer: v.label, over: false });
  }
}

/** session-sim's own sheets (CHARX §13): `char-mira-full` (Player 1) + `npc-elite-sheet` (DM). */
const SIM_SHEETS = 2;

describe("CON-44 snapshot ceilings (#163)", () => {
  test("session-sim: every viewer under its ceiling", async () => {
    const b = await sessionSim();
    try {
      const sizes = snapshotSizes(b.s);
      expect(sizes.map((v) => v.label)).toEqual(["DM", "P1", "P2"]);
      expectUnderCeilings(sizes);
      // ADR-0041: the DM gets the active scene's tokens; the inactive scene's load on view.
      const [dm, ...players] = sizes;
      const loads = sceneLoadSizes(b.s);
      expect(loads).toHaveLength(2);
      const loadedTokens = loads.map((l) => l.rows[TOKEN_TYPE] ?? 0);
      expect(loadedTokens).toContain(dm?.types[TOKEN_TYPE]?.rows ?? -1);
      expect(dm?.types[TOKEN_TYPE]?.rows).toBeLessThan(loadedTokens.reduce((a, n) => a + n, 0));
      for (const p of players) expect(p.types[TOKEN_TYPE]?.rows).toBe(dm?.types[TOKEN_TYPE]?.rows);
    } finally {
      b.cleanup();
    }
  }, 30_000);

  describe("realistic heavy", () => {
    let b: Awaited<ReturnType<typeof sessionSim>>;
    let counts: Record<string, number>;
    let presents: number;
    beforeAll(async () => {
      b = await sessionSim();
      counts = buildRealisticHeavy(b.s);
      const cid = b.s.db.$client
        .query<{ id: string }, []>("SELECT id FROM campaign WHERE active = 1")
        .get()?.id as string;
      presents = writeWorstPresents(b.s.db, cid);
    }, 60_000);
    afterAll(() => b.cleanup());

    test("scenario shape: 6 players, 30 scenes, 300 tokens, 20 encounters, 100 log, 20 pending, 100 loot", () => {
      expect(counts).toMatchObject({
        players: HEAVY.players,
        scenes: HEAVY.scenes,
        tokens: HEAVY.tokens,
        encounters: HEAVY.encounters,
        pendingCards: HEAVY.pendingCards,
        sheets: HEAVY.sheets + SIM_SHEETS,
        effects: HEAVY.effects,
        modEffects: HEAVY.modEffects,
        presets: HEAVY.campaignPresets + HEAVY.characterPresets,
      });
      // Applied cards add one line per target; session-sim brings its own loot.
      expect(counts.logEntries).toBeGreaterThanOrEqual(HEAVY.logEntries);
      expect(counts.loot).toBeGreaterThanOrEqual(HEAVY.loot);
    });

    test("CON-44 (#208) DM < 1 MiB, every player < 512 KiB", () => {
      const sizes = snapshotSizes(b.s);
      expect(sizes).toHaveLength(1 + HEAVY.players);
      expectUnderCeilings(sizes);
    });

    test("PARTY S5 FR-PARTY-31 worst case: an open handout-present per player; DM all rows, each player only its own; ceilings hold", () => {
      const sizes = snapshotSizes(b.s);
      expect(presents).toBe(HEAVY.players);
      const [dm, ...players] = sizes as [ViewerSize, ...ViewerSize[]];
      expect(dm.types[HANDOUT_PRESENT_TYPE]?.rows).toBe(HEAVY.players);
      for (const p of players) expect(p.types[HANDOUT_PRESENT_TYPE]?.rows).toBe(1);
      // PARTY §12 S5 measured +1,517 B DM at 6 rows, +267 B per player (≈ 250 B a row).
      expect(dm.types[HANDOUT_PRESENT_TYPE]?.bytes ?? Infinity).toBeLessThan(HEAVY.players * 270);
      for (const p of players)
        expect(p.types[HANDOUT_PRESENT_TYPE]?.bytes ?? Infinity).toBeLessThan(300);
      for (const f of snapshotFrames(b.s).filter((x) => x.viewer.role === "player")) {
        const own = (f.records[HANDOUT_PRESENT_TYPE] ?? []) as { playerId: string }[];
        expect(own.map((r) => r.playerId)).toEqual([f.viewer.playerId as string]);
      }
      expectUnderCeilings(sizes);
      console.log(
        `PARTY S5 handout-present worst case: DM ${dm.types[HANDOUT_PRESENT_TYPE]?.bytes} B (${HEAVY.players} rows), player ${players[0]?.types[HANDOUT_PRESENT_TYPE]?.bytes} B; heavy DM ${dm.bytes} B, ${SNAPSHOT_CEILING.dm - dm.bytes} B left of 1.5 MiB; players max ${Math.max(...players.map((p) => p.bytes))} B`,
      );
    });

    test("ADR-0041 DM token window: the active scene's 60 tokens only; largest scene load < 512 KiB", () => {
      const sizes = snapshotSizes(b.s);
      // Measured: 781,930 B with every token → 663,699 B (−118,231 B, the 240 non-active ones).
      expect(sizes.map((v) => v.types[TOKEN_TYPE]?.rows)).toEqual(
        Array(1 + HEAVY.players).fill(HEAVY.activeSceneTokens),
      );
      // #208: no headroom guard; the ceiling itself is asserted in the test above.
      const loads = sceneLoadSizes(b.s);
      expect(loads).toHaveLength(HEAVY.scenes);
      expect(loads.reduce((n, l) => n + (l.rows[TOKEN_TYPE] ?? 0), 0)).toBe(HEAVY.tokens);
      expect(loads[0]?.bytes).toBeLessThan(SCENE_LOAD_MAX);
    });

    test("SCN §12 one typical prepped active scene: DM all rows, players doors / visible only; ≈ 7.4 KB DM; ceilings hold", () => {
      const sizes = snapshotSizes(b.s);
      const scn = [SCENE_STRUCTURE_TYPE, SCENE_PROP_TYPE, AOE_TEMPLATE_TYPE, MAP_SETTINGS_TYPE];
      const rows = (v: ViewerSize) => scn.map((t) => v.types[t]?.rows ?? 0);
      const bytes = (v: ViewerSize) => scn.reduce((n, t) => n + (v.types[t]?.bytes ?? 0), 0);
      const [dm, ...players] = sizes as [ViewerSize, ...ViewerSize[]];
      expect(rows(dm)).toEqual([1, HEAVY.scnProps, HEAVY.scnTemplates, 1]);
      for (const p of players) {
        expect(rows(p)).toEqual([
          1,
          HEAVY.scnProps - HEAVY.scnHiddenProps,
          HEAVY.scnTemplates - HEAVY.scnHiddenTemplates,
          1,
        ]);
      }
      // SCN §12 measured the prototype rows at 7,384 B (DM); players ≈ 3.6 KB per scene.
      expect(bytes(dm)).toBeLessThan(9_000);
      for (const p of players) expect(bytes(p)).toBeLessThan(4_500);
      console.log(
        `SCN typical scene: DM ${bytes(dm)} B (${scn.map((t) => `${t} ${dm.types[t]?.bytes}`).join(", ")}); P1 ${bytes(players[0] as ViewerSize)} B; heavy DM ${dm.bytes} B, players ${Math.min(...players.map((p) => p.bytes))}–${Math.max(...players.map((p) => p.bytes))} B`,
      );
      expectUnderCeilings(sizes);
      // The scene loads carry the active scene's SCN rows too (ADR-0041).
      const battle = sceneLoadSizes(b.s).find((l) => (l.rows[SCENE_PROP_TYPE] ?? 0) > 0);
      expect(battle?.rows[SCENE_STRUCTURE_TYPE]).toBe(1);
      expect(battle?.rows[AOE_TEMPLATE_TYPE]).toBe(HEAVY.scnTemplates);
    });

    test("CHARX §12 creature-sheet rows: DM all 16 + session-sim's 2, each player only their own; ceilings hold", () => {
      const sizes = snapshotSizes(b.s);
      const sheets = sizes.map((v) => v.types[CREATURE_SHEET_TYPE]);
      // Player 1 also owns session-sim's Mira (char-mira-full); the Elite NPC sheet is DM-only.
      const [dmRows, ...playerRows] = sheets.map((t) => t?.rows ?? 0);
      expect(dmRows).toBe(HEAVY.sheets + SIM_SHEETS);
      expect(playerRows.sort()).toEqual([1, 1, 1, 1, 1, 2]);
      // Typical size (CHARX §12: 5–15 KB per sheet).
      const dm = sheets[0];
      const perSheet = (dm?.bytes ?? 0) / (HEAVY.sheets + SIM_SHEETS);
      expect(perSheet).toBeGreaterThan(5_000);
      expect(perSheet).toBeLessThan(15_000);
      expectUnderCeilings(sizes);
    });

    test("CBTX §12 effect rows: DM every active one, players the non-secret non-hidden ones; ceilings hold", () => {
      const sizes = snapshotSizes(b.s);
      const fx = sizes.map((v) => v.types[EFFECT_TYPE]);
      expect(fx.map((t) => t?.rows)).toEqual([
        HEAVY.effects,
        ...Array(HEAVY.players).fill(HEAVY.playerEffects),
      ]);
      // Per effect with max-length label / source name and UUID ids: ≈ 700 B DM, ≈ 280 B player
      // (CBTX §12 estimated 300 / 200 B with short strings).
      expect((fx[0]?.bytes ?? 0) / HEAVY.effects).toBeLessThan(800);
      expect((fx[1]?.bytes ?? 0) / HEAVY.playerEffects).toBeLessThan(400);
      expectUnderCeilings(sizes);
    });

    test("MOD §12 effect-preset rows + effect modifiers: DM all 16 presets, each player own 1; ceilings hold", () => {
      const sizes = snapshotSizes(b.s);
      const presets = sizes.map((v) => v.types[EFFECT_PRESET_TYPE]);
      expect(presets.map((t) => t?.rows ?? 0)).toEqual([
        HEAVY.campaignPresets + HEAVY.characterPresets,
        ...Array(HEAVY.players).fill(1),
      ]);
      // Per preset at max length (UUID ids, 6 longest modifiers, 200-char note): ≈ 1.15 KB
      // (MOD §12 estimated ≤ 720 B with compact keys).
      const perPreset = (presets[0]?.bytes ?? 0) / (HEAVY.campaignPresets + HEAVY.characterPresets);
      expect(perPreset).toBeLessThan(1_200);
      // Modifiers add ≤ 2 × 140 B to the 12 custom effects that carry them.
      const fx = sizes[0]?.types[EFFECT_TYPE];
      expect((fx?.bytes ?? 0) / HEAVY.effects).toBeLessThan(900);
      expectUnderCeilings(sizes);
    });

    test("FR-MOD-21/22 leak scan: no monster-effect modifiers, preset ids or other presets in player frames", () => {
      const presetIds = new Set<string>();
      for (const f of snapshotFrames(b.s)) {
        if (f.viewer.role !== "dm") continue;
        for (const p of (f.records[EFFECT_PRESET_TYPE] ?? []) as { id: string }[]) {
          presetIds.add(p.id);
        }
      }
      for (const f of snapshotFrames(b.s).filter((x) => x.viewer.role === "player")) {
        for (const e of (f.records[EFFECT_TYPE] ?? []) as Record<string, unknown>[]) {
          if (e.targetCombatantId !== null) {
            expect(Object.keys(e)).not.toContain("modifiers");
            expect(Object.keys(e)).not.toContain("presetKey");
          } else {
            expect(Array.isArray(e.modifiers)).toBe(true);
            expect([null, "hunters-mark"]).toContain(e.presetKey as string | null);
          }
        }
        const own = (f.records[EFFECT_PRESET_TYPE] ?? []) as Record<string, unknown>[];
        expect(own.map((p) => p.ownerPlayerId)).toEqual([f.viewer.playerId]);
        expect(own.every((p) => p.characterId !== null)).toBe(true);
        const fx = JSON.stringify(f.records[EFFECT_TYPE] ?? []);
        // The 6 PC "Bless" effects carry theirs; no monster effect's reaches a player.
        expect(fx.match(/"modifiers":\[\{/g)).toHaveLength(HEAVY.pcModEffects);
        expect(fx).not.toContain("preset-hex-");
        for (const id of presetIds) expect(fx).not.toContain(id);
      }
    });

    test("FR-CBTX-31/32 leak scan: no player frame has combatant tempHp, others' counters, effect links", () => {
      for (const f of snapshotFrames(b.s).filter((x) => x.viewer.role === "player")) {
        for (const c of (f.records[COMBATANT_TYPE] ?? []) as Record<string, unknown>[]) {
          expect(Object.keys(c)).not.toContain("tempHp");
        }
        for (const e of (f.records[ENTITY_TYPE] ?? []) as Record<string, unknown>[]) {
          if (e.ownerPlayerId === f.viewer.playerId) continue;
          // ADR-0063 (FR-PARTY-52): another player's PC carries HP / temp HP / AC; never counters.
          const banned =
            e.kind === "character"
              ? ["deathSuccesses", "deathFailures"]
              : ["tempHp", "deathSuccesses", "deathFailures", "hpCurrent"];
          for (const k of banned) expect(Object.keys(e)).not.toContain(k);
          expect(Object.keys(e)).toContain("deathState");
        }
        const fx = JSON.stringify(f.records[EFFECT_TYPE] ?? []);
        for (const leak of ["sourceCombatantId", "anchorCombatantId", "concentrationId", "Hex "]) {
          expect(fx).not.toContain(leak);
        }
      }
    });

    // ADR-0063 measured players +343 B (7 other PCs × 49 B at worst-width figures), DM 0 B.
    test("FR-PARTY-57 CON-44 combat polish: other PCs' HP / temp HP / AC at worst width → players ≤ +343 B, DM 0 B; ceilings hold", () => {
      const PARTY_KEYS = ["hpCurrent", "hpMax", "tempHp", "ac"];
      const worst = { hpCurrent: 999, hpMax: 999, tempHp: TEMP_HP_MAX, ac: 30 };
      const len = (o: unknown) => Buffer.byteLength(JSON.stringify(o), "utf8");
      const sizes = snapshotSizes(b.s);
      const growth = new Map<string, number>();
      for (const f of snapshotFrames(b.s)) {
        let added = 0;
        for (const e of (f.records[ENTITY_TYPE] ?? []) as Record<string, unknown>[]) {
          if (e.kind !== "character") continue;
          if (f.viewer.role === "dm" || e.ownerPlayerId === f.viewer.playerId) {
            // Full rows held these fields before ADR-0063: nothing new.
            expect(Object.keys(e)).toContain("statBlock");
            continue;
          }
          for (const k of PARTY_KEYS) expect(Object.keys(e)).toContain(k);
          const without = Object.fromEntries(
            Object.entries(e).filter(([k]) => !PARTY_KEYS.includes(k)),
          );
          added += len({ ...without, ...worst }) - len(without);
        }
        growth.set(f.label, added);
      }
      expect(growth.get("DM")).toBe(0);
      const players = sizes.filter((v) => v.role === "player");
      for (const p of players) expect(growth.get(p.label) ?? Infinity).toBeLessThanOrEqual(343);
      // The worst player with the worst-width figures stays under 512 KiB.
      const worstPlayer = Math.max(...players.map((p) => p.bytes + (growth.get(p.label) ?? 0)));
      expect(worstPlayer).toBeLessThan(SNAPSHOT_CEILING.player);
      expectUnderCeilings(sizes);
      console.log(
        `PARTY S8 party status: players +${Math.max(...players.map((p) => growth.get(p.label) ?? 0))} B at worst width; worst player ${worstPlayer} B of ${SNAPSHOT_CEILING.player}; DM +0 B`,
      );
    });

    test("SQL windows: providers return the window, not the history (build time: snapshot-build.bench.ts)", () => {
      const cid = b.s.db.$client
        .query<{ id: string }, []>("SELECT id FROM campaign WHERE active = 1")
        .get()?.id;
      const dm = { role: "dm" as const, playerId: null, campaignId: cid as string };
      for (let i = 0; i < 300; i++) {
        b.s.commands.run(
          "dice.roll",
          { expression: "1d20", mode: "normal", category: "damage" },
          { actor: dm },
        );
      }
      const v = { connId: "dm", campaignId: cid as string, role: "dm" as const, playerId: null };
      const src = { db: b.s.db, presence: { list: () => [] } };
      expect(b.s.records.get("game-log-entry")?.snapshot(src, v)).toHaveLength(GAME_LOG_WINDOW);
    });

    // Adds compendium rows and attachments only (no record type): every snapshot byte-identical.
    test("FR-CMP-53 CON-44 entry images 0 B: 20 homebrew entries × 4 attachment images (half shared) → every viewer +0 B; ceilings hold", async () => {
      const cid = b.s.db.$client
        .query<{ id: string }, []>("SELECT id FROM campaign WHERE active = 1")
        .get()?.id as string;
      const actor = { role: "dm" as const, playerId: null, campaignId: cid };
      const before = snapshotSizes(b.s);
      const text = "A lantern of blackened silver that sheds moonlight. "
        .repeat(20)
        .slice(0, 1_040);
      for (let e = 0; e < 20; e++) {
        const imageAssetIds: string[] = [];
        for (let i = 0; i < 4; i++) {
          const image = await processImage(await testPng(1_000 + e * 4 + i));
          const r = b.s.commands.run(
            INGEST,
            { image, filename: `${"entry-image-".repeat(6)}${e}-${i}.png`, listed: false },
            { actor },
          ) as IngestResult;
          imageAssetIds.push(r.asset.id);
        }
        b.s.commands.run(
          PUT_ENTRY,
          {
            entry: {
              kind: "item",
              name: `CON-44 Item ${e}`,
              facets: { category: "magic", rarity: "rare", attunement: false },
              body: { typeLine: "Wondrous item", text },
            },
            shared: e % 2 === 0,
            imageAssetIds,
          },
          { actor },
        );
      }
      const rows = b.s.db.$client
        .query<{ n: number }, []>(
          "SELECT count(*) AS n FROM compendium_entry WHERE json_array_length(image_asset_ids) = 4",
        )
        .get();
      expect(rows?.n).toBe(20);
      const after = snapshotSizes(b.s);
      expect(after.map((v) => [v.label, v.bytes])).toEqual(before.map((v) => [v.label, v.bytes]));
      expectUnderCeilings(after);
      const [dm, ...players] = after as [ViewerSize, ...ViewerSize[]];
      console.log(
        `CMP S5 entry images: 20 entries × 4 attachments, every viewer +0 B; heavy DM ${dm.bytes} B (${SNAPSHOT_CEILING.dm - dm.bytes} B left of 1.5 MiB); players max ${Math.max(...players.map((p) => p.bytes))} B`,
      );
    }, 60_000);

    // Mutates the scenario and keeps it (seams S14): the later worst cases measure on top.
    test("CON-44 colours (K0, FR-CAMP-29, FR-NOTE-38) worst case: `vermillion` on every player + the DM, every notification stamped by a player; colours ≤ 160 B per viewer, stamp ≤ 70 B per row; ceilings hold", () => {
      const sql = b.s.db.$client;
      const pids = sql
        .query<{ id: string }, []>("SELECT id FROM player ORDER BY length(id) DESC, id")
        .all();
      const longest = pids[0]?.id as string;
      // Without the sprint-5 fields: the frame as sprint 4 sent it (`color`, `dmColor`, stamp off).
      const strip = (fields: Record<string, readonly string[]>) =>
        snapshotFrames(b.s).map(({ viewer: v, records }) => {
          const out: Record<string, unknown[]> = {};
          for (const [type, rows] of Object.entries(records)) {
            const drop = fields[type];
            out[type] = drop
              ? rows.map((r) =>
                  Object.fromEntries(
                    Object.entries(r as Record<string, unknown>).filter(([k]) => !drop.includes(k)),
                  ),
                )
              : rows;
          }
          const you = { campaignId: v.campaignId, role: v.role, playerId: v.playerId };
          return Buffer.byteLength(JSON.stringify({ type: "snapshot", seq: 0, you, records: out }));
        });
      sql.run("UPDATE player SET color = 'vermillion'");
      sql.run("UPDATE campaign SET dm_color = 'vermillion'");
      sql.query("UPDATE notification SET by_role = 'player', by_player_id = ?").run(longest);
      const sizes = snapshotSizes(b.s);
      const none = strip({
        player: ["color"],
        campaign: ["dmColor"],
        notification: ["byRole", "byPlayerId"],
      });
      const noStamp = strip({ notification: ["byRole", "byPlayerId"] });
      expectUnderCeilings(sizes);
      const rows = sizes.map((v) => v.types.notification?.rows ?? 0);
      for (const [i, v] of sizes.entries()) {
        const colours = (noStamp[i] as number) - (none[i] as number);
        const stamp = v.bytes - (noStamp[i] as number);
        // CAMP §12: +149 B (7 player rows + the campaign row) at the worst key.
        expect({ viewer: v.label, ok: colours > 0 && colours <= 160 }).toEqual({
          viewer: v.label,
          ok: true,
        });
        // NOTE §12: `,"byRole":"player","byPlayerId":"<36-char id>"` = 70 B a row.
        expect(stamp).toBeLessThanOrEqual(70 * (rows[i] as number));
        expect(stamp).toBeGreaterThan(0);
      }
      // Players: only rows they may see carry the stamp (FR-NOTE-06 unchanged).
      expect(Math.max(...rows.slice(1))).toBeLessThan(rows[0] as number);
      const [dm, ...players] = sizes as [ViewerSize, ...ViewerSize[]];
      console.log(
        `CAMP S5 colours CON-44: colours +${(noStamp[0] as number) - (none[0] as number)} B DM, +${Math.min(...players.map((_, i) => (noStamp[i + 1] as number) - (none[i + 1] as number)))}–${Math.max(...players.map((_, i) => (noStamp[i + 1] as number) - (none[i + 1] as number)))} B players; NOTE stamp +${dm.bytes - (noStamp[0] as number)} B DM (${rows[0]} rows), +${Math.min(...players.map((p, i) => p.bytes - (noStamp[i + 1] as number)))}–${Math.max(...players.map((p, i) => p.bytes - (noStamp[i + 1] as number)))} B players; heavy DM ${dm.bytes} B (${SNAPSHOT_CEILING.dm - dm.bytes} B left of 1.5 MiB); players max ${Math.max(...players.map((p) => p.bytes))} B`,
      );
    });

    // Mutates the scenario, then restores it: after the read-only cases.
    test("CBT §12 sprint 5 (track R) worst case: 20 rulings × 20 targets, 3 unused rolls per card, 60 trails at the cap, side + publicSide everywhere; ceilings hold", () => {
      const sql = b.s.db.$client;
      const enc = sql
        .query<{ id: string; cid: string; scene: string }, []>(
          "SELECT id, campaign_id AS cid, scene_id AS scene FROM encounter WHERE status = 'started'",
        )
        .get();
      if (!enc) throw new Error("no started encounter");
      const before = snapshotSizes(b.s);
      const typeBytes = (v: ViewerSize, t: string) => v.types[t]?.bytes ?? 0;
      // (1) One hit ruling per pending card, 20 targets each (FR-CBT-88; the max).
      const cards = sql
        .query<{ id: string }, [string]>(
          "SELECT id FROM notification WHERE kind = 'damage-card' AND state = 'pending' AND json_extract(payload, '$.encounterId') = ?",
        )
        .all(enc.id);
      expect(cards).toHaveLength(HEAVY.pendingCards);
      const targetIds = sql
        .query<{ id: string }, [string]>("SELECT id FROM combatant WHERE encounter_id = ? LIMIT 20")
        .all(enc.id)
        .map((r) => r.id);
      const targets = JSON.stringify(
        targetIds.map((targetId) => ({ targetId, hit: true, multiplier: "double" })),
      );
      const insert = sql.query(
        "INSERT INTO hit_ruling (id, campaign_id, encounter_id, card_id, to_hit_total, to_hit_set, targets, created_at) VALUES (?, ?, ?, ?, -20, 1, ?, '2026-10-19T00:00:00.000Z')",
      );
      for (const [i, c] of cards.entries()) {
        insert.run(`ruling-${String(i).padStart(29, "0")}`, enc.cid, enc.id, c.id, targets);
      }
      const ruled = snapshotSizes(b.s);
      // (2) 3 unused rolls on every damage card (FR-CBT-92): UUID ids, 3-digit totals.
      const unused = JSON.stringify(
        [1, 2, 3].map((i) => ({ rollId: `unused-${i}`.padEnd(36, "0"), total: 999 })),
      );
      sql.run(
        `UPDATE notification SET payload = json_set(payload, '$.unusedRolls', json('${unused}')) WHERE kind = 'damage-card'`,
      );
      const withUnused = snapshotSizes(b.s);
      // (3) Every active-scene token at the 20-segment cap (FR-MAP-65): 21 three-digit cells.
      const trail = JSON.stringify({
        cells: Array.from({ length: 21 }, (_, i) => [100 + i, 200 + i]),
      });
      sql.query("UPDATE token SET trail = ? WHERE scene_id = ?").run(trail, enc.scene);
      const trailed = snapshotSizes(b.s);
      // (4) Side + publicSide on every combatant, side on every entry (#252; entries default).
      sql.run("UPDATE combatant SET side = 'enemy', public_side = 'enemy'");
      const sided = snapshotSizes(b.s);
      try {
        expectUnderCeilings(sided);
        const [dm0, ...p0] = before as [ViewerSize, ...ViewerSize[]];
        const [dm1, ...p1] = ruled as [ViewerSize, ...ViewerSize[]];
        // CBT §12: one ruling ≈ 2 KB, 20 ≈ 40 KB, DM only.
        expect(dm1.types[HIT_RULING_TYPE]?.rows).toBe(HEAVY.pendingCards);
        expect(dm1.bytes - dm0.bytes).toBeLessThan(42_000);
        for (const [i, v] of p1.entries()) expect(v.bytes).toBe((p0[i] as ViewerSize).bytes);
        const dUnused = (withUnused[0]?.bytes ?? 0) - dm1.bytes;
        const dTrail = (trailed[0]?.bytes ?? 0) - (withUnused[0]?.bytes ?? 0);
        const dSide = (sided[0]?.bytes ?? 0) - (trailed[0]?.bytes ?? 0);
        // Entries already carry `side` (NOT NULL default); combatants gain two values.
        expect(sided[0]?.types[ENCOUNTER_ENTRY_TYPE]?.rows).toBeGreaterThan(0);
        expect(dUnused).toBeLessThan(10_000);
        expect(dTrail).toBeLessThan(16_000);
        expect(dSide).toBeLessThan(4_000);
        const pTrail = trailed.slice(1).map((v, i) => v.bytes - (withUnused[i + 1]?.bytes ?? 0));
        for (const d of pTrail) expect(d).toBeLessThan(2_000);
        // FR-MAP-66: players get trails on player tokens only.
        for (const f of snapshotFrames(b.s).filter((x) => x.viewer.role === "player")) {
          for (const t of (f.records[TOKEN_TYPE] ?? []) as Record<string, unknown>[]) {
            if (t.ownerPlayerId === null) expect(Object.keys(t)).not.toContain("trail");
          }
          const raw = JSON.stringify(f.records);
          for (const leak of [HIT_RULING_TYPE, "publicSide", "ruling-"]) {
            expect(raw).not.toContain(leak);
          }
        }
        const players = sided.slice(1).map((v) => v.bytes);
        console.log(
          `CBT S5 CON-44: DM ${dm0.bytes} → ${sided[0]?.bytes} B (rulings +${dm1.bytes - dm0.bytes}, unused +${dUnused}, trails +${dTrail}, side +${dSide}); ${1.5 * 1_048_576 - (sided[0]?.bytes ?? 0)} B left of 1.5 MiB; players ${Math.min(...players)}–${Math.max(...players)} B (trails +${Math.min(...pTrail)}–${Math.max(...pTrail)}); hit-ruling type ${typeBytes(dm1, HIT_RULING_TYPE)} B`,
        );
      } finally {
        sql.run("DELETE FROM hit_ruling");
        sql.run(
          "UPDATE notification SET payload = json_remove(payload, '$.unusedRolls') WHERE kind = 'damage-card'",
        );
        sql.run("UPDATE token SET trail = NULL");
        sql.run("UPDATE combatant SET side = NULL, public_side = NULL");
      }
      expect(snapshotSizes(b.s).map((v) => v.bytes)).toEqual(before.map((v) => v.bytes));
    });

    // Mutates the scenario, then restores it: after the read-only cases.
    test("CBT §12 sprint 6 (track CP) worst case: 24 owned combatants with 8-attack max cards, 18 present pets (3 per player); ceilings hold", () => {
      const sql = b.s.db.$client;
      const enc = sql
        .query<{ id: string; cid: string }, []>(
          "SELECT id, campaign_id AS cid FROM encounter WHERE status = 'started'",
        )
        .get();
      if (!enc) throw new Error("no started encounter");
      const before = snapshotSizes(b.s);
      // One owner PC per player (the heavy scenario's six players).
      const owners = sql
        .query<{ id: string; p: string }, [string]>(
          "SELECT id, owner_player_id AS p FROM entity WHERE kind = 'character' AND campaign_id = ? AND owner_player_id IS NOT NULL ORDER BY owner_player_id, id",
        )
        .all(enc.cid)
        .filter((o, i, all) => all.findIndex((x) => x.p === o.p) === i);
      expect(owners).toHaveLength(HEAVY.players);
      // FR-CHARX-60 at its max: 8 rows, 40-char names, the longest damage, 2 extra parts.
      const attack = (i: number) => ({
        id: `card-row-${i}`.padEnd(36, "0"),
        name: `Attack ${i}`.padEnd(40, "x"),
        toHit: -10,
        bonus: 3,
        damage: "20d100+30",
        damageType: "bludgeoning",
        extraDamage: [
          { damage: "6d12+10", type: "lightning" },
          { damage: "6d12+10", type: "radiant" },
        ],
      });
      const card = JSON.stringify({
        size: "gargantuan",
        type: "monstrosity",
        ac: 30,
        hpMax: 999,
        speed: 200,
        attacks: Array.from({ length: 8 }, (_, i) => attack(i)),
        more: 12,
      });
      // (1) 4 owned combatants per player (24 of the started encounter's monsters).
      const monsters = sql
        .query<{ id: string }, [string]>(
          "SELECT id FROM combatant WHERE encounter_id = ? AND kind = 'monster' ORDER BY seq LIMIT 24",
        )
        .all(enc.id);
      expect(monsters).toHaveLength(24);
      const own = sql.query(
        "UPDATE combatant SET owner_character_id = ?, owner_player_id = ?, turn_mode = 'in-owner-turn', pet = 1, card = ?, concentration_effect_id = ? WHERE id = ?",
      );
      for (const [i, m] of monsters.entries()) {
        const o = owners[i % owners.length] as { id: string; p: string };
        own.run(o.id, o.p, card, `effect-${i}`.padEnd(36, "0"), m.id);
      }
      sql.run("UPDATE combatant SET owner_hidden = 0");
      const owned = snapshotSizes(b.s);
      // (2) 3 present pets per player (FR-ENT-35 cap), max names, a max 8-attack stat block.
      const block = JSON.stringify({
        size: "gargantuan",
        ac: 30,
        hpMax: 999,
        hpFormula: "20d20+999",
        initBonus: 20,
        speed: 200,
        abilities: { str: 30, dex: 30, con: 30, int: 30, wis: 30, cha: 30 },
        attacks: Array.from({ length: 8 }, (_, i) => attack(i)),
        cr: "30",
        type: "monstrosity",
      });
      const pet = sql.query(
        "INSERT INTO entity (id, kind, campaign_id, name, stat_block, owner_player_id, hp_current, derived_from_id, companion_of, turn_mode, pet_present, created_at, updated_at) VALUES (?, 'monster', ?, ?, ?, ?, 499, ?, ?, 'in-owner-turn', 1, '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z')",
      );
      for (const [i, o] of owners.entries()) {
        for (let k = 0; k < 3; k++) {
          const id = `pet-${i}-${k}`.padEnd(36, "0");
          pet.run(
            id,
            enc.cid,
            `Pet ${i} ${k}`.padEnd(60, "x"),
            block,
            o.p,
            "derived".padEnd(36, "0"),
            o.id,
          );
        }
      }
      const withPets = snapshotSizes(b.s);
      try {
        expectUnderCeilings(withPets);
        const [dm0] = before as [ViewerSize, ...ViewerSize[]];
        const [dm1] = owned as [ViewerSize, ...ViewerSize[]];
        const [dm2, ...p2] = withPets as [ViewerSize, ...ViewerSize[]];
        // CBT §12: card ≤ 2,038 B; 24 owned combatants ≈ +55 KB, 18 pets ≈ +52 KB (DM).
        expect(dm1.bytes - dm0.bytes).toBeLessThan(60_000);
        expect(dm2.bytes - dm1.bytes).toBeLessThan(60_000);
        const pDelta = p2.map((v, i) => v.bytes - ((before[i + 1] as ViewerSize).bytes ?? 0));
        for (const d of pDelta) expect(d).toBeLessThan(30_000);
        // Leak strings (ADR-0056): a player frame carries only its own companions' cards and
        // pets in full; never `ownerHidden`, `concentrationEffectId`, `petPresent` or a pet's
        // `derivedFromId`.
        for (const f of snapshotFrames(b.s).filter((x) => x.viewer.role === "player")) {
          const raw = JSON.stringify(f.records);
          for (const leak of ["ownerHidden", "concentrationEffectId", "petPresent", "effect-0"]) {
            expect({ leak, found: raw.includes(leak) }).toEqual({ leak, found: false });
          }
          for (const c of (f.records[COMBATANT_TYPE] ?? []) as Record<string, unknown>[]) {
            if (c.ownerPlayerId && c.ownerPlayerId !== f.viewer.playerId) {
              expect(Object.keys(c)).not.toContain("card");
            }
          }
          for (const e of (f.records[ENTITY_TYPE] ?? []) as Record<string, unknown>[]) {
            if (e.kind !== "monster") continue;
            expect(Object.keys(e)).not.toContain("derivedFromId");
            if (e.ownerPlayerId !== f.viewer.playerId)
              expect(Object.keys(e)).not.toContain("statBlock");
          }
        }
        const players = withPets.slice(1).map((v) => v.bytes);
        console.log(
          `CBT S6 CON-44: DM ${dm0.bytes} → ${dm2.bytes} B (owned combatants +${dm1.bytes - dm0.bytes}, pets +${dm2.bytes - dm1.bytes}); ${1.5 * 1_048_576 - dm2.bytes} B left of 1.5 MiB; players ${Math.min(...players)}–${Math.max(...players)} B (+${Math.min(...pDelta)}–${Math.max(...pDelta)}); ${512 * 1024 - Math.max(...players)} B left of 512 KiB`,
        );
      } finally {
        sql.run("DELETE FROM entity WHERE companion_of IS NOT NULL AND id LIKE 'pet-%'");
        sql.run(
          "UPDATE combatant SET owner_character_id = NULL, owner_player_id = NULL, turn_mode = NULL, pet = 0, card = NULL, concentration_effect_id = NULL, owner_hidden = 0",
        );
      }
      expect(snapshotSizes(b.s).map((v) => v.bytes)).toEqual(before.map((v) => v.bytes));
    });

    // Mutates the scenario (500 library assets), then removes them: after the read-only cases.
    test("FR-ASSET-39 CON-44 tags: + 500 library images with worst tags (8 × 24 chars) → DM < 1.5 MiB; every player frame byte-identical to no tags", () => {
      const sql = b.s.db.$client;
      const cid = sql.query<{ id: string }, []>("SELECT id FROM campaign WHERE active = 1").get()
        ?.id as string;
      const seq0 = sql.query<{ n: number }, []>("SELECT max(seq) AS n FROM asset").get()?.n ?? 0;
      const insert = sql.query(
        `INSERT INTO asset (id, campaign_id, seq, name, hash, mime, bytes, width, height, display_width, display_height, created_at, listed, tags)
         VALUES (?, ?, ?, ?, ?, 'image/png', 2000000, 1400, 980, 1400, 980, '2026-10-20T00:00:00.000Z', 1, '[]')`,
      );
      // Size probe, not commands (ASSET §12): 80-char names, distinct hashes.
      sql.transaction(() => {
        for (let i = 0; i < 500; i++) {
          const id = `con44-tags-${String(i).padStart(11, "0")}`;
          const name = `${"Library image ".repeat(6)}${i}`.slice(0, 80).padEnd(80, "x");
          insert.run(
            id,
            cid,
            seq0 + 1 + i,
            name,
            `con44-tags-${String(i).padStart(4, "0")}`.padEnd(64, "0"),
          );
        }
      })();
      const none = snapshotSizes(b.s);
      const assetBytes = (v: ViewerSize) => v.types.asset?.bytes ?? 0;
      const typical = JSON.stringify(["Tokens", "Portraits"]);
      sql.run(`UPDATE asset SET tags = '${typical}' WHERE id LIKE 'con44-tags-%'`);
      const typ = snapshotSizes(b.s);
      const worst = JSON.stringify(Array.from({ length: 8 }, (_, k) => `${k}`.repeat(24)));
      sql.run(`UPDATE asset SET tags = '${worst}' WHERE id LIKE 'con44-tags-%'`);
      const after = snapshotSizes(b.s);
      expectUnderCeilings(after);
      const [dm, ...players] = after as [ViewerSize, ...ViewerSize[]];
      const [dm0, ...players0] = none as [ViewerSize, ...ViewerSize[]];
      // Players: `asset` is DM-only, so not one byte changes (FR-ASSET-50).
      expect(players.map((p) => [p.label, p.bytes])).toEqual(
        players0.map((p) => [p.label, p.bytes]),
      );
      expect(players.every((p) => assetBytes(p) === 0)).toBe(true);
      // `"tags":[]` → 8 × (24 + 3) - 1 more bytes per record.
      expect(assetBytes(dm) - assetBytes(dm0)).toBe(500 * (8 * 27 - 1));
      console.log(
        `ASSET S6 CON-44 tags: 500 library images, DM ${dm0.bytes} B (no tags) → ${typ[0]?.bytes} B (typical) → ${dm.bytes} B (worst 8 × 24), ${SNAPSHOT_CEILING.dm - dm.bytes} B left of 1.5 MiB; players ${Math.min(...players.map((p) => p.bytes))}–${Math.max(...players.map((p) => p.bytes))} B, unchanged`,
      );
      sql.run("DELETE FROM asset WHERE id LIKE 'con44-tags-%'");
    });

    test("FR-CAMP-45 CON-44 switch / FR-GEM-02 (sprint 7): 8 gem rows at 99 while off → every frame byte-identical; on → +20 B features + the rows per viewer; ceilings hold", () => {
      const sql = b.s.db.$client;
      const cid = sql.query<{ id: string }, []>("SELECT id FROM campaign WHERE active = 1").get()
        ?.id as string;
      const before = snapshotSizes(b.s);
      // Worst case (GEM §12): 8 characters with every count at 99 (a size probe, not a command).
      const chars = sql
        .query<{ id: string }, [string]>(
          "SELECT id FROM entity WHERE campaign_id = ? AND kind = 'character' ORDER BY id LIMIT 8",
        )
        .all(cid);
      expect(chars.length).toBeGreaterThanOrEqual(6);
      const put = sql.query(
        "INSERT INTO character_gems (id, campaign_id, inspiration, fortune, combat, divine, action, updated_at) VALUES (?, ?, 99, 99, 99, 99, 99, '2026-01-01T00:00:00.000Z')",
      );
      for (const c of chars) put.run(c.id, cid);
      const off = snapshotSizes(b.s);
      expect(off.map((v) => v.bytes)).toEqual(before.map((v) => v.bytes));
      const dmActor = { role: "dm" as const, playerId: null, campaignId: cid };
      b.s.commands.run(setFeature, { feature: "gems", on: true }, { actor: dmActor });
      const on = snapshotSizes(b.s);
      expectUnderCeilings(on);
      for (const [i, v] of on.entries()) {
        const rows = v.types[CHARACTER_GEMS_TYPE];
        expect(rows?.rows).toBe(chars.length);
        expect(v.bytes - (before[i] as ViewerSize).bytes).toBe(20 + 1 + (rows?.bytes ?? 0));
      }
      const [dm, ...players] = on as [ViewerSize, ...ViewerSize[]];
      console.log(
        `GEM CON-44: off +0 B; on DM +${dm.bytes - (before[0]?.bytes ?? 0)} B → ${dm.bytes} B (${SNAPSHOT_CEILING.dm - dm.bytes} B left of 1.5 MiB); players +${players[0] ? players[0].bytes - (before[1]?.bytes ?? 0) : 0} B, max ${Math.max(...players.map((p) => p.bytes))} B of 512 KiB; ${chars.length} rows at 99`,
      );
      b.s.commands.run(setFeature, { feature: "gems", on: false }, { actor: dmActor });
      sql.run("DELETE FROM character_gems");
      expect(snapshotSizes(b.s).map((v) => v.bytes)).toEqual(before.map((v) => v.bytes));
    });

    // Mutates the scenario (every token's creatureType): after the read-only cases.
    test("FR-ENT-27 CON-44 token creatureType: null on every token, worst case `monstrosity` ≤ +9 B per received token; ceilings hold", () => {
      const typed = b.s.db.$client
        .query<{ id: string; t: string }, []>(
          "SELECT id, creature_type AS t FROM token WHERE creature_type IS NOT NULL",
        )
        .all();
      b.s.db.$client.run("UPDATE token SET creature_type = NULL");
      const before = snapshotSizes(b.s);
      const tokenBytes = (v: ViewerSize) => v.types[TOKEN_TYPE]?.bytes ?? 0;
      const rows = (v: ViewerSize) => v.types[TOKEN_TYPE]?.rows ?? 0;
      // Worst case (ENT §12): the longest value on every token (a size probe, not a command).
      b.s.db.$client.run("UPDATE token SET creature_type = 'monstrosity'");
      const after = snapshotSizes(b.s);
      expectUnderCeilings(after);
      for (const [i, v] of after.entries()) {
        const was = before[i] as ViewerSize;
        // `"creatureType":null` → `"creatureType":"monstrosity"`: +9 B per token received.
        expect(tokenBytes(v) - tokenBytes(was)).toBe(9 * rows(v));
        expect(v.bytes - was.bytes).toBe(9 * rows(v));
      }
      const [dm, ...players] = after as [ViewerSize, ...ViewerSize[]];
      const loads = sceneLoadSizes(b.s);
      expect(loads[0]?.bytes).toBeLessThan(SCENE_LOAD_MAX);
      console.log(
        `ENT CON-44 token creatureType: ${rows(dm)} tokens per frame; DM ${before[0]?.bytes} B (null) → ${dm.bytes} B (monstrosity), ${1_048_576 - dm.bytes} B left of 1 MiB; players ${Math.min(...players.map((p) => p.bytes))}–${Math.max(...players.map((p) => p.bytes))} B; largest scene load ${loads[0]?.bytes} B`,
      );
      b.s.db.$client.run("UPDATE token SET creature_type = NULL");
      const restore = b.s.db.$client.query("UPDATE token SET creature_type = ? WHERE id = ?");
      for (const r of typed) restore.run(r.t, r.id);
    });

    // Mutates the scenario (roll payloads), then restores it: after the read-only cases.
    test("FR-DICE-94, -96, FR-CHARX-130 CON-44 (sprint 15, #385) worst case: every roll item tagged `damage` + `part` + `edited`, every roll entry stamped `usedByCardId`; the stamp adds 0 B for players; ceilings hold", () => {
      const sql = b.s.db.$client;
      const rows = sql
        .query<{ id: string; payload: string; dm: string | null }, []>(
          "SELECT id, payload, dm_payload AS dm FROM game_log_entry WHERE kind = 'roll'",
        )
        .all();
      expect(rows.length).toBeGreaterThan(0);
      const before = snapshotSizes(b.s);
      const set = sql.query("UPDATE game_log_entry SET payload = ?, dm_payload = ? WHERE id = ?");
      // (1) Item tags at their widest: `purpose: "damage"`, a `part` (base, longest type) where
      // none, `edited` (FR-DICE-94, FR-CHARX-129, -130). Size probe, not commands.
      for (const r of rows) {
        const items = (JSON.parse(r.payload) as Record<string, unknown>[]).map((i) => ({
          ...i,
          purpose: "damage",
          part: i.part ?? { type: "bludgeoning", extra: false },
          edited: true,
        }));
        set.run(JSON.stringify(items), r.dm, r.id);
      }
      const tagged = snapshotSizes(b.s);
      // (2) The DM-only stamp on every roll entry (FR-DICE-96): a UUID card id.
      for (const r of rows) {
        const now = sql
          .query<{ payload: string }, [string]>("SELECT payload FROM game_log_entry WHERE id = ?")
          .get(r.id);
        const items = JSON.parse(now?.payload ?? "[]") as unknown[];
        const dm = r.dm ? JSON.parse(r.dm) : { items: items.map(() => ({ mods: [] })) };
        const usedByCardId = "00000000-0000-4000-8000-000000000000";
        set.run(now?.payload ?? "[]", JSON.stringify({ ...dm, usedByCardId }), r.id);
      }
      const stamped = snapshotSizes(b.s);
      expectUnderCeilings(stamped);
      const players = (v: ViewerSize[]) => v.filter((x) => x.role === "player");
      // Players never receive `dmPayload`: the stamp adds not one byte (FR-DICE-15, -96).
      expect(players(stamped).map((p) => p.bytes)).toEqual(players(tagged).map((p) => p.bytes));
      const grow = (a: ViewerSize[], z: ViewerSize[]) =>
        z.map((v, i) => v.bytes - (a[i]?.bytes ?? 0));
      const [tagDm = 0, ...tagPlayers] = grow(before, tagged);
      const [stampDm = 0] = grow(tagged, stamped);
      const window = (v: ViewerSize | undefined) => v?.types["game-log-entry"]?.rows ?? 0;
      // ≈ 50 B a tagged item (`,"purpose":"damage","part":{…},"edited":true`) in the 100-entry
      // window; the stamp ≈ 55 B an entry (DM only).
      expect(tagDm).toBeLessThanOrEqual(60 * 20 * window(stamped[0]));
      expect(stampDm).toBeLessThanOrEqual(80 * window(stamped[0]));
      const [dm, ...ps] = stamped as [ViewerSize, ...ViewerSize[]];
      console.log(
        `TRAY S1 CON-44 (#385): ${rows.length} roll entries, ${window(dm)} in the DM window; item tags DM +${tagDm} B, players +${Math.min(...tagPlayers)}–${Math.max(...tagPlayers)} B; usedByCardId DM +${stampDm} B, players +0 B; heavy DM ${dm.bytes} B (${SNAPSHOT_CEILING.dm - dm.bytes} B left of 1.5 MiB); players max ${Math.max(...ps.map((p) => p.bytes))} B`,
      );
      for (const r of rows) set.run(r.payload, r.dm, r.id);
      expect(snapshotSizes(b.s).map((v) => v.bytes)).toEqual(before.map((v) => v.bytes));
    });

    // Mutates the scenario (adds tokens): keep last.
    test("ADR-0041 a non-active scene at the 200-token cap: its load < 512 KiB; the DM snapshot doesn't grow", () => {
      const dmBefore = snapshotSizes(b.s)[0]?.bytes ?? 0;
      const target = sceneLoadSizes(b.s).find(
        (l) => l.rows[TOKEN_TYPE] !== HEAVY.activeSceneTokens,
      );
      expect(fillSceneToCap(b.s, target?.sceneId as string)).toBe(SCENE_TOKEN_CAP);
      const largest = sceneLoadSizes(b.s)[0];
      expect(largest?.sceneId).toBe(target?.sceneId as string);
      expect(largest?.rows[TOKEN_TYPE]).toBe(SCENE_TOKEN_CAP);
      // Measured 98,628 B for 200 max-string tokens; a max SCN scene adds ≈ 190 KB (ADR-0041).
      expect(largest?.bytes).toBeLessThan(SCENE_LOAD_MAX);
      expect(snapshotSizes(b.s)[0]?.bytes).toBe(dmBefore);
    });
  });
});

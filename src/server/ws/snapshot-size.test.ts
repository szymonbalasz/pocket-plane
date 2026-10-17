// CON-44 snapshot ceilings + live-sync §12 build time (#163): session-sim and a "realistic
// heavy" session built through commands. DM ≤ 768 KiB, players ≤ 512 KiB, DM build < 200 ms.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { EFFECT_TYPE } from "@shared/combat-extras/schemas";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import { GAME_LOG_WINDOW } from "@shared/dice-roll-log/schemas";
import { EFFECT_PRESET_TYPE } from "@shared/effect-modifiers/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import {
  AOE_TEMPLATE_TYPE,
  MAP_SETTINGS_TYPE,
  SCENE_PROP_TYPE,
  SCENE_STRUCTURE_TYPE,
} from "@shared/scene-tools/schemas";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { SNAPSHOT_CEILING } from "./hub";
import {
  buildRealisticHeavy,
  CREATURE_SHEET_TYPE,
  dmBuildMs,
  fillSceneToCap,
  HEAVY,
  SCENE_TOKEN_CAP,
  sceneLoadSizes,
  servicesFromBundle,
  snapshotFrames,
  snapshotSizes,
  type ViewerSize,
} from "./testing/snapshot-size";

const BUILD_MS = 200;
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
  test("session-sim: every viewer under its ceiling; DM build < 200 ms", async () => {
    const b = await sessionSim();
    try {
      const sizes = snapshotSizes(b.s);
      expect(sizes.map((v) => v.label)).toEqual(["DM", "P1", "P2"]);
      expectUnderCeilings(sizes);
      expect(dmBuildMs(b.s)).toBeLessThan(BUILD_MS);
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
    beforeAll(async () => {
      b = await sessionSim();
      counts = buildRealisticHeavy(b.s);
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

    test("CON-44 (#208) DM < 1 MiB, every player < 512 KiB; DM build < 200 ms", () => {
      const sizes = snapshotSizes(b.s);
      expect(sizes).toHaveLength(1 + HEAVY.players);
      expectUnderCeilings(sizes);
      expect(dmBuildMs(b.s)).toBeLessThan(BUILD_MS);
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
          for (const k of ["tempHp", "deathSuccesses", "deathFailures", "hpCurrent"]) {
            expect(Object.keys(e)).not.toContain(k);
          }
          expect(Object.keys(e)).toContain("deathState");
        }
        const fx = JSON.stringify(f.records[EFFECT_TYPE] ?? []);
        for (const leak of ["sourceCombatantId", "anchorCombatantId", "concentrationId", "Hex "]) {
          expect(fx).not.toContain(leak);
        }
      }
    });

    test("SQL windows: providers return the window, not the history (build time flat)", () => {
      const before = dmBuildMs(b.s);
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
      expect(dmBuildMs(b.s)).toBeLessThan(Math.max(BUILD_MS, before * 2));
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

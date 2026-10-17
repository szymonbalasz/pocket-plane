// Sprint-4 gate bundle `session-sim-8` (sprint-4 step 8): `session-sim-7` + the sprint-4 units as
// patches (seams S10). Loads from empty, is deterministic, the units' own records hold once stacked
// (Flame Tongue, Fire Ward, Rage spent, Searing Strike, templates and their cells, party vision off,
// token creature types, the homebrew Potion of Healing), CON-44 ceilings (#208: DM 1 MiB, players
// 512 KiB) with the measured figures printed, and a per-player smoke for the new unit secrets.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeDb, type Db } from "@server/db/client";
import {
  aoeTemplate,
  campaign,
  combatant,
  compendiumEntry,
  creatureSheet,
  effect,
  effectPreset,
  encounter,
  entity,
  fogSettings,
  player,
  ruleTrigger,
  scene,
  token,
} from "@server/db/schema";
import { searchEntries } from "@server/features/compendium/search";
import { loadSceneSight } from "@server/features/fog-of-war/derive";
import { SNAPSHOT_CEILING } from "@server/ws/hub";
import type { Viewer } from "@server/ws/records";
import { playerViewer, sourceOf } from "@server/ws/testing/convergence";
import {
  buildRealisticHeavy,
  servicesFromBundle,
  snapshotFrames,
  snapshotSizes,
  type ViewerSize,
} from "@server/ws/testing/snapshot-size";
import { CreatureSheetRecord } from "@shared/character-sheet/sheet";
import { CBT_INTENTS } from "@shared/combat-tracker/schemas";
import { SearchQuery } from "@shared/compendium/rest";
import { FOG_SETTINGS_TYPE } from "@shared/fog-of-war/schemas";
import { templateCells } from "@shared/scene-tools/geometry";
import { MAP_INTENTS } from "@shared/scenes-map/schemas";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { loadBundle } from "../index";
import { HB_POTION_MARKER } from "../units/compendium/cmp-search-homebrew";

const BUNDLE = "session-sim-8";

/** The sprint-4 units in the bundle's order (`mod-presets` pulled in by `mod-fire-ward`). */
const SPRINT4_KEYS = [
  "vision-brakka",
  "mt-templates",
  "cmp-search-homebrew",
  "ent-art-tokens",
  "weapon-flame-tongue",
  "mod-presets",
  "mod-fire-ward",
  "uses-rage-spent",
  "trg-mira-uses",
];

/** Load-time budget for the in-process load (measured ≈ 1.2 s; sim-7 + nine patches). */
const LOAD_BUDGET_MS = 10_000;

const cleanups: (() => void)[] = [];
afterAll(() => {
  Bun.gc(true);
  for (const c of cleanups) {
    try {
      c();
    } catch {
      // Windows may hold the temp dir a moment longer; the OS cleans it up.
    }
  }
});

async function loaded() {
  const started = performance.now();
  const r = await loadBundle(BUNDLE, { testMode: true });
  const ms = Math.round(performance.now() - started);
  cleanups.push(r.cleanup);
  const db = r.openDb();
  cleanups.unshift(() => closeDb(db));
  return { r, db, ms };
}

function sheetOf(db: Db, name: string) {
  const e = db.select().from(entity).where(eq(entity.name, name)).get();
  const row = db
    .select()
    .from(creatureSheet)
    .where(eq(creatureSheet.entityId, e?.id ?? ""))
    .get();
  return { e, sheet: CreatureSheetRecord.parse({ id: row?.entityId, ...row }) };
}

describe("session-sim-8 bundle (sprint-4 gate)", () => {
  test("FR-FIX-15 session-sim-8 loads from empty: session-sim-7, then the sprint-4 units in order", async () => {
    const { r, ms } = await loaded();
    console.log(`session-sim-8 in-process load: ${ms} ms (${r.manifest.fixtures.length} fixtures)`);
    expect(r.manifest.status).toBe("complete");
    expect(r.manifest.fixtures.slice(-SPRINT4_KEYS.length)).toEqual(SPRINT4_KEYS);
    expect(r.manifest.fixtures.slice(-SPRINT4_KEYS.length - 1)[0]).toBe("trg-combat");
    expect(r.manifest.playerLinks.map((p) => [p.player, p.campaign])).toEqual([
      ["Player 1", "Fixture Campaign"],
      ["Player 2", "Fixture Campaign"],
      ["Second Player", "Second Campaign"],
    ]);
    expect(ms).toBeLessThan(LOAD_BUDGET_MS);
  }, 30_000);

  test("FR-FIX-08 session-sim-8 deterministic: two loads give identical rows", async () => {
    const a = await loaded();
    const b = await loaded();
    for (const t of [
      entity,
      creatureSheet,
      token,
      aoeTemplate,
      combatant,
      effect,
      effectPreset,
      ruleTrigger,
      compendiumEntry,
      fogSettings,
      player,
    ] as const) {
      expect(b.db.select().from(t).all()).toEqual(a.db.select().from(t).all());
    }
  }, 60_000);

  test("seams S10 compose: every sprint-4 unit's records hold once stacked on session-sim-7", async () => {
    const { r, db } = await loaded();
    const fixture = db.select().from(campaign).where(eq(campaign.name, "Fixture Campaign")).get();
    const players = db
      .select()
      .from(player)
      .where(eq(player.campaignId, fixture?.id ?? ""))
      .all();
    const p1 = players.find((p) => p.name === "Player 1")?.id as string;
    const ambush = db.select().from(scene).where(eq(scene.name, "Goblin Ambush")).get();
    const sid = ambush?.id as string;
    const tokens = db
      .select()
      .from(token)
      .where(eq(token.sceneId, sid))
      .orderBy(asc(token.seq))
      .all();

    // V: vision-brakka gives Brakka senses; she stays one of player-1's sources on Goblin Ambush.
    const brakka = sheetOf(db, "Brakka");
    expect((brakka.e?.statBlock as { senses?: unknown } | undefined)?.senses).toEqual({
      visionFt: 30,
      darkvisionFt: 60,
      seesMagicalDarkness: false,
    });
    const brakkaToken = tokens.find((t) => t.name === "Brakka");
    const p1Sight = loadSceneSight(db, sid)?.sight.get(p1);
    expect(p1Sight?.sources.map((x) => x.tokenId)).toContain(brakkaToken?.id as string);

    // V: party vision off at load: no `fog_settings` row; the snapshot still carries the record.
    expect(db.select().from(fogSettings).all()).toEqual([]);

    // R: Flame Tongue +1 beside the Greataxe; Rage 0 / 3 left, its preset still linked.
    expect((brakka.e?.statBlock as { attacks?: unknown[] } | undefined)?.attacks).toEqual([
      expect.objectContaining({ name: "Greataxe", damage: "1d12+4" }),
      expect.objectContaining({
        name: "Flame Tongue greatsword",
        toHit: 7,
        damage: "2d6+4",
        damageType: "slashing",
        bonus: 1,
        extraDamage: [{ damage: "2d6", type: "fire" }],
      }),
    ]);
    const rageRow = brakka.sheet.features.find((f) => f.name === "Rage");
    expect([rageRow?.usesMax, rageRow?.used]).toEqual([3, 3]);
    const rage = db
      .select()
      .from(effectPreset)
      .where(eq(effectPreset.characterId, brakka.e?.id ?? ""))
      .get();
    expect(rage).toMatchObject({ name: "Rage", usesFeatureId: rageRow?.id });

    // R: Fire Ward on Goblin only (an active effect on its combatant).
    const ward = db.select().from(effectPreset).where(eq(effectPreset.name, "Fire Ward")).get();
    expect(ward?.modifiers).toEqual([{ kind: "defense", types: ["fire"], level: "resistance" }]);
    const enc = db.select().from(encounter).get();
    const order = db
      .select()
      .from(combatant)
      .where(eq(combatant.encounterId, enc?.id ?? ""))
      .all();
    const warded = db
      .select()
      .from(effect)
      .where(and(isNull(effect.endedAt), eq(effect.presetKey, ward?.id ?? "")))
      .all();
    expect(warded.map((w) => order.find((c) => c.id === w.targetCombatantId)?.name)).toEqual([
      "Goblin",
    ]);
    // Combat as sim-7 left it: round 1, Wolf's turn.
    const wolf = order.find((c) => c.name === "Wolf");
    expect([enc?.round, enc?.turnCombatantId]).toEqual([1, wolf?.id]);

    // R: Mira's Searing Strike 1 / 2 left, a `feature` trigger; sim-7's triggers kept before it.
    const mira = sheetOf(db, "Mira");
    const searingRow = mira.sheet.features.find((f) => f.name === "Searing Strike");
    expect([searingRow?.usesMax, searingRow?.used]).toEqual([2, 1]);
    const triggers = db.select().from(ruleTrigger).orderBy(asc(ruleTrigger.seq)).all();
    expect(triggers.map((t) => t.name)).toEqual([
      "Divine Fury",
      "Sneak Attack",
      "Martial Advantage",
      "Regeneration",
      "Searing Strike",
    ]);
    expect(triggers.at(-1)).toMatchObject({ characterId: mira.e?.id, public: true, enabled: true });
    expect(triggers.at(-1)?.rule).toMatchObject({ on: "hit", every: { feature: searingRow?.id } });

    // M: Thunderwave (freeform, player-2's) and Web on Goblin Ambush; Thunderwave's 8 squares.
    const templates = db.select().from(aoeTemplate).orderBy(asc(aoeTemplate.seq)).all();
    expect(templates.map((t) => [t.label, t.sceneId, t.x, t.y, t.angle, t.hidden])).toEqual([
      ["Thunderwave", sid, 1.5, 10.5, 300, false],
      ["Web", sid, 0, 6, 0, false],
    ]);
    const map = ambush as NonNullable<typeof ambush>;
    const rect = {
      gridCellSize: map.gridCellSize,
      gridOffsetX: map.gridOffsetX,
      gridOffsetY: map.gridOffsetY,
      mapWidth: map.mapWidth as number,
      mapHeight: map.mapHeight as number,
    };
    const thunderwave = templates[0] as NonNullable<(typeof templates)[0]>;
    expect(templateCells(thunderwave, rect, { cut: true })).toEqual([
      [3, 8],
      [2, 9],
      [3, 9],
      [4, 9],
      [2, 10],
      [3, 10],
      [4, 10],
      [3, 11],
    ]);
    expect(templates[1]?.seenBy?.length).toBe(2);

    // C: ent-art-tokens' creature types from their definitions (names numbered after sim-7's).
    const mine = r.manifest.records["ent-art-tokens"]?.token ?? [];
    const art = mine.map((id) => tokens.find((t) => t.id === id));
    expect(art.map((t) => [t?.name, t?.creatureType, t?.hidden, t?.imageAssetId !== null])).toEqual(
      [
        ["Goblin 3", "humanoid", false, false],
        ["Goblin 4", "humanoid", false, false],
        ["Elite Goblin Warrior 2", "humanoid", false, false],
        ["Adult Red Dragon", "dragon", false, false],
        ["Wolf 2", "beast", false, true],
        ["Plain Brute", null, false, false],
        ["Ogre", "giant", true, false],
      ],
    );

    // C: the homebrew Potion of Healing (DM only) + Healing Draught (shared); "potion heal" finds
    // Potion of Healing first for the DM (homebrew, then SRD mini) and the SRD one for a player.
    const homebrew = db
      .select()
      .from(compendiumEntry)
      .where(eq(compendiumEntry.campaignId, fixture?.id ?? ""))
      .all();
    expect(
      homebrew
        .filter((x) => ["Potion of Healing", "Healing Draught"].includes(x.name))
        .map((x) => [x.name, x.shared])
        .sort(),
    ).toEqual([
      ["Healing Draught", true],
      ["Potion of Healing", false],
    ]);
    const search = (v: { role: "dm" | "player"; playerId: string | null }) =>
      searchEntries(
        db,
        { campaignId: fixture?.id as string, ...v },
        SearchQuery.parse({ q: "potion heal" }),
      ).results.map((x) => `${x.name} · ${x.sourceLabel}`);
    expect(search({ role: "dm", playerId: null }).slice(0, 2)).toEqual([
      "Potion of Healing · Homebrew",
      "Potion of Healing · SRD 5.1",
    ]);
    const p1Hits = search({ role: "player", playerId: p1 });
    expect(p1Hits[0]).toBe("Potion of Healing · SRD 5.1");
    expect(p1Hits).not.toContain("Potion of Healing · Homebrew");
  }, 30_000);
});

/** Figures for the report: whole frame and the three biggest types. */
const fmt = (s: ViewerSize) =>
  `${s.label} ${s.bytes} B (${Object.entries(s.types)
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .slice(0, 3)
    .map(([t, v]) => `${t} ${v.bytes}`)
    .join(", ")})`;

describe("CON-44 session-sim-8 (#208 ceilings)", () => {
  test("CON-44 session-sim-8 snapshots under the ceilings: DM ≤ 1 MiB, every player ≤ 512 KiB (bundle, then + realistic heavy)", async () => {
    const b = await servicesFromBundle(await loadBundle(BUNDLE, { testMode: true }));
    cleanups.push(b.cleanup);
    const check = (label: string, sizes: ViewerSize[]) => {
      console.log(`CON-44 ${label}: ${sizes.map(fmt).join("; ")}`);
      expect(sizes.slice(0, 3).map((s) => s.label)).toEqual(["DM", "P1", "P2"]);
      for (const s of sizes) {
        expect([label, s.label, s.bytes <= SNAPSHOT_CEILING[s.role]]).toEqual([
          label,
          s.label,
          true,
        ]);
      }
    };
    check("session-sim-8", snapshotSizes(b.s));
    // Town is live at load; the gate plays on Goblin Ambush (its tokens, templates, fog, vision).
    const enc = b.s.db.select().from(encounter).get();
    const actor = { role: "dm" as const, playerId: null, campaignId: enc?.campaignId as string };
    const ambush = b.s.db.select().from(scene).where(eq(scene.name, "Goblin Ambush")).get();
    b.s.commands.run(MAP_INTENTS.activateScene, { sceneId: ambush?.id }, { actor });
    check("session-sim-8 on Goblin Ambush", snapshotSizes(b.s));
    // The harness starts its own 46-combatant encounter: one encounter runs at a time.
    b.s.commands.run(CBT_INTENTS.end, { encounterId: enc?.id }, { actor });
    // The harness writes its own customised campaign `bless`; `mod-presets` (pulled in by
    // `mod-fire-ward`) already holds one, and `(campaign, key)` is unique.
    b.s.db
      .delete(effectPreset)
      .where(and(eq(effectPreset.campaignId, actor.campaignId), isNotNull(effectPreset.key)))
      .run();
    buildRealisticHeavy(b.s);
    check("session-sim-8 + heavy", snapshotSizes(b.s));
  }, 60_000);
});

describe("session-sim-8 smoke (every player)", () => {
  let r: Awaited<ReturnType<typeof loadBundle>>;
  beforeAll(async () => {
    r = await loadBundle(BUNDLE, { testMode: true });
    cleanups.push(r.cleanup);
  }, 30_000);

  test("FR-FOG-49 FR-CMP-14 FR-ENT-27 each player's snapshot and sync.load acks on Goblin Ambush: party vision off, no DM-only homebrew, no hidden Ogre", async () => {
    const b = await servicesFromBundle({ ...r, cleanup() {} });
    try {
      const db = b.s.db;
      const cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
      const tokenId = (name: string) =>
        db.select().from(token).where(eq(token.name, name)).get()?.id as string;
      const [ogre, dragon] = [tokenId("Ogre"), tokenId("Adult Red Dragon")];
      expect([ogre.length, dragon.length].every((n) => n > 0)).toBe(true);
      // Town is live at load; the gate plays on Goblin Ambush.
      const ambush = db.select().from(scene).where(eq(scene.name, "Goblin Ambush")).get();
      const actor = { role: "dm" as const, playerId: null, campaignId: cid };
      b.s.commands.run(MAP_INTENTS.activateScene, { sceneId: ambush?.id }, { actor });
      const frames = snapshotFrames(b.s);
      expect(frames.find((f) => f.label === "DM")?.records[FOG_SETTINGS_TYPE]).toEqual([
        { id: cid, partyVision: false },
      ]);
      const players = frames.filter((f) => f.viewer.role === "player");
      expect(players.map((f) => f.label)).toEqual(["P1", "P2"]);
      for (const f of players) {
        const v: Viewer = playerViewer(cid, f.viewer.playerId as string);
        const acks = b.s.records.lazyTypes().map((d) => b.s.records.load(sourceOf(b.s), v, d.type));
        expect(f.records[FOG_SETTINGS_TYPE]).toEqual([{ id: cid, partyVision: false }]);
        const wire = JSON.stringify(f.records) + JSON.stringify(acks);
        expect([f.label, [HB_POTION_MARKER, ogre].filter((s) => wire.includes(s))]).toEqual([
          f.label,
          [],
        ]);
        // Positive control: the visible Adult Red Dragon (west of the wall) reaches both players.
        expect([f.label, wire.includes(dragon)]).toEqual([f.label, true]);
      }
    } finally {
      b.cleanup();
    }
  }, 60_000);
});

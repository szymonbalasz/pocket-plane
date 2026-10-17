// Sprint-3 gate bundle `session-sim-7` (sprint-3 step 8): `session-sim` + every sprint-3 unit as
// patches (seams S10). Loads from empty, is deterministic, every unit's own invariants hold once
// stacked, CON-44 ceilings (#208: DM 1 MiB, players 512 KiB) with the measured figures printed,
// and a player-2 leak smoke over the snapshot and every lazy type's `sync.load` ack, before and
// after a restart, for the leak strings of FOG, MOD, PARTY, CMP and CHARX §13.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeDb, type Db } from "@server/db/client";
import {
  campaign,
  combatant,
  compendiumEntry,
  creatureSheet,
  diceLook,
  effectPreset,
  encounter,
  entity,
  handout,
  partyItem,
  player,
  ruleTrigger,
  scene,
  sceneFog,
  sceneStructure,
  token,
} from "@server/db/schema";
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
import { asc, eq } from "drizzle-orm";
import { loadBundle } from "../index";
import { HOUSE_FIREBALL_NAME, SECRET_ITEM_NAME } from "../units/compendium/cmp-homebrew";
import { SECOND_HOMEBREW_NAME } from "../units/compendium/cmp-homebrew-second";
import { NOTATION_TEXT } from "../units/dice-extras/dicex-notation-text";
import { HANDOUT_IMG } from "../units/party-board/handout-images";
import { HANDOUTS_1 } from "../units/party-board/handouts-1";
import { SECOND_HANDOUT_TITLE, SECOND_ITEM_NAME } from "../units/party-board/party-second";

const BUNDLE = "session-sim-7";

/** `session-sim`'s keys, then the sprint-3 units in the bundle's order (deps pulled in first). */
const SPRINT3_KEYS = [
  "fog-ambush",
  "scn-walls",
  "vision-senses",
  "vision-crypt",
  "dicex-looks",
  "dicex-notation-text",
  "handout-images",
  "handouts-1",
  "party-items-1",
  "campaign-second",
  "party-second",
  "cmp-srd-mini",
  "cmp-homebrew",
  "cmp-homebrew-second",
  "combat-1",
  "char-brakka",
  "trg-brakka",
  "trg-thorn",
  "trg-monsters",
  "trg-combat",
];

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

const byName = <T extends { name: string }>(rows: T[], name: string) =>
  rows.find((x) => x.name === name);

function sheetOf(db: Db, name: string) {
  const e = db.select().from(entity).where(eq(entity.name, name)).get();
  const row = db
    .select()
    .from(creatureSheet)
    .where(eq(creatureSheet.entityId, e?.id ?? ""))
    .get();
  return { e, sheet: CreatureSheetRecord.parse({ id: row?.entityId, ...row }) };
}

describe("session-sim-7 bundle (sprint-3 gate)", () => {
  test("FR-FIX-15 session-sim-7 loads from empty: session-sim, then the sprint-3 units in order", async () => {
    const { r, ms } = await loaded();
    console.log(`session-sim-7 in-process load: ${ms} ms (${r.manifest.fixtures.length} fixtures)`);
    expect(r.manifest.status).toBe("complete");
    expect(r.manifest.fixtures.slice(-SPRINT3_KEYS.length)).toEqual(SPRINT3_KEYS);
    expect(r.manifest.fixtures.slice(0, 3)).toEqual(["campaign", "player-1", "images"]);
    expect(r.manifest.playerLinks.map((p) => [p.player, p.campaign])).toEqual([
      ["Player 1", "Fixture Campaign"],
      ["Player 2", "Fixture Campaign"],
      ["Second Player", "Second Campaign"],
    ]);
  }, 30_000);

  test("FR-FIX-08 session-sim-7 deterministic: two loads give identical rows", async () => {
    const a = await loaded();
    const b = await loaded();
    for (const t of [
      entity,
      creatureSheet,
      token,
      sceneFog,
      sceneStructure,
      combatant,
      ruleTrigger,
      effectPreset,
      handout,
      partyItem,
      compendiumEntry,
      diceLook,
      player,
    ] as const) {
      expect(b.db.select().from(t).all()).toEqual(a.db.select().from(t).all());
    }
  }, 60_000);

  test("seams S10 compose: every unit's own invariants hold once stacked on session-sim", async () => {
    const { db } = await loaded();
    const campaigns = db.select().from(campaign).all();
    const fixture = byName(campaigns, "Fixture Campaign");
    const second = byName(campaigns, "Second Campaign");
    expect([fixture?.active, second?.active]).toEqual([true, false]);
    const players = db
      .select()
      .from(player)
      .where(eq(player.campaignId, fixture?.id ?? ""))
      .all();
    const p1 = byName(players, "Player 1")?.id;
    const p2 = byName(players, "Player 2")?.id;

    // V: vision-senses on both PCs; vision-crypt + scn-walls on Goblin Ambush; fog-ambush's Lurker.
    const thorn = sheetOf(db, "Thorn");
    const mira = sheetOf(db, "Mira");
    const senses = (e: typeof thorn.e) =>
      (e?.statBlock as { senses?: unknown } | undefined)?.senses;
    expect(senses(mira.e)).toEqual({ visionFt: 30, darkvisionFt: 0, seesMagicalDarkness: false });
    expect(senses(thorn.e)).toEqual({ visionFt: 0, darkvisionFt: 60, seesMagicalDarkness: true });
    const ambush = db.select().from(scene).where(eq(scene.name, "Goblin Ambush")).get();
    const fog = db
      .select()
      .from(sceneFog)
      .where(eq(sceneFog.sceneId, ambush?.id ?? ""))
      .get();
    expect(fog).toMatchObject({ fill: "fog", runs: "", explored: true });
    expect(fog?.shapes).toEqual([
      { op: "reveal", rect: [0, 6, 3, 11] },
      { op: "explored", polygon: [8.5, 0, 19.75, 0, 19.75, 4.5, 8.5, 4.5] },
    ]);
    expect(fog?.darkness.map(({ seenBy: _s, id: _i, ...d }) => d)).toEqual([
      { circle: [12.5, 9, 1.5] },
    ]);
    const structure = db
      .select()
      .from(sceneStructure)
      .where(eq(sceneStructure.sceneId, ambush?.id ?? ""))
      .get();
    expect(structure?.walls.map((w) => w.slice(1))).toEqual([
      [8, 0, 8, 5],
      [8, 6, 8, 11],
      [8, 12, 8, 14],
      [4.5, 3.25, 6.75, 5.5],
    ]);
    expect(structure?.doors.map((d) => d.slice(1, 5))).toEqual([
      [8, 5, 8, 6],
      [8, 11, 8, 12],
    ]);
    const tokens = db
      .select()
      .from(token)
      .where(eq(token.sceneId, ambush?.id ?? ""))
      .all();
    const at = (name: string) => tokens.filter((t) => t.name === name).map((t) => [t.col, t.row]);
    expect(at("Mira")).toEqual([[2, 7]]);
    expect(at("Thorn")).toEqual([[2, 9]]);
    expect(at("Goblin Lurker")).toEqual([[17, 11]]);
    expect(at("Brakka")).toHaveLength(1);

    // R: trg-thorn patched Thorn's classes only (char-thorn's other fields kept); Brakka's Rage
    // (uses 3 / 3, linked to her feature row) gates her Divine Fury; monster triggers DM-only.
    expect(thorn.e?.statBlock).toMatchObject({
      classes: [{ name: "Rogue", level: 5, hitDie: "d8" }],
      ac: 14,
      hpMax: 10,
      attacks: [expect.objectContaining({ name: "Dagger", damage: "1d4+3" })],
    });
    const brakka = sheetOf(db, "Brakka");
    expect(brakka.e?.ownerPlayerId).toBe(p1 as string);
    // V (sprint 4, review A4 / A14): Brakka has no senses, so she sees Normal 999 ft: her token is
    // one of player-1's sources on Goblin Ambush, its polygon bounded by walls and the map edges
    // (no "No vision set" hint for her; `vision-brakka` goes to session-sim-8, not here).
    expect(senses(brakka.e)).toBeUndefined();
    const brakkaToken = tokens.find((t) => t.name === "Brakka");
    const p1Sight = loadSceneSight(db, ambush?.id ?? "")?.sight.get(p1 as string);
    expect(p1Sight?.sources.map((x) => x.tokenId)).toContain(brakkaToken?.id as string);
    const i = p1Sight?.vision.src.indexOf(brakkaToken?.id as string) ?? -1;
    expect(i).toBeGreaterThanOrEqual(0);
    expect(p1Sight?.vision.see.length).toBe(2);
    const rageRow = brakka.sheet.features.find((f) => f.name === "Rage");
    expect([rageRow?.usesMax, rageRow?.used]).toEqual([3, 0]);
    const rage = db
      .select()
      .from(effectPreset)
      .where(eq(effectPreset.characterId, brakka.e?.id ?? ""))
      .get();
    expect(rage).toMatchObject({ name: "Rage", originKey: "rage", usesFeatureId: rageRow?.id });
    const triggers = db.select().from(ruleTrigger).orderBy(asc(ruleTrigger.seq)).all();
    expect(
      triggers.map((t) => [
        t.name,
        t.characterId !== null ? "character" : "definition",
        t.public,
        t.rule.on,
      ]),
    ).toEqual([
      ["Divine Fury", "character", true, "hit"],
      ["Sneak Attack", "character", true, "hit"],
      ["Martial Advantage", "definition", false, "hit"],
      ["Regeneration", "definition", false, "turnStart"],
    ]);
    expect(triggers[0]).toMatchObject({ characterId: brakka.e?.id, ownerPlayerId: p1 });
    expect(triggers[0]?.rule.requires).toEqual({ preset: rage?.id as string });
    expect(triggers[1]).toMatchObject({ characterId: thorn.e?.id, ownerPlayerId: p2 });

    // Combat: round 1, Wolf's turn; Brakka at 17 (trg-combat after combat-1).
    const enc = db.select().from(encounter).get();
    const order = db
      .select()
      .from(combatant)
      .where(eq(combatant.encounterId, enc?.id ?? ""))
      .all()
      .sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0) || a.seq - b.seq);
    expect(order.map((c) => [c.name, c.initiative])).toEqual([
      ["Wolf", 18],
      ["Brakka", 17],
      ["Mira", 15],
      ["Goblin", 12],
      ["Goblin 2", 12],
      ["Thorn", 10],
      ["Elite Goblin Warrior", 8],
    ]);
    expect([enc?.round, enc?.turnCombatantId]).toEqual([1, byName(order, "Wolf")?.id]);

    // D: Mira's notation row appended (notes untouched); dice looks for the DM and player-1.
    expect(mira.sheet.features.map((f) => f.name)).toEqual([
      "Second Wind",
      "Fighting Style",
      "Notation test",
    ]);
    expect(mira.sheet.features.at(-1)?.text).toBe(NOTATION_TEXT);
    expect(mira.sheet.notes).toBe("MIRA-NOTE-7");
    const looks = db.select().from(diceLook).all();
    expect(looks.map((l) => l.ownerKey).sort()).toEqual(["dm", p1 as string].sort());

    // P: five handouts + the party inventory in Fixture Campaign; Torch ×2 on Thorn's items.
    const handouts = db.select().from(handout).orderBy(asc(handout.seq)).all();
    expect(handouts.filter((h) => h.campaignId === fixture?.id).map((h) => h.title)).toEqual([
      "Mayor's Letter",
      `${HANDOUTS_1.p1Only} Thieves' Map`,
      "Secret Orders",
      "Old Bounty",
      "Ship Manifest",
    ]);
    expect(handouts.filter((h) => h.campaignId === second?.id).map((h) => h.title)).toEqual([
      SECOND_HANDOUT_TITLE,
    ]);
    const items = db.select().from(partyItem).orderBy(asc(partyItem.seq)).all();
    expect(items.filter((i) => i.campaignId === fixture?.id).map((i) => [i.name, i.qty])).toEqual([
      ["Potion of healing", 2],
      ["Torch", 8],
      ["Rope (50 ft)", 1],
    ]);
    expect(thorn.sheet.items.at(-1)).toMatchObject({ name: "Torch", qty: 2, equipped: false });

    // C: SRD mini imported (global); homebrew per campaign.
    const entries = db.select().from(compendiumEntry).all();
    expect(entries.filter((x) => x.source === "srd-5.1").length).toBeGreaterThan(0);
    const homebrew = (cid?: string) =>
      entries
        .filter((x) => x.campaignId === cid)
        .map((x) => x.name)
        .sort();
    expect(homebrew(fixture?.id)).toEqual(
      ["Divine Fury", HOUSE_FIREBALL_NAME, "Moonblade Shard", SECRET_ITEM_NAME].sort(),
    );
    expect(homebrew(second?.id)).toEqual([SECOND_HOMEBREW_NAME]);
  }, 30_000);
});

/** Figures for the report: whole frame and the three biggest types. */
const fmt = (s: ViewerSize) =>
  `${s.label} ${s.bytes} B (${Object.entries(s.types)
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .slice(0, 3)
    .map(([t, v]) => `${t} ${v.bytes}`)
    .join(", ")})`;

describe("CON-44 session-sim-7 (#208 ceilings)", () => {
  test("CON-44 session-sim-7 snapshots under the ceilings: DM ≤ 1 MiB, every player ≤ 512 KiB (bundle, then + realistic heavy)", async () => {
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
    check("session-sim-7", snapshotSizes(b.s));
    // The harness starts its own 46-combatant encounter: one encounter runs at a time.
    const enc = b.s.db.select().from(encounter).get();
    const actor = { role: "dm" as const, playerId: null, campaignId: enc?.campaignId as string };
    b.s.commands.run(CBT_INTENTS.end, { encounterId: enc?.id }, { actor });
    buildRealisticHeavy(b.s);
    check("session-sim-7 + heavy", snapshotSizes(b.s));
  }, 60_000);
});

describe("session-sim-7 leak smoke (player-2)", () => {
  let r: Awaited<ReturnType<typeof loadBundle>>;
  beforeAll(async () => {
    r = await loadBundle(BUNDLE, { testMode: true });
    cleanups.push(r.cleanup);
  }, 30_000);

  /** FOG, MOD, PARTY, CMP and CHARX §13 leak strings that must never reach player-2. */
  function leakStrings(db: Db): string[] {
    const trig = (name: string) =>
      db.select().from(ruleTrigger).where(eq(ruleTrigger.name, name)).get()?.id as string;
    const h = r.manifest.records["handouts-1"]?.handout ?? [];
    const img = r.manifest.records["handout-images"]?.asset ?? [];
    const ids = [
      trig("Divine Fury"),
      trig("Martial Advantage"),
      trig("Regeneration"),
      h[HANDOUTS_1.h.thievesMap],
      h[HANDOUTS_1.h.secretOrders],
      h[HANDOUTS_1.h.shipManifest],
      img[HANDOUT_IMG.thievesMap],
      img[HANDOUT_IMG.wantedPoster],
    ];
    expect(ids.every((x) => typeof x === "string" && x.length > 0)).toBe(true);
    return [
      // FOG: hidden token, server-only keys, Mira's senses.
      "Goblin Lurker",
      '"seenBy"',
      '"doorSeen"',
      '"walls"',
      '"invisible"',
      '"visionFt":30',
      // MOD: DM-only and server-only trigger data, Brakka's trigger.
      "Martial Advantage",
      "Regeneration",
      "Divine Fury",
      "trigger_use",
      "ownerCombatantId",
      '"window"',
      "triggerParts",
      '"dmPayload"',
      // PARTY: player-1-only, unshared and second-campaign handouts / items.
      HANDOUTS_1.p1Only,
      HANDOUTS_1.secret,
      HANDOUTS_1.unshared,
      HANDOUTS_1.prep,
      SECOND_HANDOUT_TITLE,
      SECOND_ITEM_NAME,
      // CMP: DM-only and second-campaign homebrew, derived-monster features.
      SECRET_ITEM_NAME,
      SECOND_HOMEBREW_NAME,
      HOUSE_FIREBALL_NAME,
      "Nimble Escape",
      // CHARX / DICEX: Mira's notes and her notation row.
      "MIRA-NOTE-7",
      "Notation test",
      ...(ids as string[]),
    ];
  }

  async function scan(label: string) {
    const b = await servicesFromBundle({ ...r, cleanup() {} });
    try {
      const db = b.s.db;
      const cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
      const p2 = db.select().from(player).where(eq(player.name, "Player 2")).get()?.id as string;
      const v: Viewer = playerViewer(cid, p2);
      const frame = snapshotFrames(b.s).find((f) => f.viewer.playerId === p2);
      expect(frame).toBeDefined();
      const acks = b.s.records.lazyTypes().map((d) => b.s.records.load(sourceOf(b.s), v, d.type));
      const wire = { snapshot: JSON.stringify(frame?.records), acks: JSON.stringify(acks) };
      const found: string[] = [];
      for (const s of leakStrings(db)) {
        for (const [where, json] of Object.entries(wire)) {
          if (json.includes(s)) found.push(`${label} ${where}: ${s}`);
        }
      }
      expect(found).toEqual([]);
      // Positive control: player-2's own records do arrive.
      expect(wire.snapshot).toContain('"darkvisionFt":60');
      expect(wire.acks).toContain("Sneak Attack");
      expect(wire.acks).toContain("Mayor's Letter");
    } finally {
      b.cleanup();
    }
  }

  test("FR-FOG-44 FR-MOD-47 FR-PARTY-07 FR-CMP-14 leak smoke: player-2's snapshot and sync.load acks carry no unit leak string, before and after a restart", async () => {
    await scan("before");
    await scan("after restart");
  }, 60_000);
});

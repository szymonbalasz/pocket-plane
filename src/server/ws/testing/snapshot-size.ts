// Snapshot size + build time (CON-44, live-sync §12, #163): the exact `snapshot` frame per
// viewer through `RecordRegistry.snapshot` (= Hub.sendSnapshot), and a "realistic heavy"
// session built only through commands on top of `session-sim`, with max-length ASCII strings.
import {
  EFFECT_TYPE,
  type EffectRecord,
  effectVisibleToPlayers,
  redactEffect,
} from "@shared/combat-extras/schemas";
import { parseFullCard } from "@shared/combat-tracker/schemas";
import { EFFECT_PRESET_TYPE, type Modifier } from "@shared/effect-modifiers/schemas";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Config } from "../../config";
import { closeDb, type Db, openMemoryDb } from "../../db/client";
import {
  asset,
  campaign,
  combatant,
  creatureSheet,
  effect,
  effectPreset,
  effectPresetSeqNext,
  effectSeqNext,
  entity,
  notification,
  player,
  scene,
} from "../../db/schema";
import type { Actor } from "../../events/types";
import { silentLogger } from "../../log";
import { createServices, type Services } from "../../services";
import { snapshotTypeBytes } from "../hub";
import type { PresenceView, Viewer } from "../records";

export interface ViewerSize {
  label: string;
  role: "dm" | "player";
  /** UTF-8 bytes of the whole frame. */
  bytes: number;
  types: Record<string, { rows: number; bytes: number }>;
}

export interface ViewerFrame {
  label: string;
  viewer: Viewer;
  records: Record<string, unknown[]>;
}

/** Every viewer of the active campaign: DM, then players in creation order. */
export function snapshotFrames(s: Services): ViewerFrame[] {
  const active = s.db.select().from(campaign).where(eq(campaign.active, true)).get();
  if (!active) throw new Error("no active campaign");
  const players = s.db.select().from(player).where(eq(player.campaignId, active.id)).all();
  const presence: PresenceView = {
    list: (cid) =>
      cid === active.id ? players.map((p) => ({ playerId: p.id, online: true })) : [],
  };
  const viewers: { label: string; v: Viewer }[] = [
    { label: "DM", v: { connId: "dm", campaignId: active.id, role: "dm", playerId: null } },
    ...players.map((p, i) => ({
      label: `P${i + 1}`,
      v: { connId: p.id, campaignId: active.id, role: "player" as const, playerId: p.id },
    })),
  ];
  return viewers.map(({ label, v }) => ({
    label,
    viewer: v,
    records: {
      ...s.records.snapshot({ db: s.db, presence }, v),
      ...pendingSheets(s, v),
      ...pendingEffects(s, v),
      ...pendingPresets(s, v),
    },
  }));
}

/** The exact `snapshot` frame size per viewer, and per record type. */
export function snapshotSizes(s: Services): ViewerSize[] {
  return snapshotFrames(s).map(({ label, viewer: v, records }) => {
    const you = { campaignId: v.campaignId, role: v.role, playerId: v.playerId };
    const frame = { type: "snapshot", seq: 0, you, records };
    const types: ViewerSize["types"] = {};
    const sizes = new Map(snapshotTypeBytes(records));
    for (const [t, rows] of Object.entries(records)) {
      types[t] = { rows: rows.length, bytes: sizes.get(t) ?? 0 };
    }
    return {
      label,
      role: v.role === "dm" ? "dm" : "player",
      bytes: Buffer.byteLength(JSON.stringify(frame), "utf8"),
      types,
    };
  });
}

export const CREATURE_SHEET_TYPE = "creature-sheet";

/**
 * `creature-sheet` rows (CHARX §12) before character-sheet-full registers the record type: the
 * rows the viewer will receive (DM all, a player their own, FR-CHARX-36) counted as their
 * table rows. Empty once the type is registered: then the real snapshot carries them.
 */
function pendingSheets(s: Services, v: Viewer): Record<string, unknown[]> {
  if (s.records.get(CREATURE_SHEET_TYPE)) return {};
  const rows = s.db
    .select()
    .from(creatureSheet)
    .where(eq(creatureSheet.campaignId, v.campaignId))
    .all()
    .filter((r) => v.role === "dm" || r.ownerPlayerId === v.playerId);
  return rows.length ? { [CREATURE_SHEET_TYPE]: rows } : {};
}

/**
 * `effect` rows (CBTX §12) before combat-extras registers the record type: active effects only
 * (FR-CBTX-31: not windowed), DM full, players the redaction of the ones they may see. Empty
 * once the type is registered: then the real snapshot carries them.
 */
function pendingEffects(s: Services, v: Viewer): Record<string, unknown[]> {
  if (s.records.get(EFFECT_TYPE)) return {};
  const rows = s.db
    .select()
    .from(effect)
    .where(and(eq(effect.campaignId, v.campaignId), isNull(effect.endedAt)))
    .orderBy(effect.seq)
    .all() as EffectRecord[];
  const out = v.role === "dm" ? rows : rows.filter(effectVisibleToPlayers).map(redactEffect);
  return out.length ? { [EFFECT_TYPE]: out } : {};
}

/**
 * `effect-preset` rows (MOD §12) before effect-modifiers registers the record type: DM all,
 * a player the rows they own (FR-MOD-22), counted as their table rows. Empty once the type is
 * registered: then the real snapshot carries them.
 */
function pendingPresets(s: Services, v: Viewer): Record<string, unknown[]> {
  if (s.records.get(EFFECT_PRESET_TYPE)) return {};
  const rows = s.db
    .select()
    .from(effectPreset)
    .where(eq(effectPreset.campaignId, v.campaignId))
    .orderBy(effectPreset.seq)
    .all()
    .filter((r) => v.role === "dm" || (r.ownerPlayerId !== null && r.ownerPlayerId === v.playerId));
  return rows.length ? { [EFFECT_PRESET_TYPE]: rows } : {};
}

/** DM snapshot build time in ms: one warm-up, then the median of `runs`. */
export function dmBuildMs(s: Services, runs = 3): number {
  const active = s.db.select().from(campaign).where(eq(campaign.active, true)).get();
  if (!active) throw new Error("no active campaign");
  const v: Viewer = { connId: "dm", campaignId: active.id, role: "dm", playerId: null };
  const src = { db: s.db, presence: { list: () => [] } };
  s.records.snapshot(src, v);
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    s.records.snapshot(src, v);
    times.push(performance.now() - t0);
  }
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)] ?? 0;
}

/**
 * A loaded bundle (`loadBundle`, tests only: server code can't import fixtures) copied into
 * memory, start hooks run as startServer does.
 */
export async function servicesFromBundle(loaded: {
  config: Config;
  openDb(): Db;
  cleanup(): void;
}) {
  const file = loaded.openDb();
  // A WAL file's header makes a deserialized copy try to open a WAL: switch it off first.
  file.$client.run("PRAGMA journal_mode = DELETE");
  const bytes = file.$client.serialize();
  closeDb(file);
  const db: Db = openMemoryDb(bytes);
  const s = createServices({ config: loaded.config, db, log: silentLogger });
  for (const h of s.startHooks) await h.fn(s);
  return {
    s,
    cleanup() {
      db.$client.close(false);
      try {
        loaded.cleanup();
      } catch {
        // Windows may hold the temp dir a moment longer; the OS cleans it up.
      }
    },
  };
}

/** Exactly `n` chars: a unique prefix padded with `x` (max-length ASCII strings). */
const fill = (prefix: string, n: number) => (prefix + "x".repeat(n)).slice(0, n);

export const HEAVY = {
  players: 6,
  scenes: 30,
  tokens: 300,
  activeSceneTokens: 60,
  encounters: 20,
  logEntries: 100,
  pendingCards: 20,
  loot: 100,
  /** CHARX §12: one per PC + 10 NPC sheets, typical size. */
  sheets: 16,
  /**
   * CBTX §12: active effects (6 concentrations + 6 linked, 20 conditions, 4 secret, 4 hidden),
   * + MOD §12's 2 Bane on monsters.
   */
  effects: 42,
  /** Of those, players receive all but the secret and hidden ones. */
  playerEffects: 34,
  /** Soft-ended effects (Prev / undo history): never in a snapshot. */
  endedEffects: 20,
  /** MOD §12: custom effects with 2 max-length modifiers (6 linked, 4 secret, 2 Bane). */
  modEffects: 12,
  /** Of those, on PCs (the 6 linked "Bless"): the only ones players get modifiers of. */
  pcModEffects: 6,
  /** MOD §12: max-length presets: 10 campaign (5 customise a built-in), 1 per PC. */
  campaignPresets: 10,
  characterPresets: 6,
} as const;

/** MOD §12: the longest tier-1 modifiers (all abilities; signed max dice; flat via weapon). */
const MAX_DICE_MOD: Modifier = {
  kind: "dice",
  on: { roll: "save", abilities: ["str", "dex", "con", "int", "wis", "cha"] },
  dice: "4d12",
  sign: -1,
};
const MAX_FLAT_MOD: Modifier = { kind: "flat", on: { roll: "damage", via: "weapon" }, value: -10 };

/**
 * "Realistic heavy" (#163), on top of `session-sim`, commands only: 6 players / PCs, 30 scenes,
 * 300 tokens (60 on the active scene), 20 encounters (10 ended, 1 started with 46 combatants),
 * 100 game-log entries, 20 pending damage cards (+ 10 applied to 3 targets), 100 loot entries,
 * 42 active effects (12 with 2 modifiers), 16 effect presets (MOD §12).
 * Every name / label / text at its max length (ASCII).
 */
export function buildRealisticHeavy(s: Services): Record<string, number> {
  const db = s.db;
  const cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
  const DM: Actor = { role: "dm", playerId: null, campaignId: cid };
  const run = <T = unknown>(name: string, input: unknown, actor: Actor = DM): T =>
    s.commands.run(name, input, { actor }) as T;

  run("campaign.rename", { id: cid, name: fill("Campaign ", 60) });
  const existing = db.select().from(player).where(eq(player.campaignId, cid)).all().length;
  for (let i = existing; i < HEAVY.players; i++)
    run("player.add", { name: fill(`P${i + 1} `, 40) });
  const players = db.select().from(player).where(eq(player.campaignId, cid)).all();
  for (const [i, p] of players.entries()) {
    run("player.rename", { id: p.id, name: fill(`Player ${i + 1} `, 40) });
  }
  const asPlayer = (playerId: string): Actor => ({ role: "player", playerId, campaignId: cid });

  const img = db.select().from(asset).where(eq(asset.campaignId, cid)).all().at(-1)?.id as string;
  const abilities = { str: 18, dex: 14, con: 16, int: 10, wis: 12, cha: 8 };
  const attack = (n: string) => ({
    name: fill(n, 40),
    toHit: 7,
    damage: "2d6+5",
    damageType: "bludgeoning",
  });
  // Full-sheet stat-block fields (CHARX §8.1) at typical size: 4 attacks, skills, overrides.
  const attacks = (n: string) =>
    Array.from({ length: 4 }, (_, k) => ({
      ...attack(`${n}${k} `),
      id: fill(`atk-${n}${k}-`, 36),
    }));
  const sheetStats = {
    skills: { athletics: "proficient", perception: "proficient", stealth: "expertise" },
    overrides: {
      "passive.perception": { value: 16, note: fill("Alert ", 60) },
      "save.con": { value: 7, note: fill("Ring ", 60) },
    },
    spellcasting: { ability: "wis", slots: { "1": 4, "2": 3, "3": 2 } },
  };

  // One max-string PC per player (session-sim's Mira / Thorn stay; they get no token here).
  const pcIds = players
    .map((p, i) =>
      run<{ id: string }>("entities.create", {
        kind: "character",
        name: fill(`Hero ${i + 1} `, 60),
        portraitAssetId: img,
        ownerPlayerId: p.id,
        statBlock: {
          size: "medium",
          ac: 18,
          hpMax: 120,
          initBonus: 3,
          speed: 30,
          attacks: attacks(`Blade ${i + 1} `),
          abilities,
          saveProficiencies: ["str", "con"],
          ...sheetStats,
          level: 12,
          className: fill("Class ", 40),
          classes: [{ name: fill("Class ", 30), level: 12, hitDie: "d10" }],
          species: fill("Species ", 40),
        },
      }),
    )
    .map((r) => r.id);
  const monIds = Array.from({ length: 10 }, (_, i) =>
    run<{ id: string }>("entities.create", {
      kind: "monster",
      name: fill(`Monster ${i + 1} `, 60),
      portraitAssetId: img,
      statBlock: {
        size: "large",
        ac: 15,
        hpMax: 85,
        initBonus: 2,
        speed: 40,
        attacks: attacks(`Claw ${i + 1} `),
        abilities,
        saveProficiencies: ["dex"],
        ...sheetStats,
        cr: "5",
      },
    }),
  ).map((r) => r.id);

  // Creature sheets (CHARX §12): one per PC + one per custom monster. No CHARX command exists
  // in this core branch, so rows go straight to the table (`typicalSheet`).
  const now = "2026-01-01T00:00:00.000Z";
  for (const [i, id] of pcIds.entries()) {
    db.insert(creatureSheet)
      .values({
        ...typicalSheet(`PC${i + 1}`),
        entityId: id,
        campaignId: cid,
        ownerPlayerId: players[i]?.id ?? null,
        status: "ready",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
  for (const [i, id] of monIds.entries()) {
    db.insert(creatureSheet)
      .values({
        ...typicalSheet(`NPC${i + 1}`),
        entityId: id,
        campaignId: cid,
        ownerPlayerId: null,
        status: "ready",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  // Scenes: up to 30, 5 folders; a new one becomes the active battle scene.
  const mapAsset = db.select().from(scene).where(eq(scene.campaignId, cid)).get()?.mapAssetId;
  const folders = Array.from({ length: 5 }, (_, i) =>
    run<{ id?: string; sceneFolder?: { id: string } }>("map.createFolder", {
      name: fill(`Folder ${i + 1} `, 40),
    }),
  ).map((f) => f.sceneFolder?.id ?? f.id ?? null);
  const before = db.select().from(scene).where(eq(scene.campaignId, cid)).all().length;
  for (let i = before; i < HEAVY.scenes; i++) {
    run("map.createScene", {
      name: fill(`Scene ${i + 1} `, 60),
      mapAssetId: mapAsset,
      folderId: folders[i % folders.length],
    });
  }
  const scenes = db.select().from(scene).where(eq(scene.campaignId, cid)).all();
  const battle = scenes.at(-1)?.id as string;
  run("map.activateScene", { sceneId: battle });

  let cell = 0;
  const place = (sceneId: string, definitionId: string, owner: string | null) => {
    const c = cell++;
    return run<{ tokenId: string }>("map.placeToken", {
      sceneId,
      definitionId,
      col: c % 20,
      row: Math.floor(c / 20) % 14,
      name: fill(`T${c} `, 40),
      imageAssetId: img,
      ownerPlayerId: owner,
      hidden: false,
    });
  };
  // Active scene: 6 PCs + 4 × 10 monsters (bound at start) + 14 extra = 60.
  for (const [i, id] of pcIds.entries()) place(battle, id, players[i]?.id ?? null);
  for (const id of monIds) for (let q = 0; q < 4; q++) place(battle, id, null);
  while (cell < HEAVY.activeSceneTokens)
    place(battle, monIds[cell % monIds.length] as string, null);
  const tokenCount = () =>
    s.db.$client
      .query<{ n: number }, [string]>("SELECT count(*) AS n FROM token WHERE campaign_id = ?")
      .get(cid)?.n ?? 0;
  const others = scenes.filter((x) => x.id !== battle).map((x) => x.id);
  for (let i = 0; tokenCount() < HEAVY.tokens; i++) {
    place(others[i % others.length] as string, monIds[i % monIds.length] as string, null);
  }

  // Encounters: session-sim's encounter-1 + 10 ended + 8 planned + the started one = 20.
  const encBody = (name: string, entries: { definitionId: string; quantity: number }[]) => ({
    name: fill(name, 60),
    partyCharacterIds: pcIds,
    entries,
  });
  const smallEntries = monIds.slice(0, 4).map((definitionId) => ({ definitionId, quantity: 2 }));
  const encId = (r: { encounter?: { id: string }; id?: string }) =>
    (r.encounter?.id ?? r.id) as string;
  for (let i = 0; i < 10; i++) {
    const id = encId(run("cbt.createEncounter", encBody(`Ended ${i + 1} `, smallEntries)));
    run("cbt.start", { encounterId: id, sceneId: battle });
    run("cbt.end", { encounterId: id });
  }
  for (let i = 0; i < 8; i++)
    run("cbt.createEncounter", encBody(`Planned ${i + 1} `, smallEntries));
  const mainEntries = monIds.map((definitionId) => ({ definitionId, quantity: 4 }));
  const main = encId(run("cbt.createEncounter", encBody("Main ", mainEntries)));
  run("cbt.start", { encounterId: main, sceneId: battle });
  const cmb = db.select().from(combatant).where(eq(combatant.encounterId, main)).all();
  run("cbt.rollInitiative", { combatantIds: cmb.map((c) => c.id), public: true });
  run("cbt.nextTurn", { encounterId: main, expectedRound: 0, expectedTurnId: null });

  // Damage cards: 30 player attacks (each a public log line), 10 applied to 3 monsters.
  const pcsInFight = cmb.filter((c) => c.kind === "pc");
  const targets = cmb
    .filter((c) => c.kind === "monster")
    .slice(0, 3)
    .map((c) => ({ targetId: c.id, hit: true, multiplier: "normal" }));
  const cards = 10 + HEAVY.pendingCards;
  for (let i = 0; i < cards; i++) {
    const pc = pcsInFight[i % pcsInFight.length];
    const owner = db
      .select()
      .from(entity)
      .where(eq(entity.id, pc?.entityId as string))
      .get();
    const a = run<{ cardId: string }>(
      "cbt.attack",
      { attackerId: pc?.id, manual: [{ diceTotal: 15 }, { diceTotal: 8 }] },
      asPlayer(owner?.ownerPlayerId as string),
    );
    if (i < 10) {
      const row = db.select().from(notification).where(eq(notification.id, a.cardId)).get();
      const p = parseFullCard(row?.payload);
      run("cbt.applyCard", {
        cardId: a.cardId,
        toHitTotal: p.toHit.total,
        damageTotal: p.damage.total,
        targets,
      });
    }
  }

  // Effects (CBTX §12): no CBTX command exists in this core branch, so rows go straight to the
  // table. Max-length labels; play state on PCs and monsters for the leak scan (FR-CBTX-32).
  let fxN = 0;
  // UUID-length ids, like ctx.ids.
  const fxId = () => fill(`fx-${++fxN}-`, 36);
  const fx = (v: Partial<typeof effect.$inferInsert>) =>
    db
      .insert(effect)
      .values({
        id: fxId(),
        campaignId: cid,
        seq: effectSeqNext,
        kind: "condition",
        encounterId: main,
        createdAt: now,
        updatedAt: now,
        ...v,
      })
      .run();
  const monsters = cmb.filter((c) => c.kind === "monster");
  const pcCombatant = (entityId: string) => cmb.find((c) => c.entityId === entityId);
  const label = (n: string) => fill(n, 40);
  for (const [i, pcId] of pcIds.entries()) {
    const src = pcCombatant(pcId);
    const concId = fxId();
    const base = { sourceCombatantId: src?.id ?? null, sourceName: fill(`Hero ${i + 1} `, 60) };
    fx({
      ...base,
      id: concId,
      kind: "concentration",
      label: label(`Conc ${i} `),
      targetCharacterId: pcId,
      durationRounds: 10,
      endsRound: 11,
      anchorCombatantId: src?.id ?? null,
    });
    const other = pcIds[(i + 1) % pcIds.length] as string;
    fx({
      ...base,
      kind: "custom",
      label: label(`Bless ${i} `),
      targetCharacterId: other,
      concentrationId: concId,
      durationRounds: 10,
      endsRound: 11,
      anchorCombatantId: src?.id ?? null,
      // MOD §12: PC effects carry their modifiers to every player.
      modifiers: [MAX_DICE_MOD, MAX_FLAT_MOD],
      presetKey: "hunters-mark",
    });
  }
  const keys = ["prone", "frightened", "poisoned", "restrained", "blinded"] as const;
  for (const [i, m] of monsters.slice(0, 20).entries()) {
    fx({ condition: keys[i % keys.length], targetCombatantId: m.id });
  }
  // Applied from a campaign preset: `presetKey` = a UUID-length preset id (DM only).
  const mods = { modifiers: [MAX_DICE_MOD, MAX_FLAT_MOD], presetKey: fill("preset-hex-", 36) };
  for (const m of monsters.slice(20, 24)) {
    fx({ kind: "custom", label: label("Hex "), targetCombatantId: m.id, secret: true, ...mods });
  }
  for (const m of monsters.slice(28, 30)) {
    fx({ kind: "custom", label: label("Bane "), targetCombatantId: m.id, ...mods });
  }
  for (const m of monsters.slice(24, 28)) {
    fx({ condition: "stunned", targetCombatantId: m.id, hidden: true });
  }
  for (const m of monsters.slice(0, HEAVY.endedEffects)) {
    fx({
      condition: "grappled",
      targetCombatantId: m.id,
      endedAt: now,
      endedReason: "expired",
      endedRound: 1,
      endedTurnId: m.id,
    });
  }
  // Effect presets (MOD §12): no MOD command exists in this core branch, so rows go straight
  // to the table. Max-length names, notes and 6 max-length modifiers each.
  let prN = 0;
  const preset = (v: Partial<typeof effectPreset.$inferInsert>) =>
    db
      .insert(effectPreset)
      .values({
        id: fill(`pr-${++prN}-`, 36),
        campaignId: cid,
        seq: effectPresetSeqNext,
        name: label(`Preset ${prN} `),
        modifiers: Array.from({ length: 6 }, (_, k) => (k % 2 ? MAX_FLAT_MOD : MAX_DICE_MOD)),
        durationRounds: 100,
        concentration: true,
        note: fill(`Note ${prN} `, 200),
        createdAt: now,
        updatedAt: now,
        ...v,
      })
      .run();
  const customised = ["bless", "bane", "rage", "hunters-mark", "guidance"];
  for (let i = 0; i < HEAVY.campaignPresets; i++) preset({ key: customised[i] ?? null });
  for (const [i, pcId] of pcIds.entries()) {
    preset({ characterId: pcId, ownerPlayerId: players[i]?.id ?? null, concentration: false });
  }

  db.update(combatant)
    .set({ tempHp: 999 })
    .where(
      inArray(
        combatant.id,
        monsters.map((m) => m.id),
      ),
    )
    .run();
  db.update(entity)
    .set({ tempHp: 999, deathSuccesses: 2, deathFailures: 1 })
    .where(inArray(entity.id, pcIds))
    .run();

  // Game log: fill up to 100 entries with max-label public DM rolls.
  const logCount = () =>
    s.db.$client
      .query<{ n: number }, [string]>(
        "SELECT count(*) AS n FROM game_log_entry WHERE campaign_id = ?",
      )
      .get(cid)?.n ?? 0;
  for (let i = 0; logCount() < HEAVY.logEntries; i++) {
    run("dice.roll", {
      expression: "8d6+5",
      mode: "normal",
      category: "damage",
      label: fill(`Roll ${i + 1} `, 60),
      actor: { entityId: monIds[0] },
      public: true,
    });
  }

  // Loot: 100 entries, max text, coins.
  for (let i = 0; i < HEAVY.loot; i++) {
    run("loot.add", { text: fill(`Loot ${i + 1} `, 200), gp: 1000 + i, sp: 50, cp: 7 });
  }

  const n = (t: string) =>
    s.db.$client
      .query<{ n: number }, [string]>(`SELECT count(*) AS n FROM ${t} WHERE campaign_id = ?`)
      .get(cid)?.n ?? 0;
  return {
    players: n("player"),
    scenes: n("scene"),
    tokens: n("token"),
    encounters: n("encounter"),
    combatants: cmb.length,
    logEntries: n("game_log_entry"),
    pendingCards:
      s.db.$client
        .query<{ n: number }, [string]>(
          "SELECT count(*) AS n FROM notification WHERE campaign_id = ? AND state = 'pending'",
        )
        .get(cid)?.n ?? 0,
    loot: n("loot_entry"),
    sheets: n("creature_sheet"),
    presets: n("effect_preset"),
    modEffects:
      s.db.$client
        .query<{ n: number }, [string]>(
          "SELECT count(*) AS n FROM effect WHERE campaign_id = ? AND ended_at IS NULL AND modifiers <> '[]'",
        )
        .get(cid)?.n ?? 0,
    effects:
      s.db.$client
        .query<{ n: number }, [string]>(
          "SELECT count(*) AS n FROM effect WHERE campaign_id = ? AND ended_at IS NULL",
        )
        .get(cid)?.n ?? 0,
  };
}

/**
 * A typical creature-sheet row (CHARX §8.2, §12: typical 5–15 KB): 10 spells, 8 features,
 * 20 items, mid-length texts. Max-length names; ASCII.
 */
export function typicalSheet(tag: string) {
  const id = (k: string, i: number) => fill(`${tag}-${k}${i}-`, 36);
  return {
    locked: false,
    background: fill(`Background ${tag} `, 40),
    alignment: fill("Neutral good ", 40),
    proficiencyNotes: {
      armor: fill("Light, medium, shields ", 100),
      weapons: fill("Simple, martial ", 100),
      tools: fill("Thieves' tools ", 60),
      languages: fill("Common, Elvish ", 60),
    },
    spells: Array.from({ length: 10 }, (_, i) => ({
      id: id("s", i),
      name: fill(`Spell ${i} `, 60),
      level: i % 4,
      prepared: true,
      concentration: i % 3 === 0,
      ritual: false,
      roll: "attack",
      damage: "4d6",
      effect: "damage",
      damageType: "radiant",
      notes: fill("Spell notes ", 60),
    })),
    features: Array.from({ length: 8 }, (_, i) => ({
      id: id("f", i),
      name: fill(`Feature ${i} `, 60),
      source: fill("Class ", 40),
      text: fill(`Feature text ${i} `, 200),
      usesMax: 2,
      used: 1,
      reset: "short",
    })),
    items: Array.from({ length: 20 }, (_, i) => ({
      id: id("i", i),
      name: fill(`Item ${i} `, 60),
      qty: i + 1,
      equipped: i < 4,
      notes: fill("Item notes ", 60),
    })),
    notes: fill(`Notes ${tag} `, 1000),
    slotsUsed: { "1": 2, "2": 1 },
    hitDiceUsed: { d10: 3 },
  };
}

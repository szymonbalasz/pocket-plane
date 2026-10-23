// REM / HOLD §13 fixtures (FR-REM-27, -28, FR-HOLD-35, -36, -40): bundle `reminders-strongholds`
// from empty, deterministic; `session-sim-13` = session-sim-12 + the RS units, session-sim-12-safe
// (pot, wallets, sheets and party rows unchanged); no published bastion name in the RS fixtures.
import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { closeDb } from "@server/db/client";
import {
  campaign,
  creatureSheet,
  entity,
  lootEntry,
  partyItem,
  player,
  reminder,
  stronghold,
} from "@server/db/schema";
import { partyPot, storesCoins, wallets } from "@server/features/party-loot/rows";
import { asc, eq } from "drizzle-orm";
import { loadBundle } from "../../index";
import { REM_MIRA_CHARM } from "../reminders/rem-mira-charm";
import { REM_PARTY_TEXT } from "../reminders/rem-party";
import { REM_THORN_OWN } from "../reminders/rem-thorn-own";
import { REM_SECRET_THORN } from "../reminders/rem-thorn-secret";
import { GREYSTONE } from "./hold-greystone";
import { REM_SECRET_VAULT, STEAM_ROOMS_TEXT } from "./hold-greystone-reminders";
import { HOLD_SECRET_GEM } from "./hold-greystone-stores";
import { TOWER } from "./hold-tower-secret";

const dirs: string[] = [];
afterAll(() => {
  Bun.gc(true);
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // Windows: a closed SQLite handle can linger until GC; a leftover OS temp dir is harmless.
    }
  }
});

async function read(bundle: string) {
  const r = await loadBundle(bundle);
  dirs.push(r.dir);
  const db = r.openDb();
  const cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
  const out = {
    manifest: r.manifest,
    cid,
    players: Object.fromEntries(
      db
        .select()
        .from(player)
        .all()
        .map((p) => [p.name, p.id]),
    ),
    chars: Object.fromEntries(
      db
        .select()
        .from(entity)
        .where(eq(entity.campaignId, cid))
        .all()
        .map((e) => [e.name, e.id]),
    ),
    reminders: db.select().from(reminder).orderBy(asc(reminder.seq)).all(),
    holds: db.select().from(stronghold).orderBy(asc(stronghold.seq)).all(),
    items: db.select().from(partyItem).orderBy(asc(partyItem.seq)).all(),
    entries: db.select().from(lootEntry).orderBy(asc(lootEntry.seq)).all(),
    sheets: db.select().from(creatureSheet).all(),
    pot: partyPot(db, cid),
    wallets: wallets(db, cid),
    storesCoins: storesCoins(db, cid),
  };
  closeDb(db);
  return out;
}

describe("REM / HOLD §13 fixtures", () => {
  test("reminders-strongholds loads from empty (FR-REM-28, FR-HOLD-36)", async () => {
    const r = await read("reminders-strongholds");
    expect(r.manifest.status).toBe("complete");
    const mira = r.chars.Mira as string;
    const thorn = r.chars.Thorn as string;
    // FR-REM-27: four REM units + two linked by `hold-greystone-reminders`.
    const byText = (s: string) => r.reminders.find((x) => x.text.startsWith(s));
    expect(r.reminders).toHaveLength(6);
    expect(byText(REM_PARTY_TEXT)).toMatchObject({ characterId: null, dmOnly: false, rolls: [] });
    expect(byText(REM_MIRA_CHARM)).toMatchObject({
      characterId: mira,
      ownerPlayerId: r.players["Player 1"],
      createdByPlayerId: null,
    });
    expect(byText(REM_MIRA_CHARM)?.rolls.map((x) => [x.label, x.expression, x.category])).toEqual([
      ["Charm", "1d4", "saving-throw"],
    ]);
    expect(byText(REM_THORN_OWN)).toMatchObject({
      characterId: thorn,
      ownerPlayerId: r.players["Player 2"],
      createdByPlayerId: r.players["Player 2"],
    });
    expect(byText(REM_SECRET_THORN)).toMatchObject({ characterId: thorn, dmOnly: true });
    // Creation order holds under the fixed clock: strictly increasing stamps (FR-REM-07).
    const stamps = r.reminders.map((x) => x.createdAt);
    expect([...stamps].sort()).toEqual(stamps);
    expect(new Set(stamps).size).toBe(stamps.length);

    // FR-HOLD-35: Greystone shown, Tower DM-only.
    const [grey, tower] = r.holds;
    expect([grey?.name, grey?.dmOnly, grey?.defenders, grey?.notes]).toEqual([
      GREYSTONE.name,
      false,
      12,
      GREYSTONE.notes,
    ]);
    const fac = Object.fromEntries((grey?.facilities ?? []).map((f) => [f.name, f]));
    expect(Object.keys(fac)).toEqual([
      "Forge Hall",
      "Herb Beds",
      "Map Room",
      "Old Bathhouse",
      "Steam Rooms",
      GREYSTONE.vault,
    ]);
    expect(fac["Steam Rooms"]?.replacesId).toBe(fac["Old Bathhouse"]?.id as string);
    expect(fac["Forge Hall"]).toMatchObject({
      upkeep: 5,
      incomeDice: "2d6",
      order: "Craft: arrows",
    });
    expect(fac[GREYSTONE.vault]?.dmOnly).toBe(true);
    expect(grey?.staff.map((m) => [m.name, m.wage, m.dmOnly])).toEqual([
      ["Brenna", 2, false],
      ["Tobin", 1, false],
      [GREYSTONE.spy, 5, true],
    ]);
    expect(grey?.staff[0]?.facilityId).toBe(fac["Forge Hall"]?.id as string);
    expect(grey?.staff[1]?.facilityId).toBe(fac["Herb Beds"]?.id as string);
    expect([tower?.name, tower?.dmOnly, tower?.notes]).toEqual([TOWER.name, true, TOWER.notes]);
    // Linked reminders: Steam Rooms visible, the vault's hidden with it (FR-REM-06).
    expect(byText(STEAM_ROOMS_TEXT)).toMatchObject({
      strongholdId: grey?.id,
      facilityId: fac["Steam Rooms"]?.id,
      linkHidden: false,
      source: "Greystone Keep: Steam Rooms",
    });
    expect(byText(REM_SECRET_VAULT)).toMatchObject({
      facilityId: fac[GREYSTONE.vault]?.id,
      linkHidden: true,
    });

    // Stores (FR-LOOT-36): Greystone's three rows (the gem DM-only), Tower's item hidden with it.
    const stores = (id: string | undefined) =>
      r.items
        .filter((i) => i.strongholdId === id)
        .map((i) => [i.name, i.qty, i.dmOnly, i.storesHidden]);
    expect(stores(grey?.id)).toEqual([
      ["Rope", 2, false, false],
      ["Arrows", 40, false, false],
      [HOLD_SECRET_GEM, 1, true, false],
    ]);
    expect(stores(tower?.id)).toEqual([[TOWER.item, 1, false, true]]);
    const coin = Object.fromEntries(r.storesCoins.map((c) => [c.strongholdId, [c.gp, c.hidden]]));
    expect(coin).toEqual({
      [grey?.id as string]: [120, undefined],
      [tower?.id as string]: [5, true],
    });
    // `hold-tower-move`: +5 gp on party-board's pot (5 pp, 30 gp); the row is hidden-Stores.
    expect([r.pot.pp, r.pot.gp]).toEqual([5, 35]);
    const last = r.entries.at(-1);
    expect([last?.fromKind, last?.toKind, last?.gp, last?.storesHidden]).toEqual([
      "stores",
      "party",
      5,
      true,
    ]);
    // FR-LOOT-36: the gem's add entry carries `item_hidden`.
    expect(r.entries.find((e) => e.text === HOLD_SECRET_GEM)?.itemHidden).toBe(true);
  });

  test("reminders-strongholds deterministic: two loads give identical IDs and rows", async () => {
    const a = await read("reminders-strongholds");
    const b = await read("reminders-strongholds");
    expect(b.reminders).toEqual(a.reminders);
    expect(b.holds).toEqual(a.holds);
    expect(b.items).toEqual(a.items);
    expect(b.entries).toEqual(a.entries);
  });

  test("FR-HOLD-36 session-sim-13 = session-sim-12 + the RS units; pot, wallets, sheets and party rows unchanged", async () => {
    const base = await read("session-sim-12");
    const sim = await read("session-sim-13");
    expect(sim.manifest.status).toBe("complete");
    expect(sim.manifest.fixtures.slice(-8)).toEqual([
      "rem-party",
      "rem-mira-charm",
      "rem-thorn-own",
      "rem-thorn-secret",
      "hold-greystone",
      "hold-greystone-reminders",
      "hold-greystone-stores",
      "hold-tower-secret",
    ]);
    expect(sim.manifest.fixtures).not.toContain("hold-tower-move");
    expect(sim.pot).toEqual(base.pot);
    expect(sim.wallets).toEqual(base.wallets);
    expect(JSON.stringify(sim.sheets)).toBe(JSON.stringify(base.sheets));
    const party = (rows: typeof base.items) => rows.filter((i) => i.strongholdId === null);
    expect(party(sim.items)).toEqual(party(base.items));
    expect(sim.reminders).toHaveLength(6);
    expect(sim.holds.map((h) => h.name)).toEqual([GREYSTONE.name, TOWER.name]);
  });

  test("FR-HOLD-40 licence check: no 2024 bastion facility name in the RS fixtures", () => {
    const catalogue = [
      "Arcane Study",
      "Armory",
      "Barrack",
      "Garden",
      "Library",
      "Sanctuary",
      "Smithy",
      "Storehouse",
      "Workshop",
      "Archive",
      "Gaming Hall",
      "Greenhouse",
      "Laboratory",
      "Sacristy",
      "Scriptorium",
      "Stable",
      "Teleportation Circle",
      "Theater",
      "Training Area",
      "Trophy Room",
      "Meditation Chamber",
      "Menagerie",
      "Observatory",
      "Pub",
      "Reliquary",
      "Demiplane",
      "Guildhall",
      "Sanctum",
      "War Room",
    ];
    const hits: string[] = [];
    for (const dir of ["strongholds", "reminders"]) {
      const path = join(import.meta.dir, "..", dir);
      for (const f of readdirSync(path)) {
        if (f.endsWith(".test.ts")) continue;
        const text = readFileSync(join(path, f), "utf8");
        for (const name of catalogue)
          if (new RegExp(`\\b${name}\\b`).test(text)) hits.push(`${f}: ${name}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

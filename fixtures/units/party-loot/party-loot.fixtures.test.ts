import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { closeDb } from "@server/db/client";
import { campaign, entity, lootEntry, notification } from "@server/db/schema";
import { partyPot, wallets } from "@server/features/party-loot/rows";
import { COINS, type Coins } from "@shared/party-loot/schemas";
import { asc } from "drizzle-orm";
import { loadBundle } from "../../index";
import { SECOND_LOOT_TEXT } from "./loot-second";

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

const c = (x: Partial<Coins>): Coins => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...x });
const coinsOnly = ({ cp, sp, ep, gp, pp }: Coins): Coins => ({ cp, sp, ep, gp, pp });

async function loaded() {
  const r = await loadBundle("party-loot");
  dirs.push(r.dir);
  const db = r.openDb();
  const camps = Object.fromEntries(
    db
      .select()
      .from(campaign)
      .all()
      .map((x) => [x.name, x.id]),
  );
  const chars = Object.fromEntries(
    db
      .select()
      .from(entity)
      .all()
      .map((x) => [x.name, x.id]),
  );
  const fixture = camps["Fixture Campaign"] as string;
  const second = camps["Second Campaign"] as string;
  const out = {
    manifest: r.manifest,
    fixture,
    second,
    chars,
    entries: db.select().from(lootEntry).orderBy(asc(lootEntry.seq)).all(),
    notes: db.select().from(notification).orderBy(asc(notification.seq)).all(),
    pot: partyPot(db, fixture),
    secondPot: partyPot(db, second),
    wallets: wallets(db, fixture),
    active: db
      .select()
      .from(campaign)
      .all()
      .find((x) => x.active)?.id,
  };
  closeDb(db);
  return out;
}

describe("party-loot fixtures (LOOT §13, FR-LOOT-20)", () => {
  test("FR-LOOT-20 party-loot bundle: loot-1, loot-wallets, loot-second contents", async () => {
    const r = await loaded();
    expect(r.manifest.fixtures).toEqual([
      "campaign",
      "player-1",
      "player-2",
      "char-mira",
      "char-thorn",
      "campaign-second",
      "loot-1",
      "loot-wallets",
      "loot-second",
    ]);
    expect(r.active).toBe(r.fixture);
    const mine = r.entries.filter((e) => e.campaignId === r.fixture);
    expect(mine.map((e) => [e.kind, e.text, e.editedAt !== null])).toEqual([
      ["loot", "Goblin chief's pouch", false],
      ["loot", "Potion of healing ×2", false],
      ["loot", "Silver idol", true],
      ["loot", "", false],
      ["loot", "Paid the ferryman", false],
      ["move", "", false],
      ["move", "", false],
      ["move", "Rations", false],
      ["move", "Rope", false],
    ]);
    expect(coinsOnly(mine[2] as Coins)).toEqual(c({ gp: 50 }));
    expect(coinsOnly(r.pot)).toEqual(c({ pp: 5, gp: 30 }));
    const w = Object.fromEntries(r.wallets.map((x) => [x.characterId, coinsOnly(x)]));
    expect(w).toEqual({
      [r.chars.Mira as string]: c({ gp: 21 }),
      [r.chars.Thorn as string]: c({ gp: 8, sp: 30 }),
    });
    // Conservation: pot + wallets = Σ loot + net `world` moves (Rope: −1 gp).
    const held = COINS.map((k) => r.pot[k] + r.wallets.reduce((n, x) => n + x[k], 0));
    expect(held).toEqual(
      COINS.map((k) => (k === "pp" ? 5 : k === "gp" ? 59 : k === "sp" ? 30 : 0)),
    );

    const notes = (cid: string) => r.notes.filter((n) => n.campaignId === cid).map((n) => n.text);
    expect(notes(r.fixture)).toEqual([
      "Party loot: Goblin chief's pouch (12 gp, 30 sp)",
      "Party loot: Potion of healing ×2",
      "Party loot: Silver idol (500 gp)",
      "Party loot: 5 pp",
    ]);
    expect(notes(r.second)).toEqual([`Party loot: ${SECOND_LOOT_TEXT} (1 gp)`]);
    expect(coinsOnly(r.secondPot)).toEqual(c({ gp: 1 }));
  });

  test("FR-LOOT-20 deterministic: two loads give identical IDs and rows", async () => {
    const a = await loaded();
    const b = await loaded();
    expect(b.entries).toEqual(a.entries);
    expect(b.notes).toEqual(a.notes);
    expect(b.wallets).toEqual(a.wallets);
  });
});

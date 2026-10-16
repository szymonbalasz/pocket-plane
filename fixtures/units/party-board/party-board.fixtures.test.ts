// PARTY §13 fixtures (FR-PARTY-28): bundle `party-board` contents from empty (incl. the
// `handout-shared` notifications, FR-PARTY-06), deterministic, and
// the units as patches on `session-sim` (seams S10: no `creature-sheet` field changes in P core;
// P4 adds the Torch ×2 move to Thorn's `items`).
import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { closeDb } from "@server/db/client";
import {
  asset,
  campaign,
  creatureSheet,
  handout,
  lootEntry,
  notification,
  partyItem,
  player,
} from "@server/db/schema";
import { loadInProcess } from "@server/features/fixtures-adapters/loader";
import { partyPot } from "@server/features/party-loot/rows";
import { asc } from "drizzle-orm";
import { bundles } from "../../bundles";
import { library, loadBundle } from "../../index";
import { units } from "../index";
import { HANDOUTS_1 } from "./handouts-1";
import { SECOND_HANDOUT_TITLE, SECOND_ITEM_NAME } from "./party-second";

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

type Loaded = Awaited<ReturnType<typeof loadBundle>>;

function read(r: Loaded) {
  dirs.push(r.dir);
  const db = r.openDb();
  const camps = Object.fromEntries(
    db
      .select()
      .from(campaign)
      .all()
      .map((x) => [x.name, x.id]),
  );
  const out = {
    manifest: r.manifest,
    camps,
    active: db
      .select()
      .from(campaign)
      .all()
      .find((x) => x.active)?.id,
    players: Object.fromEntries(
      db
        .select()
        .from(player)
        .all()
        .map((p) => [p.id, p.name]),
    ),
    assets: db.select().from(asset).orderBy(asc(asset.seq)).all(),
    handouts: db.select().from(handout).orderBy(asc(handout.seq)).all(),
    items: db.select().from(partyItem).orderBy(asc(partyItem.seq)).all(),
    entries: db.select().from(lootEntry).orderBy(asc(lootEntry.seq)).all(),
    notes: db.select().from(notification).orderBy(asc(notification.seq)).all(),
    sheets: db.select().from(creatureSheet).all(),
    pot: partyPot(db, camps["Fixture Campaign"] as string),
  };
  closeDb(db);
  return out;
}

describe("party-board fixtures (PARTY §13, FR-PARTY-28)", () => {
  test("FR-PARTY-28 party-board bundle from empty: handouts, shares, images, items, log rows, second campaign", async () => {
    const r = read(await loadBundle("party-board"));
    expect(r.manifest.fixtures).toEqual(
      expect.arrayContaining([
        "campaign",
        "player-1",
        "player-2",
        "images",
        "char-mira",
        "char-thorn",
        "char-mira-full",
        "campaign-second",
        "loot-1",
        "loot-wallets",
        "handout-images",
        "handouts-1",
        "party-items-1",
        "party-second",
      ]),
    );
    const fixture = r.camps["Fixture Campaign"] as string;
    const second = r.camps["Second Campaign"] as string;
    expect(r.active).toBe(fixture);
    const named = (n: string) => r.assets.find((a) => a.name === n);
    expect(named("thieves-map")?.campaignId).toBe(fixture);
    expect(named("wanted-poster")?.campaignId).toBe(fixture);

    const mine = r.handouts.filter((x) => x.campaignId === fixture);
    const share = (x: (typeof mine)[number]) =>
      x.sharedWith.mode === "players"
        ? x.sharedWith.playerIds.map((id) => r.players[id])
        : x.sharedWith.mode;
    expect(mine.map((x) => [x.title, share(x), x.imageAssetIds.length])).toEqual([
      ["Mayor's Letter", "all", 0],
      [`${HANDOUTS_1.p1Only} Thieves' Map`, ["Player 1"], 1],
      ["Secret Orders", "none", 0],
      ["Old Bounty", "none", 0],
      ["Ship Manifest", "none", 0],
    ]);
    expect(mine[0]?.body.split("\n")).toHaveLength(3);
    expect(mine[1]?.imageAssetIds).toEqual([named("thieves-map")?.id as string]);
    expect(mine.map((x) => x.body).join()).toContain(HANDOUTS_1.secret);
    // h4 was shared (sharedAt set), then unshared; h3 / h5 never shared.
    expect(mine.map((x) => x.sharedAt !== null)).toEqual([true, true, false, true, false]);
    // wanted-poster is used by no handout (walkthrough step 3).
    expect(r.handouts.flatMap((x) => x.imageAssetIds)).not.toContain(named("wanted-poster")?.id);

    expect(
      r.items.filter((i) => i.campaignId === fixture).map((i) => [i.name, i.qty, i.notes]),
    ).toEqual([
      ["Potion of healing", 2, ""],
      ["Torch", 10, ""],
      ["Rope (50 ft)", 1, ""],
    ]);
    const itemRows = r.entries.filter((e) => e.campaignId === fixture && e.kind === "item");
    expect(itemRows.map((e) => [e.fromKind, e.toKind, e.text, e.qty, e.gp])).toEqual([
      ["world", "party", "Potion of healing", 2, 0],
      ["world", "party", "Torch", 10, 0],
      ["world", "party", "Rope (50 ft)", 1, 0],
    ]);
    // LOOT's pot is unaffected by item rows: 5 pp, 30 gp.
    expect([r.pot.pp, r.pot.gp, r.pot.sp, r.pot.ep, r.pot.cp]).toEqual([5, 30, 0, 0, 0]);
    const notes = (cid: string) => r.notes.filter((n) => n.campaignId === cid).map((n) => n.text);
    // FR-PARTY-06: h1 all, h2 player-1, h4 all; h4's row and id stay after the unshare.
    const shared = r.notes.filter((n) => n.campaignId === fixture && n.kind === "handout-shared");
    expect(
      shared.map((n) => [
        n.text,
        n.audience,
        n.audiencePlayerId && r.players[n.audiencePlayerId],
        n.payload,
        n.state,
      ]),
    ).toEqual([
      ["New handout: Mayor's Letter", "all", null, { handoutId: mine[0]?.id }, "info"],
      [
        `New handout: ${HANDOUTS_1.p1Only} Thieves' Map`,
        "player",
        "Player 1",
        { handoutId: mine[1]?.id },
        "info",
      ],
      ["New handout: Old Bounty", "all", null, { handoutId: mine[3]?.id }, "info"],
    ]);
    expect(notes(fixture).slice(-3)).toEqual([
      "Party loot: Potion of healing ×2",
      "Party loot: Torch ×10",
      "Party loot: Rope (50 ft) ×1",
    ]);

    expect(r.handouts.filter((x) => x.campaignId === second).map((x) => x.title)).toEqual([
      SECOND_HANDOUT_TITLE,
    ]);
    expect(r.items.filter((i) => i.campaignId === second).map((i) => i.name)).toEqual([
      SECOND_ITEM_NAME,
    ]);
    expect(notes(second)).toContain(`Party loot: ${SECOND_ITEM_NAME} ×1`);
    expect(notes(second)).toContain(`New handout: ${SECOND_HANDOUT_TITLE}`);
  });

  test("FR-PARTY-28 deterministic: two loads give identical IDs and rows", async () => {
    const a = read(await loadBundle("party-board"));
    const b = read(await loadBundle("party-board"));
    expect(b.handouts).toEqual(a.handouts);
    expect(b.items).toEqual(a.items);
    expect(b.entries).toEqual(a.entries);
    expect(b.notes).toEqual(a.notes);
  });

  test("FR-PARTY-28 compose (seams S10): PARTY units on session-sim leave every creature-sheet byte-identical", async () => {
    const party = ["handout-images", "handouts-1", "party-items-1", "party-second"];
    const lib = {
      fixtures: units,
      bundles: [
        ...bundles,
        { name: "session-sim-party", includes: ["session-sim"], fixtures: party },
      ],
    };
    const base = read(await loadBundle("session-sim"));
    const composed = read(await loadInProcess(lib, "session-sim-party", {}));
    expect(composed.manifest.fixtures).toEqual(expect.arrayContaining(party));
    const byId = (rows: typeof base.sheets) =>
      Object.fromEntries(rows.map((s) => [s.entityId, JSON.stringify(s)]));
    expect(byId(composed.sheets)).toEqual(byId(base.sheets));
    expect(composed.handouts.length).toBeGreaterThan(0);
    expect(library.bundles.some((b) => b.name === "party-board")).toBe(true);
  });
});

// CMP §13 fixtures: bundle `compendium` from empty, deterministic, and the `cmp-*` units as
// patches on `session-sim` (seams S10: they write only compendium rows and imported definitions;
// `char-mira` / `char-thorn` untouched).
import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { closeDb } from "@server/db/client";
import {
  campaign,
  compendiumEntry,
  compendiumSource,
  creatureSheet,
  entity,
} from "@server/db/schema";
import { loadInProcess } from "@server/features/fixtures-adapters/loader";
import { FeatureBody } from "@shared/compendium/schemas";
import { TriggerRule } from "@shared/effect-modifiers/triggers";
import { asc } from "drizzle-orm";
import { bundles } from "../../bundles";
import { library, loadBundle } from "../../index";
import { units } from "../index";
import { DIVINE_FURY_RULE, HOUSE_FIREBALL_NAME, SECRET_ITEM_NAME } from "./cmp-homebrew";
import { SECOND_HOMEBREW_NAME } from "./cmp-homebrew-second";

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
  ) as Record<string, string>;
  const out = {
    manifest: r.manifest,
    camps,
    active: db
      .select()
      .from(campaign)
      .all()
      .find((x) => x.active)?.id,
    sources: db.select().from(compendiumSource).all(),
    entries: db.select().from(compendiumEntry).orderBy(asc(compendiumEntry.name)).all(),
    entities: db.select().from(entity).orderBy(asc(entity.id)).all(),
    sheets: db.select().from(creatureSheet).all(),
  };
  closeDb(db);
  return out;
}

const CMP_UNITS = ["cmp-srd-mini", "cmp-homebrew", "cmp-homebrew-second"];

describe("compendium fixtures (CMP §13)", () => {
  test("CMP §13 compendium bundle from empty: mini source, homebrew per campaign, Divine Fury inline", async () => {
    const r = read(await loadBundle("compendium"));
    expect(r.manifest.fixtures).toEqual(
      expect.arrayContaining([
        "campaign",
        "player-1",
        "player-2",
        "campaign-second",
        "char-mira",
        "char-thorn",
        "enemy-1",
        "enemy-2",
        "enemy-custom",
        "images",
        "battlemap",
        "encounter-1",
        ...CMP_UNITS,
      ]),
    );
    const fixture = r.camps["Fixture Campaign"] as string;
    const second = r.camps["Second Campaign"] as string;
    expect(r.active).toBe(fixture);
    expect(r.sources.map((s) => [s.key, s.version])).toEqual([["srd-5.1", "mini"]]);

    const imported = r.entries.filter((e) => e.campaignId === null);
    const names = (kind: string) =>
      imported
        .filter((e) => e.kind === kind)
        .map((e) => e.name)
        .sort();
    expect(names("monster")).toEqual(["Adult Red Dragon", "Goblin", "Hobgoblin", "Ogre", "Wolf"]);
    expect(names("spell")).toEqual(["Bless", "Cure Wounds", "Fireball", "Hunter's Mark"]);
    expect(names("item")).toEqual([
      "Bag of Holding",
      "Chain mail",
      "Longsword",
      "Potion of Healing",
    ]);
    expect(names("condition")).toEqual(["Grappled", "Poisoned", "Prone"]);
    expect(names("feature")).toEqual(
      expect.arrayContaining(["Sneak Attack", "Rage", "Path of the Berserker"]),
    );
    // Monster definitions: global, linked, next to the fixture goblin / wolf (OQ-CMP-22).
    const defs = r.entities.filter((e) => e.source === "srd-5.1");
    expect(defs).toHaveLength(5);
    for (const e of imported.filter((x) => x.kind === "monster")) {
      expect(defs.map((d) => d.id)).toContain(e.definitionId as string);
    }
    expect(
      r.entities
        .filter((e) => e.source === "fixture")
        .map((e) => e.name)
        .sort(),
    ).toEqual(["Goblin", "Wolf"]);

    const homebrew = (cid: string) =>
      r.entries
        .filter((e) => e.campaignId === cid)
        .map((e) => [e.kind, e.name, e.shared, e.source]);
    expect(homebrew(fixture)).toEqual([
      ["item", SECRET_ITEM_NAME, false, null],
      ["feature", "Divine Fury", true, null],
      ["spell", HOUSE_FIREBALL_NAME, false, null],
      ["item", "Moonblade Shard", true, null],
    ]);
    expect(homebrew(second)).toEqual([["item", SECOND_HOMEBREW_NAME, true, null]]);

    // Clone: independent copy of Fireball (no link), own text.
    const house = r.entries.find((e) => e.name === HOUSE_FIREBALL_NAME);
    const srdFireball = imported.find((e) => e.name === "Fireball");
    expect(house?.derivedFromId).toBeNull();
    expect(house?.facets).toEqual(srdFireball?.facets);
    expect(house?.line).toBe("Level 3 evocation");

    // Divine Fury (#209): Barbarian 3, own words, no subclass, trigger inline and MOD-valid.
    const fury = r.entries.find((e) => e.name === "Divine Fury");
    expect(fury?.facets).toEqual({ className: "Barbarian", level: 3 });
    const body = FeatureBody.parse(fury?.body);
    expect(body.presetKey).toBeUndefined();
    expect(TriggerRule.parse(body.preset)).toEqual(DIVINE_FURY_RULE);
    expect(fury?.searchText).not.toContain("ownturn");
  });

  test("CMP §13 deterministic: two loads give identical IDs and rows", async () => {
    const a = read(await loadBundle("compendium"));
    const b = read(await loadBundle("compendium"));
    expect(b.entries).toEqual(a.entries);
    expect(b.entities).toEqual(a.entities);
    expect(b.sources).toEqual(a.sources);
    expect(b.manifest.records).toEqual(a.manifest.records);
  });

  test("CMP §13 compose (seams S10): cmp units on session-sim leave every entity and creature-sheet of the campaigns unchanged", async () => {
    const lib = {
      fixtures: units,
      bundles: [
        ...bundles,
        { name: "session-sim-cmp", includes: ["session-sim"], fixtures: CMP_UNITS },
      ],
    };
    const base = read(await loadBundle("session-sim"));
    const composed = read(await loadInProcess(lib, "session-sim-cmp", {}));
    expect(composed.manifest.fixtures).toEqual(expect.arrayContaining(CMP_UNITS));
    const campaignRows = (rows: typeof base.entities) =>
      rows.filter((e) => e.campaignId !== null).map((e) => JSON.stringify(e));
    expect(campaignRows(composed.entities)).toEqual(campaignRows(base.entities));
    const byId = (rows: typeof base.sheets) =>
      Object.fromEntries(rows.map((s) => [s.entityId, JSON.stringify(s)]));
    expect(byId(composed.sheets)).toEqual(byId(base.sheets));
    expect(composed.entries.length).toBe(60);
    expect(library.bundles.some((x) => x.name === "compendium")).toBe(true);
  });
});

// FR-SHARE-01–10 `share.toLog`, in-process: who may share what, the text the server builds, public
// whatever the DM's setting, the fold of older shares.
import { describe, expect, test } from "bun:test";
import { CHARX_INTENTS } from "@shared/character-sheet/sheet";
import type { CompendiumKind } from "@shared/compendium/schemas";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { LogEntryShared } from "@shared/events/log-share";
import { FOLDED_TEXT } from "@shared/log-share/kind";
import {
  LOG_KIND_SHARE,
  SHARE_TEXT_MAX,
  SHARE_TO_LOG,
  SHARE_WINDOW_TEXT_MAX,
  type SharePayload,
} from "@shared/log-share/schemas";
import { and, eq } from "drizzle-orm";
import { CommandError } from "../../commands/errors";
import { compendiumEntry, compendiumSource, entity, gameLogEntry } from "../../db/schema";
import type { Actor, DispatchedEvent } from "../../events/types";
import { putEntry } from "../compendium/homebrew";
import { diceServices, seedDice } from "../dice-roll-log/testing";

const spell = (name: string, text: string, higherLevel?: string) => ({
  kind: "spell" as const,
  name,
  facets: { level: 3, school: "evocation", classes: [], concentration: false, ritual: false },
  body: {
    castingTime: "1 action",
    range: "150 feet",
    components: "V, S",
    duration: "Instantaneous",
    text,
    ...(higherLevel ? { higherLevel } : {}),
  },
});

function setup() {
  const { s } = diceServices();
  const t = seedDice(s);
  const events: DispatchedEvent[] = [];
  s.bus.subscribe("test-capture", (e) => {
    events.push(e);
  });
  const run = <R = unknown>(name: string, input: unknown, actor: Actor = t.dm) =>
    s.commands.run(name, input, { actor }) as R;
  const share = (input: unknown, actor: Actor = t.dm) =>
    run<{ entryId: string }>(SHARE_TO_LOG, input, actor).entryId;
  const put = (entry: unknown, shared = false) =>
    (s.commands.run(putEntry.name, { entry, shared }, { actor: t.dm }) as { entryId: string })
      .entryId;
  const row = (id: string) => {
    const r = s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, id)).get();
    if (!r) throw new Error(`no entry ${id}`);
    return r;
  };
  const payload = (id: string) => row(id).payload as SharePayload;
  const putRow = (list: string, r: object, creatureId: string = t.miraId) =>
    run<{ rowId: string }>(CHARX_INTENTS.putRow, { creatureId, list, row: r }).rowId;
  const seen = (playerId: string) =>
    (t.snapshot(t.viewer("player", playerId))[GAME_LOG_ENTRY_TYPE] ?? []) as GameLogEntryRecord[];
  const now = "2026-10-31T10:00:00.000Z";
  /** An imported entry, straight to the rows (a source + its entry; players read it, FR-CMP-14). */
  const imported = (o: {
    id: string;
    kind: CompendiumKind;
    source?: string;
    name: string;
    facets: unknown;
    body: unknown;
    replaces?: string[];
  }) => {
    const source = o.source ?? "srd-5.1";
    s.db
      .insert(compendiumSource)
      .values({
        key: source,
        name: source,
        licence: "CC-BY-4.0",
        attribution: "Test",
        url: null,
        version: "1",
        importedAt: now,
        counts: {},
      })
      .onConflictDoNothing()
      .run();
    s.db
      .insert(compendiumEntry)
      .values({
        id: o.id,
        campaignId: null,
        kind: o.kind,
        source,
        sourceKey: `${o.kind}/${o.id}`,
        name: o.name,
        nameKey: o.name.toLowerCase(),
        line: "Imported",
        facets: o.facets,
        body: o.body,
        searchText: o.name.toLowerCase(),
        dataHash: "x",
        definitionId: null,
        shared: false,
        derivedFromId: null,
        replaces: o.replaces ?? [],
        artPath: null,
        createdAt: now,
        updatedAt: now,
        importedAt: now,
      })
      .run();
  };
  /** Homebrew stops at 8,000 chars; an imported entry may reach `SHARE_TEXT_MAX` and past it. */
  const huge = () => {
    const id = "huge";
    imported({
      id,
      kind: "condition",
      name: "Huge",
      facets: {},
      body: { text: "x".repeat(SHARE_TEXT_MAX) },
    });
    return id;
  };
  return { s, t, events, run, share, put, row, payload, putRow, seen, imported, huge };
}

const failOf = (fn: () => unknown): CommandError => {
  try {
    fn();
  } catch (e) {
    if (e instanceof CommandError) return e;
    throw e;
  }
  throw new Error("expected a CommandError");
};

describe("FR-SHARE-01 from the compendium", () => {
  test("FR-SHARE-01 FR-SHARE-05 a player shares a spell: public, whole text, one event", () => {
    const x = setup();
    const id = x.put(spell("Fireball", "A bright streak.", "+1d6 per slot."), true);
    const entryId = x.share({ from: "compendium", entryId: id }, x.t.p1Actor);
    expect(x.row(entryId)).toMatchObject({
      kind: LOG_KIND_SHARE,
      public: true,
      actorName: "Mira",
      rollIds: [],
    });
    const p = x.payload(entryId);
    expect(p.title).toBe("Fireball");
    expect(p.line).toBe("Level 3 evocation");
    expect(p.text).toContain("**Range:** 150 feet");
    expect(p.text).toContain("A bright streak.");
    expect(p.text).toContain("**At Higher Levels.** +1d6 per slot.");
    for (const pid of [x.t.p1.id, x.t.p2.id]) {
      expect(x.seen(pid).map((e) => e.id)).toContain(entryId);
    }
    const ev = x.events.filter((e) => e.event.type === LogEntryShared.type);
    expect(ev).toHaveLength(1);
    expect(ev[0]?.event.payload).toEqual({ entryId, from: "compendium", title: "Fireball" });
  });

  test("FR-SHARE-05 the DM's share is public even with the category set to hidden", () => {
    const x = setup();
    x.run("dice.setCategoryPublic", { category: "other", public: false });
    const id = x.put(spell("Fireball", "A bright streak."), true);
    const entryId = x.share({ from: "compendium", entryId: id });
    expect(x.row(entryId).public).toBe(true);
    expect(x.row(entryId).actorName).toBe("DM");
    expect(x.seen(x.t.p2.id).map((e) => e.id)).toContain(entryId);
  });

  test("FR-SHARE-10 a player can't share what they can't read: not_found, nothing written", () => {
    const x = setup();
    const id = x.put(spell("Secret Spell", "The DM's secret."), false);
    expect(failOf(() => x.share({ from: "compendium", entryId: id }, x.t.p1Actor)).code).toBe(
      "not_found",
    );
    expect(x.s.db.select().from(gameLogEntry).all()).toHaveLength(0);
  });

  test("FR-SHARE-11 the DM may share an unshared entry; the entry itself stays unshared", () => {
    const x = setup();
    const id = x.put(spell("Secret Spell", "The DM's secret."), false);
    const entryId = x.share({ from: "compendium", entryId: id });
    expect(x.payload(entryId).text).toContain("The DM's secret.");
    expect(x.seen(x.t.p1.id).map((e) => e.id)).toContain(entryId);
    const row = x.s.db.select().from(compendiumEntry).where(eq(compendiumEntry.id, id)).get();
    expect(row?.shared).toBe(false);
  });

  test("FR-SHARE-10 a monster's stat block is refused, for the DM too; an unknown id is not_found", () => {
    const x = setup();
    x.imported({
      id: "m1",
      kind: "monster",
      name: "Goblin",
      facets: { cr: "1/4", type: "humanoid", size: "small" },
      body: { meta: {}, traits: [], actions: [], bonusActions: [], reactions: [] },
    });
    expect(failOf(() => x.share({ from: "compendium", entryId: "m1" })).code).toBe("invalid");
    expect(failOf(() => x.share({ from: "compendium", entryId: "nope" })).code).toBe("not_found");
  });

  test("FR-SHARE-09 a player with two characters (or none) reads as their name", () => {
    const x = setup();
    const id = x.put(spell("Fireball", "A bright streak."), true);
    x.s.db
      .update(entity)
      .set({ ownerPlayerId: x.t.p1.id })
      .where(and(eq(entity.id, x.t.thornId)))
      .run();
    const two = x.share({ from: "compendium", entryId: id }, x.t.p1Actor);
    expect(x.row(two).actorName).toBe("Player 1");
    const none = x.share({ from: "compendium", entryId: id }, x.t.p2Actor);
    expect(x.row(none).actorName).toBe("Player 2");
  });
});

describe("FR-SHARE-02 from a sheet row", () => {
  test("FR-SHARE-04 a spell row reads its compendium entry, then its own notes", () => {
    const x = setup();
    x.put(spell("Fireball", "A bright streak."), true);
    const rowId = x.putRow("spells", { name: "fireball", level: 3, notes: "Aim away." });
    const entryId = x.share(
      { from: "sheet", creatureId: x.t.miraId, list: "spells", rowId },
      x.t.p1Actor,
    );
    expect(x.row(entryId).actorName).toBe("Mira");
    const p = x.payload(entryId);
    expect(p.title).toBe("fireball");
    expect(p.line).toBe("Level 3 evocation");
    expect(p.text).toContain("A bright streak.");
    expect(p.text.endsWith("**Notes.** Aim away.")).toBe(true);
  });

  test("FR-SHARE-04 a row no entry names falls back to its own words", () => {
    const x = setup();
    const rowId = x.putRow("spells", { name: "Hedge Whisper", level: 1, notes: "A trick." });
    const p = x.payload(
      x.share({ from: "sheet", creatureId: x.t.miraId, list: "spells", rowId }, x.t.p1Actor),
    );
    expect(p).toEqual({
      title: "Hedge Whisper",
      line: "Level 1 spell",
      text: "**Notes.** A trick.",
    });
  });

  test("FR-SHARE-10 a sheet share never reads an entry the sender can't: the DM's homebrew stays secret", () => {
    const x = setup();
    x.put(spell("Fireball", "The DM's version."), false);
    const rowId = x.putRow("spells", { name: "Fireball", level: 3 });
    const source = { from: "sheet", creatureId: x.t.miraId, list: "spells", rowId };
    expect(x.payload(x.share(source, x.t.p1Actor)).text).toBe("");
    expect(x.payload(x.share(source)).text).toContain("The DM's version.");
  });

  test("FR-SHARE-04 the campaign's own entry beats an imported one of the same name", () => {
    const x = setup();
    const body = spell("Bolt", "Imported.");
    x.imported({ id: "imp", kind: "spell", name: "Bolt", facets: body.facets, body: body.body });
    const rowId = x.putRow("spells", { name: "Bolt", level: 3 });
    const source = { from: "sheet", creatureId: x.t.miraId, list: "spells", rowId };
    expect(x.payload(x.share(source)).text).toContain("Imported.");
    x.put(spell("Bolt", "Own words."), true);
    expect(x.payload(x.share(source)).text).toContain("Own words.");
  });

  test("FR-SHARE-04 an entry another one replaces is passed over (FR-CMPX-13)", () => {
    const x = setup();
    const body = spell("Bolt", "Old rules.");
    x.imported({ id: "old", kind: "spell", name: "Bolt", facets: body.facets, body: body.body });
    x.imported({
      id: "new",
      kind: "spell",
      source: "book-phb",
      name: "Bolt",
      facets: body.facets,
      body: { ...body.body, text: "New rules." },
      replaces: ["srd-5.1:spell/old"],
    });
    const rowId = x.putRow("spells", { name: "Bolt", level: 3 });
    const source = { from: "sheet", creatureId: x.t.miraId, list: "spells", rowId };
    expect(x.payload(x.share(source)).text).toContain("New rules.");
  });

  test("FR-SHARE-04 a feature keeps its own text; a clipped copy reads the whole entry's", () => {
    const x = setup();
    const long = `${"Rage rules. ".repeat(80)}The end.`;
    x.put(
      { kind: "feature", name: "Rage", facets: { className: "Barbarian" }, body: { text: long } },
      true,
    );
    const clipped = x.putRow("features", {
      name: "Rage",
      source: "SRD",
      text: `${long.slice(0, 100).trimEnd()}…`,
    });
    const own = x.putRow("features", { name: "Rage", text: "My own words." });
    const share = (rowId: string) =>
      x.payload(x.share({ from: "sheet", creatureId: x.t.miraId, list: "features", rowId }));
    expect(share(clipped)).toEqual({ title: "Rage", line: "SRD", text: long });
    expect(share(own).text).toBe("My own words.");
  });

  test("FR-SHARE-02 items and attacks", () => {
    const x = setup();
    x.put(
      {
        kind: "item",
        name: "Moonblade Shard",
        facets: { category: "magic", attunement: true },
        body: { typeLine: "Wondrous item", text: "It sheds dim light." },
      },
      true,
    );
    const item = x.putRow("items", { name: "Moonblade Shard", notes: "Warm." });
    const attack = x.putRow("attacks", {
      name: "Longsword",
      toHit: 5,
      damage: "1d8+3",
      damageType: "slashing",
    });
    const share = (list: string, rowId: string) =>
      x.payload(x.share({ from: "sheet", creatureId: x.t.miraId, list, rowId }, x.t.p1Actor));
    expect(share("items", item).text).toBe("It sheds dim light.\n\n**Notes.** Warm.");
    expect(share("attacks", attack)).toEqual({
      title: "Longsword",
      line: "+5 · 1d8+3 slashing",
      text: "",
    });
  });

  test("FR-SHARE-10 a player shares their own character only; a monster and a lost row are refused", () => {
    const x = setup();
    const rowId = x.putRow("spells", { name: "Hedge Whisper", level: 1 });
    const source = { from: "sheet", creatureId: x.t.miraId, list: "spells", rowId };
    expect(failOf(() => x.share(source, x.t.p2Actor)).code).toBe("forbidden");
    expect(x.share(source)).toBeString(); // the DM: any character of the campaign
    expect(failOf(() => x.share({ ...source, creatureId: x.t.goblinId })).code).toBe("not_found");
    expect(failOf(() => x.share({ ...source, creatureId: x.t.strangerId })).code).toBe("not_found");
    expect(failOf(() => x.share({ ...source, rowId: "gone" })).code).toBe("not_found");
  });

  test("FR-SHARE-03 free text is no input: an extra field is refused", () => {
    const x = setup();
    const id = x.put(spell("Fireball", "A bright streak."), true);
    expect(failOf(() => x.share({ from: "compendium", entryId: id, text: "Hi" })).code).toBe(
      "invalid",
    );
  });
});

describe("FR-SHARE-06 FR-SHARE-08 limits", () => {
  test("FR-SHARE-06 a text past the limit is cut and marked", () => {
    const x = setup();
    const body = spell("Long", "x".repeat(SHARE_TEXT_MAX));
    x.imported({ id: "long", kind: "spell", name: "Long", facets: body.facets, body: body.body });
    const p = x.payload(x.share({ from: "compendium", entryId: "long" }));
    expect(p.cut).toBe(true);
    expect(p.text.length).toBe(SHARE_TEXT_MAX);
  });

  test("FR-SHARE-08 older shares fold, newest first, past the window's budget; the fold reaches players", () => {
    const x = setup();
    const id = x.huge();
    const n = Math.ceil(SHARE_WINDOW_TEXT_MAX / SHARE_TEXT_MAX) + 2;
    const ids = Array.from({ length: n }, () => x.share({ from: "compendium", entryId: id }));
    const kept = ids.map((e) => x.payload(e).text.length);
    expect(kept.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(SHARE_WINDOW_TEXT_MAX);
    expect(kept.at(-1)).toBe(SHARE_TEXT_MAX);
    const first = x.payload(ids[0] as string);
    expect(first).toEqual({ title: "Huge", line: "Imported", text: "", folded: true });
    expect(first.text).not.toContain(FOLDED_TEXT);
    expect(x.seen(x.t.p1.id).find((e) => e.id === ids[0])?.payload).toEqual(first);
    const last = x.events.filter((e) => e.event.type === LogEntryShared.type).at(-1);
    expect(last?.event.changes.length).toBeGreaterThanOrEqual(2);
  });

  test("FR-SHARE-08 small shares never fold", () => {
    const x = setup();
    const id = x.put(spell("Small", "Words."), true);
    const ids = Array.from({ length: 5 }, () => x.share({ from: "compendium", entryId: id }));
    for (const e of ids) expect(x.payload(e).folded).toBeUndefined();
  });
});

describe("FR-SHARE-07 hide", () => {
  test("FR-SHARE-07 the DM's Hide takes a share out of every player's log, the sender's too", () => {
    const x = setup();
    const id = x.put(spell("Fireball", "A bright streak."), true);
    const entryId = x.share({ from: "compendium", entryId: id }, x.t.p1Actor);
    x.run("dice.setEntryHidden", { entryId, hidden: true });
    for (const pid of [x.t.p1.id, x.t.p2.id]) {
      expect(x.seen(pid).map((e) => e.id)).not.toContain(entryId);
    }
    x.run("dice.setEntryHidden", { entryId, hidden: false });
    expect(x.seen(x.t.p2.id).map((e) => e.id)).toContain(entryId);
  });
});

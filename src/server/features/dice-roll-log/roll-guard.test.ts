// FR-DICE-13 roll guard (sprint 14 F4, BL-135, DM #367), in-process on combat's ambush: a DM roll
// made as a hidden or renamed monster creature is DM-only on every roll path, whatever the public
// switch or the category preset; the unchanged public case, characters and players' own rolls
// keep FR-DICE-13. Each case checks the stamp and every player's snapshot.
import { describe, expect, test } from "bun:test";
import { CBT_INTENTS } from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { MAP_INTENTS } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { combatant, gameLogEntry, scene } from "../../db/schema";
import type { Viewer } from "../../ws/records";
import { cbtxSetup } from "../combat-extras/testing";
import { createEntity } from "../entities/commands";
import { goblinBlock } from "../entities/testing";
import { createScene } from "../scenes-map/commands";
import { ROLL } from "./commands";
import { numberedFrom } from "./roll-guard";
import { SET_CATEGORY_PUBLIC } from "./settings";

const SECRET = "SECRET-GUARD";

function setup() {
  const t = cbtxSetup();
  // The players' scene is the ambush (its tokens are what they see).
  t.run(MAP_INTENTS.activateScene, { sceneId: t.sceneId });
  for (const category of ["attack", "damage", "saving-throw", "ability-check"]) {
    t.run(SET_CATEGORY_PUBLIC, { category, public: true });
  }
  const players = [t.h.p1.id, t.h.p2.id];
  const viewer = (playerId: string) =>
    ({ connId: "test", campaignId: t.h.campaignId, role: "player", playerId }) satisfies Viewer;
  const seen = (playerId: string) =>
    t.s.records.snapshot({ db: t.s.db, presence: { list: () => [] } }, viewer(playerId))[
      GAME_LOG_ENTRY_TYPE
    ] as GameLogEntryRecord[];
  const stamp = (entryId: string) =>
    t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, entryId)).get()?.public;
  /** The entry's stamp, and that every player sees it iff public (no label leak otherwise). */
  const check = (entryId: string, expected: boolean) => {
    expect(stamp(entryId)).toBe(expected);
    for (const pid of players) {
      const mine = seen(pid);
      expect({ pid, shown: mine.some((e) => e.id === entryId) }).toEqual({
        pid,
        shown: expected,
      });
      if (!expected) expect(JSON.stringify(mine)).not.toContain(entryId);
    }
  };
  const roll = (actor: unknown, extra: Record<string, unknown> = {}) =>
    t.run<{ entryId: string }>(ROLL, {
      expression: "1d20+4",
      category: "attack",
      label: SECRET,
      actor,
      ...extra,
    }).entryId;
  const cbt = (name: string) => t.byName(t.enc.id)[name] as { id: string; name: string };
  const rename = (tokenId: string, name: string) =>
    t.run(MAP_INTENTS.updateToken, { tokenId, name });
  const hide = (tokenId: string, hidden: boolean) =>
    t.run(MAP_INTENTS.setTokenHidden, { tokenId, hidden });
  const save = (combatantId: string, extra: Record<string, unknown> = {}) =>
    t.run<{ entryId: string }>(CBT_INTENTS.rollAbility, {
      combatantId,
      kind: "save",
      ability: "dex",
      ...extra,
    }).entryId;
  return { ...t, check, roll, cbt, rename, hide, save, stamp };
}

describe("FR-DICE-13 roll guard (#367)", () => {
  test("FR-DICE-13 numberedFrom: a numbering suffix is not a rename", () => {
    expect(numberedFrom("Goblin", "Goblin")).toBe(true);
    expect(numberedFrom("Goblin 2", "Goblin")).toBe(true);
    expect(numberedFrom("Goblin 12", "Goblin")).toBe(true);
    expect(numberedFrom("Big Bob", "Goblin")).toBe(false);
    expect(numberedFrom("Hobgoblin 2", "Goblin")).toBe(false);
    expect(numberedFrom("goblin", "Goblin")).toBe(false);
    // FR-MAP-16: a long base is cut to fit 40 code points with its suffix.
    const long = "A".repeat(40);
    expect(numberedFrom(`${"A".repeat(38)} 2`, long)).toBe(true);
    expect(numberedFrom(`${"A".repeat(38)} 2`, "A".repeat(38))).toBe(true);
    expect(numberedFrom(`${"B".repeat(38)} 2`, long)).toBe(false);
  });

  test("FR-DICE-13 unchanged public case: a shown, unrenamed monster follows the switch / preset", () => {
    const t = setup();
    expect(t.s.db.select().from(scene).where(eq(scene.id, t.sceneId)).get()?.active).toBe(true);
    t.check(t.roll({ tokenId: t.tokens.goblin }), true);
    t.check(t.roll({ tokenId: t.tokens.goblin2 }), true);
    t.check(t.roll({ combatantId: t.cbt("Goblin 2").id }), true);
    t.check(t.roll({ entityId: t.h.goblinId }), true);
    t.check(t.save(t.cbt("Goblin").id, { public: true }), true);
    // The DM's own switch still hides it.
    t.check(t.roll({ tokenId: t.tokens.goblin }, { public: false }), false);
  });

  test("FR-DICE-13 hidden creature: token, combatant, definition roll are DM-only, a public switch too", () => {
    const t = setup();
    for (const extra of [{}, { public: true }]) {
      t.check(t.roll({ tokenId: t.tokens.wolf }, extra), false);
      t.check(t.roll({ tokenId: t.tokens.elite }, extra), false);
      t.check(t.roll({ combatantId: t.cbt("Elite Goblin Warrior").id }, extra), false);
      // A definition roll (stat block, K7 F1) whose creature is hidden.
      t.check(t.roll({ entityId: t.eliteId }, extra), false);
      t.check(t.save(t.cbt("Wolf").id, extra), false);
    }
    // K7 F1: out of the fight (removed), the stat block rolls as the definition: still DM-only.
    t.run(CBT_INTENTS.setRemoved, { combatantId: t.cbt("Elite Goblin Warrior").id, removed: true });
    t.check(t.roll({ entityId: t.eliteId }, { label: `${SECRET} Elite — Scimitar` }), false);
    // Hidden mid-play: the goblin's next roll is DM-only; shown again → public.
    t.hide(t.tokens.goblin2, true);
    t.check(t.roll({ tokenId: t.tokens.goblin2 }, { public: true }), false);
    t.check(t.roll({ combatantId: t.cbt("Goblin 2").id }), false);
    t.hide(t.tokens.goblin2, false);
    t.check(t.roll({ tokenId: t.tokens.goblin2 }), true);
  });

  test("FR-DICE-13 hidden creature: a token not on the players' scene is DM-only", () => {
    const t = setup();
    const prep = t.run<{ id: string }>(createScene.name, {
      name: "Crypt",
      mapAssetId: "map-battle",
    }).id;
    const ghoulDef = t.run<{ id: string }>(createEntity.name, {
      kind: "monster",
      name: "Ghoul",
      statBlock: goblinBlock,
    }).id;
    // No instance: a definition roll follows the preset (dice-roll-log rolls-1).
    t.check(t.roll({ entityId: ghoulDef }), true);
    const ghoul = t.run<{ tokenId: string }>(MAP_INTENTS.placeToken, {
      sceneId: prep,
      definitionId: ghoulDef,
      col: 2,
      row: 2,
    }).tokenId;
    t.check(t.roll({ tokenId: ghoul }), false);
    t.check(t.roll({ entityId: ghoulDef }, { public: true }), false);
  });

  test("FR-DICE-13 renamed creature: token, combatant and definition roll are DM-only", () => {
    const t = setup();
    t.rename(t.tokens.goblin, "Big Bob");
    const bob = t.s.db.select().from(combatant).where(eq(combatant.tokenId, t.tokens.goblin)).get();
    for (const extra of [{}, { public: true }]) {
      t.check(t.roll({ tokenId: t.tokens.goblin }, extra), false);
      if (bob) t.check(t.roll({ combatantId: bob.id }, extra), false);
      // "Goblin" as the definition: one of its creatures goes by another name.
      t.check(t.roll({ entityId: t.h.goblinId }, extra), false);
    }
    if (bob) t.check(t.save(bob.id, { public: true }), false);
    // The other goblin keeps its name: its own rolls stay public.
    t.check(t.roll({ tokenId: t.tokens.goblin2 }), true);
    t.check(t.save(t.cbt("Goblin 2").id, { public: true }), true);
    // Renamed back (a numbered name is no rename): public again.
    t.rename(t.tokens.goblin, "Goblin 3");
    t.check(t.roll({ tokenId: t.tokens.goblin }), true);
  });

  test("FR-DICE-13 hidden and renamed creature: DM-only", () => {
    const t = setup();
    t.rename(t.tokens.wolf, "Shadow");
    for (const extra of [{}, { public: true }]) {
      t.check(t.roll({ tokenId: t.tokens.wolf }, extra), false);
      t.check(t.roll({ entityId: t.h.wolfId }, extra), false);
    }
    t.hide(t.tokens.wolf, false);
    t.check(t.roll({ tokenId: t.tokens.wolf }), false);
  });

  test("FR-DICE-13 characters and players' own rolls are unchanged", () => {
    const t = setup();
    // The DM's roll for a PC follows the preset, also when one of its tokens sits elsewhere.
    t.check(t.roll({ tokenId: t.tokens.mira }), true);
    t.check(t.roll({ entityId: t.miraId }), true);
    // A player's own roll is public (FR-DICE-13).
    const own = t.run<{ entryId: string }>(
      ROLL,
      { expression: "1d20", category: "attack", actor: { entityId: t.miraId } },
      t.p1,
    ).entryId;
    t.check(own, true);
  });
});

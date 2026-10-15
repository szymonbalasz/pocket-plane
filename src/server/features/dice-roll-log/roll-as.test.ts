// FR-DICE-34 (S4): the DM rolls as a token-less combatant of the started encounter, on combat's
// in-process ambush (the `combat` bundle's shape): entity actor under the combatant's name, no
// new actor kind; ended / removed / unknown → not_found; players can't send it.
import { describe, expect, test } from "bun:test";
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import { CBT_INTENTS } from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { eq } from "drizzle-orm";
import { combatant, gameLogEntry, roll } from "../../db/schema";
import type { Viewer } from "../../ws/records";
import { cbtxSetup } from "../combat-extras/testing";
import { ROLL } from "./commands";

function setup() {
  const t = cbtxSetup();
  // Every goblin token is bound: a definition item joins token-less as "Goblin 3".
  const { combatantIds } = t.run<{ combatantIds: string[] }>(CBTX_INTENTS.addCombatants, {
    encounterId: t.enc.id,
    items: [{ definitionId: t.h.goblinId }],
  });
  const goblin3 = combatantIds[0] as string;
  const viewer = (role: "dm" | "player", playerId: string | null = null) =>
    ({ connId: "test", campaignId: t.h.campaignId, role, playerId }) satisfies Viewer;
  const entries = (v: Viewer) =>
    t.s.records.snapshot({ db: t.s.db, presence: { list: () => [] } }, v)[
      GAME_LOG_ENTRY_TYPE
    ] as GameLogEntryRecord[];
  const rollAs = (combatantId: string, extra: Record<string, unknown> = {}) =>
    t.run<{ rollId: string; entryId: string }>(ROLL, {
      expression: "1d20+4",
      category: "attack",
      actor: { combatantId },
      ...extra,
    });
  return { ...t, goblin3, viewer, entries, rollAs };
}

describe("FR-DICE-34 roll as a token-less combatant", () => {
  test("FR-DICE-34 DM dice.roll {actor: {combatantId}} → entry actorName Goblin 3, roll actorKind entity", () => {
    const t = setup();
    expect(t.byName(t.enc.id)["Goblin 3"]).toMatchObject({ id: t.goblin3, tokenId: null });
    const r = t.rollAs(t.goblin3);
    const entry = t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, r.entryId)).get();
    expect(entry?.actorName).toBe("Goblin 3");
    const row = t.s.db.select().from(roll).where(eq(roll.id, r.rollId)).get();
    expect(row).toMatchObject({
      actorKind: "entity",
      actorId: t.h.goblinId,
      actorName: "Goblin 3",
    });
  });

  test("FR-DICE-34 unknown, removed or ended → not_found; players → invalid", () => {
    const t = setup();
    expect(t.err(() => t.rollAs("nope")).code).toBe("not_found");
    // A player can't send it, not even for a visible combatant.
    const p = t.err(() =>
      t.run(ROLL, { expression: "1d20", actor: { combatantId: t.goblin3 } }, t.player(t.h.p1)),
    );
    expect(p.code).toBe("invalid");
    t.run(CBT_INTENTS.setRemoved, { combatantId: t.goblin3, removed: true });
    expect(t.err(() => t.rollAs(t.goblin3)).code).toBe("not_found");
    t.run(CBT_INTENTS.setRemoved, { combatantId: t.goblin3, removed: false });
    expect(t.rollAs(t.goblin3).entryId).toBeTruthy();
    t.endEncounter();
    expect(t.err(() => t.rollAs(t.goblin3)).code).toBe("not_found");
  });

  test("FR-DICE-34 visibility unchanged: a hidden combatant's DM-only roll stays DM-only", () => {
    const t = setup();
    // Token-less combatants have no token to hide; mark the row hidden as a hidden actor would be.
    t.s.db.update(combatant).set({ hidden: true }).where(eq(combatant.id, t.goblin3)).run();
    const before = t.entries(t.viewer("player", t.h.p1.id)).length;
    const hidden = t.rollAs(t.goblin3, { public: false, label: "SECRET-GOBLIN" });
    const dm = t.entries(t.viewer("dm"));
    expect(dm.find((e) => e.id === hidden.entryId)).toMatchObject({
      actorName: "Goblin 3",
      public: false,
    });
    const player = t.entries(t.viewer("player", t.h.p1.id));
    expect(player).toHaveLength(before);
    expect(JSON.stringify(player)).not.toContain("SECRET-GOBLIN");
    // The DM's public switch (or a public category) decides, as for any DM roll (FR-DICE-13).
    const shown = t.rollAs(t.goblin3, { public: true });
    const after = t.entries(t.viewer("player", t.h.p1.id));
    expect(after.find((e) => e.id === shown.entryId)?.actorName).toBe("Goblin 3");
    expect(after.some((e) => e.id === hidden.entryId)).toBe(false);
  });
});

// FR-CBT-179 / -180 (#457): counted moves keep undoable steps; the DM's `cbt.undoMove` walks the
// last one back (token, feet, trail). In-process.
import { describe, expect, test } from "bun:test";
import { CBT_INTENTS, COMBATANT_TYPE, MOVE_STEPS_MAX } from "@shared/combat-tracker/schemas";
import { MAP_INTENTS, TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { token } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { Actor } from "../../events/types";
import { setInitiative, setRemoved } from "./initiative";
import { endCommand, startCommand } from "./lifecycle";
import { MOVE_CHANGED, MOVED_SINCE, NOTHING_TO_UNDO } from "./move-undo";
import { readEncounter } from "./rows";
import { combatSetup } from "./testing";
import { nextTurn } from "./turns";

function started() {
  const t = combatSetup();
  const enc = t.createAmbush();
  t.run(startCommand.name, { encounterId: enc.id, sceneId: t.sceneId });
  t.run(MAP_INTENTS.activateScene, { sceneId: t.sceneId });
  const id = (name: string) => t.byName(enc.id)[name]?.id as string;
  const row = (name: string) => t.byName(enc.id)[name];
  const move = (tokenId: string, col: number, r: number, actor?: Actor) =>
    t.run(MAP_INTENTS.moveToken, { tokenId, col, row: r }, actor);
  const lastStep = (name: string) => row(name)?.moveSteps?.at(-1)?.id ?? "x";
  const undoMove = (name: string, actor?: Actor, stepId = lastStep(name)) =>
    t.run(CBT_INTENTS.undoMove, { combatantId: id(name), expectedStepId: stepId }, actor);
  const tok = (tokenId: string) => t.s.db.select().from(token).where(eq(token.id, tokenId)).get();
  const next = () => {
    const e = readEncounter(t.s.db, enc.id);
    t.run(nextTurn.name, {
      encounterId: e.id,
      expectedRound: e.round,
      expectedTurnId: e.turnCombatantId,
    });
  };
  return { ...t, enc, id, row, move, undoMove, lastStep, tok, next };
}

describe("FR-CBT-179 move steps", () => {
  test("FR-CBT-179 each counted move pushes a step of the feet it added; DM only on the wire", () => {
    const t = started();
    t.move(t.tokens.goblin, 14, 8); // (12,6) → (14,8): 15 ft
    t.move(t.tokens.goblin, 14, 9); // 5 ft
    const steps = t.row("Goblin")?.moveSteps ?? [];
    expect(steps.map((s) => [s.from, s.to, s.ft])).toEqual([
      [{ col: 12, row: 6 }, { col: 14, row: 8 }, 15],
      [{ col: 14, row: 8 }, { col: 14, row: 9 }, 5],
    ]);
    expect(steps[0]?.tokenId).toBe(t.tokens.goblin);
    const ch = t.events.at(-1)?.event.changes.find((c) => c.type === COMBATANT_TYPE);
    const dm = t.s.records.filterChange(ch as never, t.h.viewer("dm"));
    const p = t.s.records.filterChange(ch as never, t.h.viewer("player", t.h.p1.id));
    expect(dm).toMatchObject({ data: { moveSteps: steps } });
    expect(p).toMatchObject({ data: { movedFt: 20 } });
    expect(JSON.stringify(p)).not.toContain("moveSteps");
  });

  test("FR-CBT-179 the cap keeps the newest steps; capped feet record what was added", () => {
    const t = started();
    for (let i = 0; i < MOVE_STEPS_MAX + 2; i++) t.move(t.tokens.goblin, 13 + (i % 2), 6);
    const steps = t.row("Goblin")?.moveSteps ?? [];
    expect(steps).toHaveLength(MOVE_STEPS_MAX);
    expect(steps.at(-1)?.to).toEqual({ col: 14, row: 6 });
    t.s.db.$client.run("update combatant set moved_ft = 9997 where id = ?", [t.id("Goblin")]);
    t.move(t.tokens.goblin, 13, 6);
    expect(t.row("Goblin")?.moveSteps?.at(-1)?.ft).toBe(2);
  });

  test("FR-CBT-179 Next clears the new turn combatant's steps with its feet; a teleport clears them", () => {
    const t = started();
    for (const [n, v] of [
      ["Wolf", 18],
      ["Mira", 15],
      ["Goblin", 12],
      ["Goblin 2", 11],
      ["Thorn", 10],
      ["Elite Goblin Warrior", 8],
    ] as const) {
      t.run(setInitiative.name, { combatantId: t.id(n), value: v });
    }
    t.move(t.tokens.goblin, 13, 6);
    t.next(); // Start round 1: everyone reset
    expect(t.row("Goblin")?.moveSteps).toBeUndefined();
    t.move(t.tokens.goblin, 14, 6);
    t.run(MAP_INTENTS.teleportToken, { tokenId: t.tokens.goblin, col: 16, row: 9 });
    expect(t.row("Goblin")?.moveSteps).toBeUndefined();
    expect(t.row("Goblin")?.movedFt).toBe(5);
  });
});

describe("FR-CBT-180 cbt.undoMove", () => {
  test("FR-CBT-180 token back to the step's start, feet off, newest first; unlogged TokenMoved", () => {
    const t = started();
    t.move(t.tokens.mira, 4, 7, t.p1); // (2,7) → (4,7): 10 ft, by her player
    t.move(t.tokens.mira, 6, 7, t.p1); // 10 ft
    expect(t.row("Mira")?.movedFt).toBe(20);
    const n = t.events.length;
    t.undoMove("Mira");
    const ev = t.events[n]?.event;
    expect(ev?.type).toBe("TokenMoved");
    expect(ev?.changes.find((c) => c.type === TOKEN_TYPE)?.after).toMatchObject({ col: 4, row: 7 });
    expect(ev?.changes.find((c) => c.type === COMBATANT_TYPE)?.after).toMatchObject({
      movedFt: 10,
    });
    expect(t.tok(t.tokens.mira)).toMatchObject({ col: 4, row: 7 });
    t.undoMove("Mira");
    expect(t.tok(t.tokens.mira)).toMatchObject({ col: 2, row: 7 });
    expect(t.row("Mira")).toMatchObject({ movedFt: 0 });
    expect(t.row("Mira")?.moveSteps).toBeUndefined();
    expect(() => t.undoMove("Mira", undefined, "x")).toThrow(NOTHING_TO_UNDO);
    expect(readEventLog(t.s.db).some((e) => e.type === "TokenMoved")).toBe(false);
  });

  test("FR-CBT-180 the trail drops the step's cell (FR-CBT-97)", () => {
    const t = started();
    t.move(t.tokens.goblin, 13, 6);
    t.move(t.tokens.goblin, 14, 6);
    expect(t.tok(t.tokens.goblin)?.trail).toEqual({
      cells: [
        [12, 6],
        [13, 6],
        [14, 6],
      ],
    });
    t.undoMove("Goblin");
    expect(t.tok(t.tokens.goblin)?.trail).toEqual({
      cells: [
        [12, 6],
        [13, 6],
      ],
    });
    t.undoMove("Goblin");
    expect(t.tok(t.tokens.goblin)?.trail).toBeNull();
  });

  test("FR-CBT-180 refusals change nothing: stale step, token moved since, player, removed, ended", () => {
    const t = started();
    t.move(t.tokens.goblin, 13, 6);
    const stale = t.lastStep("Goblin");
    t.move(t.tokens.goblin, 14, 6);
    expect(() => t.undoMove("Goblin", undefined, stale)).toThrow(MOVE_CHANGED);
    // Moved by something that isn't counted (Goblin removed → moves add nothing, then restored).
    t.run(setRemoved.name, { combatantId: t.id("Goblin"), removed: true });
    t.move(t.tokens.goblin, 15, 6);
    t.run(setRemoved.name, { combatantId: t.id("Goblin"), removed: false });
    expect(() => t.undoMove("Goblin")).toThrow(MOVED_SINCE);
    expect(t.tok(t.tokens.goblin)).toMatchObject({ col: 15, row: 6 });
    expect(t.row("Goblin")?.movedFt).toBe(10);
    // Players can't; a removed combatant can't; after End nothing is active.
    t.move(t.tokens.mira, 4, 7, t.p1);
    expect(() => t.undoMove("Mira", t.p1)).toThrow();
    t.run(setRemoved.name, { combatantId: t.id("Mira"), removed: true });
    expect(() => t.undoMove("Mira")).toThrow("Combatant not found");
    t.run(setRemoved.name, { combatantId: t.id("Mira"), removed: false });
    t.run(endCommand.name, { encounterId: t.enc.id });
    expect(() => t.undoMove("Mira")).toThrow("Combatant not found");
    expect(t.tok(t.tokens.mira)).toMatchObject({ col: 4, row: 7 });
  });
});

// Combat rule hook registry (FR-CBTX-01, ADR-0035): created empty, append-only; run order =
// registry order; rows concatenated for the caller's event; a throw reaches the caller (which
// rolls its transaction back). Not yet called from any command.
import { describe, expect, test } from "bun:test";
import type { EncounterRecord } from "@shared/combat-tracker/schemas";
import type { RecordChange } from "../../events/types";
import {
  bindCombatRuleHooks,
  COMBAT_RULE_POINTS,
  type CombatRuleEnv,
  CombatRuleHooks,
  combatRuleHooks,
  combatRuleHooksOf,
} from "./rule-hooks";

const env = {} as CombatRuleEnv;
const enc = { id: "enc-1", round: 2, turnCombatantId: "k2" } as EncounterRecord;
const row = (id: string): RecordChange => ({ type: "effect", id, before: null, after: { id } });
const turn = {
  direction: "prev" as const,
  from: { round: 2, turnCombatantId: "k2" },
  to: { round: 2, turnCombatantId: "k1" },
  notRestored: [] as string[],
};

describe("combat rule hooks (ADR-0035)", () => {
  test("FR-CBTX-01 the registry is created empty; four hook points", () => {
    expect(combatRuleHooks).toEqual([]);
    expect(COMBAT_RULE_POINTS).toEqual(["started", "added", "turnChanged", "ended"]);
    expect(new CombatRuleHooks().run("turnChanged", env, enc, turn)).toEqual([]);
  });

  test("FR-CBTX-01 runs one point of every hook in registry order; rows concatenated", () => {
    const hooks = new CombatRuleHooks([]);
    const seen: string[] = [];
    hooks.register("a.first", {
      turnChanged: (_e, e, d) => {
        seen.push(`a:${e.id}:${d.direction}`);
        d.notRestored.push("Frightened (Goblin)");
        return [row("x1")];
      },
      ended: () => [row("never")],
    });
    hooks.register("b.second", { turnChanged: () => [row("x2"), row("x3")] });
    hooks.register("c.other-point", { started: () => [row("s1")] });
    const detail = { ...turn, notRestored: [] as string[] };
    expect(hooks.run("turnChanged", env, enc, detail).map((c) => c.id)).toEqual(["x1", "x2", "x3"]);
    expect(seen).toEqual(["a:enc-1:prev"]);
    expect(detail.notRestored).toEqual(["Frightened (Goblin)"]);
    expect(hooks.run("started", env, enc, { combatantIds: ["k1"] }).map((c) => c.id)).toEqual([
      "s1",
    ]);
    expect(hooks.run("added", env, enc, { combatantIds: ["k3"] })).toEqual([]);
  });

  test("FR-CBTX-01 a hook error reaches the caller (the command rolls back)", () => {
    const hooks = new CombatRuleHooks([]);
    hooks.register("test.boom", {
      ended: () => {
        throw new Error("boom");
      },
    });
    expect(() => hooks.run("ended", env, enc, { combatantIds: [] })).toThrow("boom");
    hooks.unregister("test.boom");
    expect(hooks.run("ended", env, enc, { combatantIds: [] })).toEqual([]);
  });

  test("names are unique; the per-server list is bound to its services", () => {
    const hooks = new CombatRuleHooks([{ name: "x.one", hooks: {} }]);
    expect(() => hooks.register("x.one", {})).toThrow(/registered twice/);
    const services = {};
    expect(() => combatRuleHooksOf(services)).toThrow(/not bound/);
    bindCombatRuleHooks(services, hooks);
    expect(combatRuleHooksOf(services)).toBe(hooks);
  });
});

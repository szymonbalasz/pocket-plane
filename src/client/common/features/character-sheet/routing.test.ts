import { describe, expect, spyOn, test } from "bun:test";
import { emptyStore } from "@shared/protocol/store";
import { IntentRejected } from "../../sync/connection";
import { rollRoutes } from "./roll-routes";
import {
  CONNECTION_LOST,
  charRollPayload,
  createInFlight,
  intentErrorText,
  type RollRoute,
  rollActionView,
  routeFor,
  sendSheetRoll,
  sheetBadge,
} from "./routing";

const sent: [string, unknown][] = [];
const send = (name: string, payload: unknown) => {
  sent.push([name, payload]);
  return Promise.resolve({ ok: true });
};

describe("FR-CHAR-16 roll routing", () => {
  test("FR-CHAR-16 no route claims (no encounter) → char.roll with the roll control's input", async () => {
    expect(routeFor(rollRoutes, emptyStore(), "mira", "initiative")).toBeNull();
    sent.length = 0;
    const claim = routeFor(rollRoutes, emptyStore(), "mira", "attack");
    expect(claim).toBeNull();
    await sendSheetRoll(send, claim, "mira", "attack", {
      mode: "advantage",
      manual: [{ diceTotal: 12 }, { diceTotal: 4 }],
    });
    await sendSheetRoll(send, null, "mira", "initiative", { mode: "normal", public: false });
    expect(sent).toEqual([
      [
        "char.roll",
        {
          characterId: "mira",
          kind: "attack",
          mode: "advantage",
          manual: [{ diceTotal: 12 }, { diceTotal: 4 }],
        },
      ],
      ["char.roll", { characterId: "mira", kind: "initiative", mode: "normal", public: false }],
    ]);
    expect(charRollPayload("x", "initiative", { mode: "normal" })).toEqual({
      characterId: "x",
      kind: "initiative",
      mode: "normal",
    });
  });

  test("FR-CHAR-16 a claiming route sends its own intent (fields it doesn't take dropped) + badge", async () => {
    sent.length = 0;
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const passing: RollRoute = { name: "pass", claim: () => null };
    const throwing: RollRoute = {
      name: "broken",
      claim: () => {
        throw new Error("boom");
      },
    };
    const combat: RollRoute = {
      name: "combat",
      claim: (_store, characterId, kind) =>
        characterId === "mira" && kind === "attack"
          ? {
              badge: "In combat",
              critExpressions: ["2d6+2"],
              send: (s, input) =>
                s("cbt.attack", { attackerId: "cb-mira", mode: input.mode, manual: input.manual }),
            }
          : null,
    };
    const routes = [passing, throwing, combat];
    const claim = routeFor(routes, emptyStore(), "mira", "attack");
    expect(claim?.badge).toBe("In combat");
    expect(claim?.critExpressions).toEqual(["2d6+2"]);
    await sendSheetRoll(send, claim, "mira", "attack", { mode: "normal", public: true });
    expect(sent).toEqual([["cbt.attack", { attackerId: "cb-mira", mode: "normal" }]]);
    // Not claimed for another kind / character → char.roll.
    expect(routeFor(routes, emptyStore(), "mira", "initiative")).toBeNull();
    expect(routeFor(routes, emptyStore(), "thorn", "attack")).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("FR-CHAR-16 FR-CHAR-23 checks and saves", () => {
  const initOnly: RollRoute = {
    name: "init-only",
    claim: (_store, characterId, kind) =>
      characterId === "mira" && kind === "initiative"
        ? { badge: "In combat", send: (s) => s("cbt.rollInitiative", { combatantIds: ["cb"] }) }
        : null,
  };

  test("FR-CHAR-23 a route claiming only initiative leaves check / save to char.roll (+ ability)", async () => {
    sent.length = 0;
    const store = emptyStore();
    for (const kind of ["check", "save"] as const) {
      const claim = routeFor([initOnly], store, "mira", kind);
      expect(claim).toBeNull();
      await sendSheetRoll(send, claim, "mira", kind, { mode: "advantage" }, "dex");
    }
    await sendSheetRoll(
      send,
      null,
      "mira",
      "save",
      {
        mode: "normal",
        manual: [{ diceTotal: 15 }],
        public: true,
      },
      "wis",
    );
    expect(sent).toEqual([
      ["char.roll", { characterId: "mira", kind: "check", ability: "dex", mode: "advantage" }],
      ["char.roll", { characterId: "mira", kind: "save", ability: "dex", mode: "advantage" }],
      [
        "char.roll",
        {
          characterId: "mira",
          kind: "save",
          ability: "wis",
          mode: "normal",
          manual: [{ diceTotal: 15 }],
          public: true,
        },
      ],
    ]);
  });

  test("FR-CHAR-16 header badge iff a route claims at least one kind; empty registry = plain sheet", () => {
    expect(sheetBadge([], emptyStore(), "mira")).toBeNull();
    expect(sheetBadge(rollRoutes, emptyStore(), "mira")).toBeNull();
    expect(sheetBadge([initOnly], emptyStore(), "mira")).toBe("In combat");
    expect(sheetBadge([initOnly], emptyStore(), "thorn")).toBeNull();
  });
});

describe("FR-CHAR-24 hidden routed button", () => {
  let hide = true;
  const hiding: RollRoute = {
    name: "hiding",
    claim: (_store, characterId, kind) =>
      characterId === "mira" && (kind === "initiative" || kind === "attack")
        ? { badge: "In combat", hidden: hide, send: (s) => s("cbt.rollInitiative", {}) }
        : null,
  };

  test("FR-CHAR-24 a route answering hidden → no Initiative button, 'Initiative set', badge kept; flip back → button", () => {
    hide = true;
    const store = emptyStore();
    expect(rollActionView(routeFor([hiding], store, "mira", "initiative"), "initiative")).toBe(
      "locked",
    );
    // Another hidden kind renders nothing (no button, no public switch).
    expect(rollActionView(routeFor([hiding], store, "mira", "attack"), "attack")).toBe("none");
    expect(sheetBadge([hiding], store, "mira")).toBe("In combat");
    hide = false;
    expect(rollActionView(routeFor([hiding], store, "mira", "initiative"), "initiative")).toBe(
      "button",
    );
    // Unclaimed (not in the encounter) keeps its plain char.roll button.
    hide = true;
    expect(rollActionView(routeFor([hiding], store, "thorn", "initiative"), "initiative")).toBe(
      "button",
    );
  });

  function combatStore(
    mira: Record<string, unknown> | null,
    round: number,
  ): ReturnType<typeof emptyStore> {
    return {
      ...emptyStore(),
      records: {
        encounter: { e1: { id: "e1", status: "started", round, playerTurnCombatantId: null } },
        combatant: mira ? { [mira.id as string]: mira } : {},
      },
    };
  }
  const miraCb = {
    id: "cb-mira",
    encounterId: "e1",
    kind: "pc",
    entityId: "mira",
    name: "Mira",
    initiative: 15,
  };
  const view = (store: ReturnType<typeof emptyStore>, id = "mira") =>
    rollActionView(routeFor(rollRoutes, store, id, "initiative"), "initiative");

  test("FR-CHAR-24 with combat's route: round ≥ 1 + initiative set → hidden; null → routed button", () => {
    expect(view(combatStore(miraCb, 1))).toBe("locked");
    expect(view(combatStore(miraCb, 3))).toBe("locked");
    expect(view(combatStore({ ...miraCb, initiative: null }, 1))).toBe("button");
    expect(
      routeFor(rollRoutes, combatStore({ ...miraCb, initiative: null }, 1), "mira", "initiative"),
    ).not.toBeNull();
    // Round 0: everyone may roll (the DM overwrites).
    expect(view(combatStore(miraCb, 0))).toBe("button");
  });

  test("FR-CHAR-24 OQ-CHAR-19 unclaimed characters keep a plain char.roll button after round 1", () => {
    // (a) not in the started encounter.
    expect(view(combatStore(miraCb, 1), "thorn")).toBe("button");
    expect(routeFor(rollRoutes, combatStore(miraCb, 1), "thorn", "initiative")).toBeNull();
    // (b) a PC hidden from its owner: no combatant in the player's store.
    expect(routeFor(rollRoutes, combatStore(null, 1), "mira", "initiative")).toBeNull();
    expect(view(combatStore(null, 1))).toBe("button");
    // (c) a removed PC.
    const removed = combatStore({ ...miraCb, removed: true }, 1);
    expect(routeFor(rollRoutes, removed, "mira", "initiative")).toBeNull();
    expect(view(removed)).toBe("button");
  });
});

describe("FR-CHAR-12 in flight and errors", () => {
  test("FR-CHAR-12 a double click sends one intent; next one after ack / reject", async () => {
    const states: boolean[] = [];
    const f = createInFlight((b) => states.push(b));
    let resolve: () => void = () => {};
    let calls = 0;
    const fn = () => {
      calls++;
      return new Promise<void>((r) => {
        resolve = r;
      });
    };
    const errors: unknown[] = [];
    expect(f.run(fn, (e) => errors.push(e))).toBe(true);
    expect(f.run(fn, (e) => errors.push(e))).toBe(false);
    expect([f.busy, calls]).toEqual([true, 1]);
    resolve();
    await Bun.sleep(0);
    expect(f.busy).toBe(false);
    expect(
      f.run(
        () => Promise.reject(new Error("nope")),
        (e) => errors.push(e),
      ),
    ).toBe(true);
    await Bun.sleep(0);
    expect(f.busy).toBe(false);
    expect((errors[0] as Error).message).toBe("nope");
    expect(states).toEqual([true, false, true, false]);
  });

  test("FR-CHAR-12 reject → its message; lost in flight → connection-lost text", () => {
    expect(intentErrorText(new IntentRejected("conflict", "No weapon attack"))).toBe(
      "No weapon attack",
    );
    expect(
      intentErrorText(new IntentRejected("invalid", "Invalid input", [{ message: "Too big" }])),
    ).toBe("Too big");
    expect(intentErrorText(new IntentRejected("disconnected", "Connection lost"))).toBe(
      CONNECTION_LOST,
    );
    expect(CONNECTION_LOST).toBe(
      "Connection lost \u2014 check the game log / HP before trying again",
    );
  });
});

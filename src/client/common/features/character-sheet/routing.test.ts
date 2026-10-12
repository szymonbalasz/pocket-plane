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
  routeFor,
  sendSheetRoll,
} from "./routing";

const sent: [string, unknown][] = [];
const send = (name: string, payload: unknown) => {
  sent.push([name, payload]);
  return Promise.resolve({ ok: true });
};

describe("FR-CHAR-16 roll routing", () => {
  test("FR-CHAR-16 empty registry → char.roll with the roll control's input", async () => {
    expect(rollRoutes).toEqual([]);
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

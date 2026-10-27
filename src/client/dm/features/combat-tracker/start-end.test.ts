// FR-CBT-59 End confirm count, FR-CBT-60 windows after the DM's own Start / End.
import { describe, expect, mock, test } from "bun:test";
import { DAMAGE_CARD_END_RULE } from "@shared/combat-tracker/end-rule";
import { DAMAGE_CARD_KIND } from "@shared/combat-tracker/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { renderedWindowRects } from "@ui/features/play-shell/free-area";
import type { Rect } from "@ui/features/play-shell/geometry";
import {
  defaultLayout,
  reduce,
  type WindowAction,
  type Windows,
} from "@ui/features/play-shell/manager";
import { dmNotificationViews } from "../../notification-views";
import {
  END_FIRST_SENTENCE,
  endAndFollow,
  endPendingCount,
  endPendingText,
  idleInitiativeOnLoad,
  startAndFollow,
} from "./start-end";

// The players panel pulls in the DM session at import (no DOM in bun test).
mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

let seq = 0;
const note = (kind: string, encounterId: string, state: NotificationRecord["state"] = "pending") =>
  ({
    id: `n${++seq}`,
    seq,
    kind,
    state,
    payload: { encounterId },
  }) as unknown as NotificationRecord;

describe("FR-CBT-59 confirm count", () => {
  const viewOf = (kind: string) => dmNotificationViews.get(kind);

  test("FR-CBT-59 confirm count: pending cards of this encounter only; a kind without an end rule is not counted", () => {
    const notes = [
      note(DAMAGE_CARD_KIND, "e1"),
      note(DAMAGE_CARD_KIND, "e1"),
      note(DAMAGE_CARD_KIND, "e1", "resolved"),
      note(DAMAGE_CARD_KIND, "e1", "dismissed"),
      note(DAMAGE_CARD_KIND, "e0"),
      // A pending `cbtx-concentration`-like card with the same encounterId, no end rule.
      note("cbtx-concentration", "e1"),
      note("test", "e1"),
    ];
    expect(endPendingCount(notes, viewOf, "e1")).toBe(2);
    expect(endPendingCount(notes, viewOf, "e9")).toBe(0);
  });

  test("FR-CBT-59 confirm copy: N card(s); 0 → first sentence only", () => {
    expect(END_FIRST_SENTENCE).toBe("Combatants leave the initiative list.");
    expect(endPendingText(3)).toBe(
      "3 pending cards will be dismissed: apply them first if they count.",
    );
    expect(endPendingText(1)).toBe(
      "1 pending card will be dismissed: apply it first if it counts.",
    );
    expect(endPendingText(0)).toBe("");
  });

  test("FR-CBT-59 DAMAGE_CARD_END_RULE is the same object on the DM view (server kind: end-rule.test)", () => {
    expect(dmNotificationViews.get(DAMAGE_CARD_KIND)?.endRule).toBe(DAMAGE_CARD_END_RULE);
  });
});

describe("FR-CBT-60 windows follow the DM's own Start / End", () => {
  function fx() {
    const actions: WindowAction[] = [];
    let appearances = 0;
    return {
      actions,
      appearances: () => appearances,
      dispatch: (a: WindowAction) => void actions.push(a),
      noteAppearance: () => {
        appearances += 1;
      },
    };
  }

  test("FR-CBT-60 own Start ack → minimise Encounters, then open Initiative, one noteAppearance()", async () => {
    const f = fx();
    expect(await startAndFollow(async () => null, f)).toBeNull();
    expect(f.actions).toEqual([
      { type: "minimise", kind: "cbt.encounters" },
      { type: "open", kind: "cbt.initiative", by: "feature" },
    ]);
    expect(f.appearances()).toBe(1);
  });

  test("FR-CBT-60 / FR-SHELL-41 Start at 1280×720, Compendium on Initiative's spot: Initiative lands clear of the Game log, the Compendium and every open window", async () => {
    const viewport = { w: 1280, h: 720 };
    const available = new Set(dmWindows.defs.map((d) => d.kind));
    const ctx = { registry: dmWindows, viewport, available };
    const overlaps = (a: Rect, b: Rect) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    // Reset layout, Initiative idle (minimised); an untouched Compendium over its spot (a dragged,
    // remembered one would stay under Initiative: FR-SHELL-151); Encounters open.
    let ws: Windows = reduce(defaultLayout(dmWindows, viewport), { type: "reset" }, ctx);
    ws = reduce(ws, { type: "minimise", kind: "cbt.initiative" }, ctx);
    ws = reduce(ws, { type: "open", kind: "cmp.compendium" }, ctx);
    const spot = { x: 808, y: 104, w: 440, h: 560 };
    ws = ws.map((w) => (w.kind === "cmp.compendium" ? { ...w, ...spot } : w));
    ws = reduce(ws, { type: "open", kind: "cbt.encounters" }, ctx);
    await startAndFollow(async () => null, {
      dispatch: (a) => {
        ws = reduce(ws, a, ctx);
      },
      noteAppearance: () => {},
    });
    const of = (kind: string) => {
      const w = ws.find((x) => x.kind === kind);
      if (!w) throw new Error(`${kind} not in the layout`);
      return w;
    };
    const init = of("cbt.initiative");
    expect(init.state).toBe("open");
    expect(of("cbt.encounters").state).toBe("minimised");
    const [shown] = renderedWindowRects([init], dmWindows, available, viewport);
    if (!shown) throw new Error("Initiative not rendered");
    for (const kind of ["dice.log", "cmp.compendium"]) {
      expect(of(kind).state).toBe("open");
      expect(overlaps(shown, of(kind)) ? `Initiative over ${kind}` : "ok").toBe("ok");
    }
    const others = ws.filter((w) => w.kind !== "cbt.initiative");
    for (const o of renderedWindowRects(others, dmWindows, available, viewport)) {
      expect(overlaps(shown, o) ? `Initiative over ${JSON.stringify(o)}` : "ok").toBe("ok");
    }
    // Initiative is in front of every other window.
    expect(Math.max(...ws.map((w) => w.z))).toBe(init.z);
  });

  test("FR-CBT-60 / FR-SHELL-151 Start at 1280×720, Compendium dragged onto Initiative's spot (remembered): Initiative takes its zone on top, the Compendium's stored rect unchanged under it", async () => {
    const viewport = { w: 1280, h: 720 };
    const available = new Set(dmWindows.defs.map((d) => d.kind));
    const ctx = { registry: dmWindows, viewport, available };
    let ws: Windows = reduce(defaultLayout(dmWindows, viewport), { type: "reset" }, ctx);
    const zone = ws.find((w) => w.kind === "cbt.initiative");
    ws = reduce(ws, { type: "minimise", kind: "cbt.initiative" }, ctx);
    ws = reduce(ws, { type: "open", kind: "cmp.compendium" }, ctx);
    const spot = { x: 808, y: 104, w: 440, h: 560 };
    ws = reduce(ws, { type: "setRect", kind: "cmp.compendium", rect: spot }, ctx);
    await startAndFollow(async () => null, {
      dispatch: (a) => {
        ws = reduce(ws, a, ctx);
      },
      noteAppearance: () => {},
    });
    const init = ws.find((w) => w.kind === "cbt.initiative");
    const cmp = ws.find((w) => w.kind === "cmp.compendium");
    expect(init && { x: init.x, y: init.y, w: init.w, h: init.h }).toEqual(
      zone && { x: zone.x, y: zone.y, w: zone.w, h: zone.h },
    );
    expect(cmp && { state: cmp.state, x: cmp.x, y: cmp.y, w: cmp.w, h: cmp.h }).toEqual({
      state: "open",
      ...spot,
    });
    expect(Math.max(...ws.map((w) => w.z))).toBe(init?.z ?? -1);
  });

  test("FR-CBT-60 own Start ack → settle (one layout frame) before any window changes", async () => {
    const f = fx();
    let settled = 0;
    await startAndFollow(async () => null, {
      ...f,
      settle: async () => {
        if (settled === 0) expect(f.actions).toEqual([]);
        settled += 1;
      },
    });
    expect(settled).toBe(2);
    expect(f.actions.length).toBe(2);
  });

  test("FR-CBT-150 Initiative settles before the refit: noteAppearance() after Initiative opened and its grown height was reported (the second settle), once", async () => {
    const f = fx();
    const log: string[] = [];
    await startAndFollow(async () => null, {
      dispatch: (a) => {
        f.dispatch(a);
        log.push(a.type);
      },
      noteAppearance: () => {
        f.noteAppearance();
        log.push("appearance");
      },
      // A fake layout frame: after the open, the frame lays out Initiative's rows and reports
      // its grown height.
      settle: async () => {
        log.push(f.actions.length === 0 ? "settle" : "grown height reported");
      },
    });
    expect(log).toEqual(["settle", "minimise", "open", "grown height reported", "appearance"]);
    expect(f.appearances()).toBe(1);
  });

  test("FR-SHELL-40 / FR-SHELL-41 M8 at 1280×720: Initiative's rows need 302 px; placed at Start, its rendered (grown) rect overlaps no open window", async () => {
    const viewport = { w: 1280, h: 720 };
    const available = new Set(dmWindows.defs.map((d) => d.kind));
    // The walkthrough's measured content heights: Initiative with Crypt's three rows.
    const heights = new Map<string, number>();
    const ctx = {
      registry: dmWindows,
      viewport,
      available,
      heights: (id: string) => heights.get(id),
    };
    const overlaps = (a: Rect, b: Rect) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    // Reset layout (Game log 68,508 690×200, FR-DICE-38, K5; Initiative 868,60), idle Initiative
    // minimised; Compendium from the launcher, then Encounters from the launcher.
    let ws: Windows = reduce(defaultLayout(dmWindows, viewport), { type: "reset" }, ctx);
    ws = reduce(ws, { type: "minimise", kind: "cbt.initiative" }, ctx);
    ws = reduce(ws, { type: "open", kind: "cmp.compendium" }, ctx);
    ws = reduce(ws, { type: "open", kind: "cbt.encounters" }, ctx);
    const of = (kind: string) => {
      const w = ws.find((x) => x.kind === kind);
      if (!w) throw new Error(`${kind} not in the layout`);
      return w;
    };
    expect(of("dice.log")).toMatchObject({ x: 68, y: 508, w: 690, h: 200 });
    const launched = renderedWindowRects(
      [of("cmp.compendium"), of("cbt.encounters")],
      dmWindows,
      available,
      viewport,
    );
    const initStored = of("cbt.initiative");
    expect(launched.some((r) => overlaps(r, initStored))).toBe(true); // over Initiative's spot
    heights.set("cbt.initiative:main", 302);
    await startAndFollow(async () => null, {
      dispatch: (a) => {
        ws = reduce(ws, a, ctx);
      },
      noteAppearance: () => {},
    });
    const init = of("cbt.initiative");
    expect(init.state).toBe("open");
    const measured = new Map(heights);
    const [shown] = renderedWindowRects([init], dmWindows, available, viewport, measured);
    if (!shown) throw new Error("Initiative not rendered");
    // Placed at least as tall as it renders: the stored rect is the rendered one.
    expect(shown.h).toBeGreaterThanOrEqual(302);
    expect(init.h).toBe(shown.h);
    const others = ws.filter((w) => w.kind !== "cbt.initiative");
    const rects = renderedWindowRects(others, dmWindows, available, viewport, measured);
    expect(rects.length).toBe(2); // Game log, Compendium
    for (const o of rects) {
      expect(overlaps(shown, o) ? `Initiative over ${JSON.stringify(o)}` : "ok").toBe("ok");
    }
  });

  test("FR-CBT-60 own End ack → minimise Initiative", async () => {
    const f = fx();
    await endAndFollow(async () => null, f);
    expect(f.actions).toEqual([{ type: "minimise", kind: "cbt.initiative" }]);
  });

  test("FR-CBT-60 reject or dropped connection → nothing (snapshots and reconnects never run it)", async () => {
    const f = fx();
    await startAndFollow(async () => undefined, f);
    await endAndFollow(async () => undefined, f);
    expect(f.actions).toEqual([]);
    expect(f.appearances()).toBe(0);
  });
});

describe("P3 glitch 3: an empty Initiative opens minimised", () => {
  const fx = () => {
    const actions: WindowAction[] = [];
    let appearances = 0;
    return {
      actions,
      appearances: () => appearances,
      dispatch: (a: WindowAction) => void actions.push(a),
      noteAppearance: () => {
        appearances += 1;
      },
    };
  };

  test("FR-CBT-60 page load, no started encounter, Initiative open → minimised, map refits", () => {
    const f = fx();
    idleInitiativeOnLoad({ started: false, open: true }, f);
    expect(f.actions).toEqual([{ type: "minimise", kind: "cbt.initiative" }]);
    expect(f.appearances()).toBe(1);
  });

  test("FR-CBT-60 page load in combat, or Initiative not open → nothing", () => {
    const f = fx();
    idleInitiativeOnLoad({ started: true, open: true }, f);
    idleInitiativeOnLoad({ started: false, open: false }, f);
    expect(f.actions).toEqual([]);
    expect(f.appearances()).toBe(0);
  });
});

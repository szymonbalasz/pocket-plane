// FR-CBT-59 End confirm count, FR-CBT-60 windows after the DM's own Start / End.
import { describe, expect, test } from "bun:test";
import { DAMAGE_CARD_END_RULE } from "@shared/combat-tracker/end-rule";
import { DAMAGE_CARD_KIND } from "@shared/combat-tracker/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { WindowAction } from "@ui/features/play-shell/manager";
import { dmNotificationViews } from "../../notification-views";
import {
  END_FIRST_SENTENCE,
  endAndFollow,
  endPendingCount,
  endPendingText,
  idleInitiativeOnLoad,
  startAndFollow,
} from "./start-end";

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

  test("FR-CBT-60 own Start ack → open Initiative, minimise Encounters, one noteAppearance()", async () => {
    const f = fx();
    expect(await startAndFollow(async () => null, f)).toBeNull();
    expect(f.actions).toEqual([
      { type: "open", kind: "cbt.initiative" },
      { type: "minimise", kind: "cbt.encounters" },
    ]);
    expect(f.appearances()).toBe(1);
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

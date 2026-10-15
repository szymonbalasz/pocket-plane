import { describe, expect, test } from "bun:test";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { charxApprovedView, charxDraftView, draftToastsShown } from "./note-views";
import { sheetSelection } from "./selection";
import { CHAR_SHEET_KIND } from "./window";

const note = (payload: unknown) => ({ id: "n1", payload }) as unknown as NotificationRecord;

describe("FR-CHARX-45 FR-CHARX-46 G8 views", () => {
  test("FR-CHARX-45 Review opens char.sheet on the draft, no intent", async () => {
    sheetSelection.setState({ selectedId: "other", npcId: null, editId: null });
    const opened: string[] = [];
    const sent: string[] = [];
    let closed = 0;
    const ctx = {
      send: async (name: string) => {
        sent.push(name);
      },
      openWindow: (kind: string) => {
        opened.push(kind);
      },
      // FR-NOTE-26: filled by the runtime (required since fix/combat2-polish).
      origin: { source: "history" as const, rect: { x: 0, y: 0, w: 0, h: 0 } },
      closeToast: () => {
        closed += 1;
      },
    };
    await charxDraftView.onAction?.(note({ characterId: "brin" }), ctx);
    expect(sheetSelection.getState().selectedId).toBe("brin");
    expect(opened).toEqual([CHAR_SHEET_KIND]);
    expect(sent).toEqual([]);
    // P3 glitch 8: Review closes its toast (the row stays pending).
    expect(closed).toBe(1);
    // A malformed payload does nothing.
    await charxDraftView.onAction?.(note({}), ctx);
    expect(opened).toHaveLength(1);
    expect(closed).toBe(1);
  });

  test("FR-CHARX-45 P3 glitch 8: the open sheet on a draft closes that draft's pending toast only", () => {
    const row = (id: string, characterId: string, o: object = {}) =>
      ({
        id,
        kind: "charx-draft",
        state: "pending",
        payload: { characterId },
        ...o,
      }) as unknown as NotificationRecord;
    const notes = [
      row("n1", "sela"),
      row("n2", "brin"),
      row("n3", "sela", { state: "resolved" }),
      row("n4", "sela", { kind: "charx-approved" }),
    ];
    expect(draftToastsShown(notes, "sela")).toEqual(["n1"]);
    expect(draftToastsShown(notes, null)).toEqual([]);
  });

  test("FR-CHARX-46 approval card is info: no action", () => {
    expect(charxApprovedView.onAction).toBeUndefined();
    expect(charxApprovedView.genericResolve).toBeUndefined();
  });
});

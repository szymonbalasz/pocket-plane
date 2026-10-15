import { describe, expect, test } from "bun:test";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { charxApprovedView, charxDraftView } from "./note-views";
import { sheetSelection } from "./selection";
import { CHAR_SHEET_KIND } from "./window";

const note = (payload: unknown) => ({ id: "n1", payload }) as unknown as NotificationRecord;

describe("FR-CHARX-45 FR-CHARX-46 G8 views", () => {
  test("FR-CHARX-45 Review opens char.sheet on the draft, no intent", async () => {
    sheetSelection.setState({ selectedId: "other", npcId: null, editId: null });
    const opened: string[] = [];
    const sent: string[] = [];
    const ctx = {
      send: async (name: string) => {
        sent.push(name);
      },
      openWindow: (kind: string) => {
        opened.push(kind);
      },
      // FR-NOTE-26: filled by the runtime (required since fix/combat2-polish).
      origin: { source: "history" as const, rect: { x: 0, y: 0, w: 0, h: 0 } },
      closeToast: () => {},
    };
    await charxDraftView.onAction?.(note({ characterId: "brin" }), ctx);
    expect(sheetSelection.getState().selectedId).toBe("brin");
    expect(opened).toEqual([CHAR_SHEET_KIND]);
    expect(sent).toEqual([]);
    // A malformed payload does nothing.
    await charxDraftView.onAction?.(note({}), ctx);
    expect(opened).toHaveLength(1);
  });

  test("FR-CHARX-46 approval card is info: no action", () => {
    expect(charxApprovedView.onAction).toBeUndefined();
    expect(charxApprovedView.genericResolve).toBeUndefined();
  });
});

import { describe, expect, test } from "bun:test";
import type { RecordStore } from "@shared/protocol/store";
import type { TokenView } from "@shared/scenes-map/schemas";
import { DEAD_CROSS, deadTokenOverlay } from "./dead-overlay";
import { tokenOverlays } from "./token-overlays";

const store = { records: {} } as unknown as RecordStore;
const view = { client: "player", selected: false, targeting: false } as const;
const tok = (o: Partial<TokenView> = {}) => ({ id: "t1", ...o }) as TokenView;

describe("FR-MAP-151 dead token overlay", () => {
  test("FR-MAP-151 a token marked dead gets the red X; alive → nothing; registered", () => {
    expect(deadTokenOverlay.decorate?.(tok({ dead: true }), store, view)).toEqual({
      cross: DEAD_CROSS,
    });
    expect(DEAD_CROSS.tone).toBe("down");
    expect(deadTokenOverlay.decorate?.(tok(), store, view)).toBeNull();
    expect(tokenOverlays).toContain(deadTokenOverlay);
  });
});

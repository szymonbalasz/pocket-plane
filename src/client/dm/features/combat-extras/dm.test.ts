// DM-only CBTX client logic: FR-CBTX-06 expiry Toast predicate (live TurnChanged frames only),
// FR-CBTX-25 skip cue with dead PCs.
import { describe, expect, test } from "bun:test";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { skipText } from "@ui/features/combat-extras/skip";
import { expiredToastText } from "./expired";

const store: RecordStore = {
  ...emptyStore(),
  records: {
    combatant: { "k-g2": { id: "k-g2", name: "Goblin 2" } },
    entity: { mira: { id: "mira", name: "Mira" }, thorn: { id: "thorn", name: "Thorn" } },
  },
};
const ended = (id: string, o: object) => ({
  type: "effect",
  id,
  op: "upsert" as const,
  data: {
    id,
    kind: "custom",
    condition: null,
    level: null,
    label: "Bless",
    targetCombatantId: null,
    targetCharacterId: null,
    endedReason: "expired",
    ...o,
  },
});

describe("FR-CBTX-06 expiry Toast", () => {
  test("FR-CBTX-06 'Ended: Bless (Mira, Thorn)' from a TurnChanged frame's expired effects", () => {
    const frame = {
      cause: { name: "TurnChanged" },
      changes: [
        { type: "encounter", id: "e1", op: "upsert" as const, data: {} },
        ended("a", { targetCharacterId: "mira" }),
        ended("b", { targetCharacterId: "thorn" }),
        ended("c", { label: "Bane", targetCombatantId: "k-g2" }),
        ended("d", { label: "Hex", targetCombatantId: "k-g2", endedReason: "concentration" }),
      ],
    };
    expect(expiredToastText(frame, store)).toBe("Ended: Bless (Mira, Thorn), Bane (Goblin 2)");
  });

  test("FR-CBTX-06 other causes or no expiry → no Toast", () => {
    const changes = [ended("a", { targetCharacterId: "mira" })];
    expect(expiredToastText({ cause: { name: "EffectsEnded" }, changes }, store)).toBeNull();
    expect(
      expiredToastText(
        {
          cause: { name: "TurnChanged" },
          changes: [{ type: "encounter", id: "e1", op: "upsert", data: {} }],
        },
        store,
      ),
    ).toBeNull();
  });
});

describe("FR-CBTX-25 skip cue", () => {
  test("FR-CBTX-25 'Skipped Goblin (down), Thorn (dead) · Round 2'; FR-CBT-50 text unchanged without dead", () => {
    expect(skipText({ names: ["Goblin", "Thorn"], round: 2 }, new Set(["Thorn"]))).toBe(
      "Skipped Goblin (down), Thorn (dead) · Round 2",
    );
    expect(skipText({ names: ["Thorn"], round: null }, new Set(["Thorn"]))).toBe(
      "Skipped Thorn (dead)",
    );
    expect(skipText({ names: ["Goblin", "Goblin 2"], round: null }, new Set())).toBe(
      "Skipped Goblin, Goblin 2 (down)",
    );
  });
});

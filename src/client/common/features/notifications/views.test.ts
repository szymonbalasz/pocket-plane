// FR-NOTE-29 view encounter link; FR-NOTE-26 / -30 contract fields are optional (old views load).
import { describe, expect, test } from "bun:test";
import { BellIcon } from "lucide-react";
import { createNotificationViews, defineNotificationView, encounterIdOfView } from "./views";

const endRule = {
  onEncounterEnd: "dismiss" as const,
  encounterIdOf: (p: unknown) => (p as { encounterId?: string }).encounterId ?? null,
};

describe("notification view contract (sprint 2)", () => {
  test("FR-NOTE-29 encounterIdOf: the view's own, else the end rule's, else null", () => {
    const own = defineNotificationView({
      kind: "a",
      icon: BellIcon,
      encounterIdOf: (p) => (p as { enc: string }).enc,
      endRule,
    });
    const ruled = defineNotificationView({ kind: "b", icon: BellIcon, endRule });
    const plain = defineNotificationView({ kind: "c", icon: BellIcon });
    expect(encounterIdOfView(own, { enc: "e1", encounterId: "e2" })).toBe("e1");
    expect(encounterIdOfView(ruled, { encounterId: "e2" })).toBe("e2");
    expect(encounterIdOfView(plain, { encounterId: "e2" })).toBeNull();
    expect(encounterIdOfView(undefined, {})).toBeNull();
  });

  test("views without the new fields still register; cueTokens is a plain function", () => {
    const views = createNotificationViews([
      { kind: "old", icon: BellIcon },
      { kind: "cue", icon: BellIcon, cueTokens: () => ["t1"] },
    ]);
    expect(views.get("old")?.cueTokens).toBeUndefined();
    expect(views.get("cue")?.cueTokens?.({} as never, {} as never)).toEqual(["t1"]);
  });
});

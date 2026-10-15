import { describe, expect, test } from "bun:test";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { concentrationView } from "@ui/features/combat-extras/concentration";
import { createNotificationViews } from "@ui/features/notifications/views";
import { dmDamageCardView } from "./card-view";
import { pendingForEncounter, pendingRowText } from "./pending";

const views = createNotificationViews([dmDamageCardView, concentrationView]);

const note = (id: string, seq: number, o: Partial<NotificationRecord>): NotificationRecord =>
  ({
    id,
    seq,
    state: "pending",
    actionRole: "dm",
    text: id,
    ...o,
  }) as NotificationRecord;

describe("FR-CBT-79 pending list", () => {
  const card = note("card", 3, { kind: "damage-card", payload: { encounterId: "e1" } });
  const conc = note("conc", 2, {
    kind: "cbtx-concentration",
    actionRole: "player",
    text: "Mira: concentration save DC 10 (Bless)",
    payload: { effectId: "x", encounterId: "e1" },
  });
  const other = note("other", 1, {
    kind: "cbtx-concentration",
    payload: { effectId: "y", encounterId: "e2" },
  });
  const loose = note("loose", 4, { kind: "test", payload: { encounterId: "e1" } });

  test("FR-CBT-79 pending list: damage card + linked concentration card, oldest first; other encounter's, closed and unlinked kinds not listed", () => {
    const rows = [card, conc, other, loose, { ...card, id: "done", state: "resolved" as const }];
    expect(pendingForEncounter(rows, "e1", views).map((n) => n.id)).toEqual(["conc", "card"]);
    expect(pendingForEncounter(rows, "e2", views).map((n) => n.id)).toEqual(["other"]);
    expect(pendingForEncounter(rows, null, views)).toEqual([]);
  });

  test("FR-CBT-79 row text: player-owned → 'Waiting for Mira: …'; DM-owned and damage cards as their text", () => {
    expect(pendingRowText(conc)).toBe("Waiting for Mira: concentration save DC 10 (Bless)");
    expect(pendingRowText({ ...conc, actionRole: "dm" })).toBe(conc.text);
    expect(pendingRowText({ ...card, actionRole: "player" })).toBe(card.text);
  });
});

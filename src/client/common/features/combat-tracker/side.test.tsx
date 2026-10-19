// FR-CBT-104 (#252) side UI, client: the chip rule (DM and players), the token badge, the DM's menu
// labels (the builder's "Friendly" Switch: dm/…/encounter-draft.test.ts). Static server render.
import { describe, expect, test } from "bun:test";
import type { Side } from "@shared/combat-tracker/schemas";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../../components/ui/overlays";
import { SideChip } from "./parts";
import { sideChip, sideMenuOf } from "./side";
import { sideBadge } from "./token-overlay";
import { turnAlertFor } from "./turn-alert";

type K = "pc" | "monster";
/** A DM row: true `side` and `publicSide` (null = the kind's default). */
const dm = (kind: K, side: Side | null, publicSide: Side | null) => ({
  id: "c1",
  kind,
  side,
  publicSide,
});
/** A player's row: `side` = the side they were openly shown, no `publicSide`. */
const player = (kind: K, side: Side) => ({ id: "c1", kind, side });
const chip = (c: Parameters<typeof SideChip>[0]["c"]) =>
  renderToStaticMarkup(
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <SideChip c={c} testId="cbt-init-row-ally" />
    </TooltipProvider>,
  );

describe("FR-CBT-104 side UI", () => {
  test("FR-CBT-104 side UI: Ally / Enemy chip only when it differs from the kind's default", () => {
    expect(sideChip(dm("monster", null, null))).toBeNull();
    expect(sideChip(dm("pc", null, null))).toBeNull();
    expect(sideChip(dm("monster", "enemy", "enemy"))).toBeNull();
    expect(sideChip(dm("monster", "ally", "ally"))).toEqual({ side: "ally", secret: false });
    expect(sideChip(dm("pc", "enemy", "enemy"))).toEqual({ side: "enemy", secret: false });
    // Players: the side they were shown.
    expect(sideChip(player("monster", "enemy"))).toBeNull();
    expect(sideChip(player("pc", "ally"))).toBeNull();
    expect(sideChip(player("monster", "ally"))).toEqual({ side: "ally", secret: false });
    expect(sideChip(player("pc", "enemy"))).toEqual({ side: "enemy", secret: false });
  });

  test("FR-CBT-104 side UI: dashed while secret (DM): a secret charm, a secret enemy PC, a betrayal", () => {
    // Secret ally Goblin (players: enemy).
    expect(sideChip(dm("monster", "ally", null))).toEqual({ side: "ally", secret: true });
    // Mira secretly an enemy (players: ally).
    expect(sideChip(dm("pc", "enemy", null))).toEqual({ side: "enemy", secret: true });
    // Open ally Goblin 2 → secret enemy: its kind's default, still a dashed "Enemy" for the DM.
    expect(sideChip(dm("monster", "enemy", "ally"))).toEqual({ side: "enemy", secret: true });
    const html = chip(dm("pc", "enemy", null));
    expect(html).toContain('data-testid="cbt-init-row-ally"');
    expect(html).toContain('data-value="enemy"');
    expect(html).toContain('data-secret="true"');
    expect(html).toContain("border-dashed");
    expect(html).toContain("Enemy");
    const open = chip(dm("monster", "ally", "ally"));
    expect(open).toContain('data-value="ally"');
    expect(open).toContain("Ally");
    expect(open).not.toContain("border-dashed");
    // The kind's default renders nothing; a player's chip is never dashed.
    expect(chip(dm("monster", null, null))).toBe("");
    expect(chip(player("monster", "ally"))).not.toContain("border-dashed");
  });

  test("FR-CBT-104 side UI: the token badge follows the chip", () => {
    const view = (c: object) => sideBadge(c as Parameters<typeof sideBadge>[0]);
    expect(view({ ...dm("monster", null, null), name: "Goblin" })).toBeNull();
    expect(view({ ...dm("monster", "ally", "ally"), name: "Goblin 2" })).toEqual({
      id: "cbt-token-side",
      icon: "handshake",
      tone: "neutral",
      label: "Ally",
    });
    expect(view({ ...player("pc", "enemy"), name: "Mira" })?.label).toBe("Enemy");
    // Players never see a secret change: their `side` is the old one.
    expect(view({ ...player("monster", "enemy"), name: "Goblin 2" })).toBeNull();
  });

  test("FR-CBT-104 side UI: row menu labels per side; a secret side offers the reveal", () => {
    expect(sideMenuOf(dm("monster", null, null))).toEqual({
      to: "ally",
      label: "Set as ally",
      reveal: null,
    });
    expect(sideMenuOf(dm("monster", "ally", "ally")).label).toBe("Set as enemy");
    expect(sideMenuOf(dm("pc", null, null)).label).toBe("Set as enemy");
    expect(sideMenuOf(dm("pc", "enemy", "enemy")).label).toBe("Set as ally");
    // Secret: the true side may be shown to players (an open set to it).
    expect(sideMenuOf(dm("pc", "enemy", null))).toEqual({
      to: "ally",
      label: "Set as ally",
      reveal: "enemy",
    });
    expect(sideMenuOf(dm("monster", "enemy", "ally")).reveal).toBe("enemy");
  });
});

describe("FR-CBT-103 kind rules unchanged (client)", () => {
  test("FR-CBT-103 kind rules unchanged: an ally Goblin 2's turn alerts nobody; a PC set to enemy still alerts its owner", () => {
    const row = (id: string, kind: K, side: Side, entityId?: string) => ({
      id,
      encounterId: "e1",
      kind,
      side,
      name: id,
      active: true,
      removed: false,
      ...(entityId ? { entityId } : {}),
    });
    const store: RecordStore = {
      ...emptyStore(),
      you: { campaignId: "c", role: "player", playerId: "p1" },
      records: {
        encounter: { e1: { id: "e1", status: "started", round: 1 } },
        combatant: {
          g2: row("g2", "monster", "ally"),
          mira: row("mira", "pc", "enemy", "ch-mira"),
        },
        entity: { "ch-mira": { id: "ch-mira", ownerPlayerId: "p1" } },
      },
    };
    const frame = (turn: string) => ({
      cause: { name: "TurnChanged" },
      changes: [
        {
          type: "encounter",
          id: "e1",
          op: "upsert" as const,
          data: { id: "e1", status: "started", round: 1, playerTurnCombatantId: turn },
        },
      ],
    });
    expect(turnAlertFor(frame("g2"), store)).toBeNull();
    expect(turnAlertFor(frame("mira"), store)?.detail).toBe("mira");
  });
});

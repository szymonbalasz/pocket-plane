// Sprint 6 CP2 (CBT §13.3), player client: Initiative rows for companions (FR-CBT-119) and the
// owner's turn alert (FR-CBT-115). Static render over the companions fight as player-1 (Mira,
// Brakka) and player-2 (Thorn) hold it (`companions-fixture.tsx`).
import { describe, expect, test } from "bun:test";
import type { RecordStore } from "@shared/protocol/store";
import {
  companionStore,
  renderWith,
  rowHtml,
} from "@ui/features/combat-tracker/companions-fixture";
import { turnAlertFor } from "@ui/features/combat-tracker/turn-alert";
import { playerInitiativeWindow } from "./initiative-window";

const Body = playerInitiativeWindow.component;
const as = (viewer: "p1" | "p2") =>
  renderWith(companionStore(viewer), <Body kind="cbt.initiative" instance="" />);

const rowIds = (html: string) =>
  [...html.matchAll(/data-testid="cbt-init-row" data-record-id="([^"]+)"/g)].map((m) => m[1]);

describe("FR-CBT-119 player rows", () => {
  test("FR-CBT-119 player rows: player-1 sees its companions' HP '45 / 59' and the card icon; the owner chip and mode icon", () => {
    const html = as("p1");
    const owl = rowHtml(html, "cbt-init-row", "owlbear");
    expect(owl).toMatch(/data-testid="cbt-init-row-hp" data-record-id="owlbear"[^>]*>45 \/ 59</);
    expect(owl).not.toContain('data-testid="cbt-init-row-band"');
    expect(owl).toMatch(/data-testid="cbt-init-row-card" data-record-id="owlbear"/);
    expect(owl).toMatch(
      /data-testid="cbt-init-row-owner" data-record-id="owlbear" data-value="ch-mira"/,
    );
    expect(owl).toContain("background-color:#e69f00");
    expect(owl).toMatch(
      /data-testid="cbt-init-row-mode" data-record-id="owlbear" data-value="after-owner"/,
    );
    expect(owl).toContain('data-indent="true"');
    // The row is a click target (opens the card).
    expect(owl).toContain("cursor-pointer");
    // Brakka's row holds the drake and Fire Elemental 2 as lines, each with HP + card icon.
    const brakka = rowHtml(html, "cbt-init-row", "brakka");
    for (const id of ["drake", "fe2"]) {
      expect(brakka).toContain(`data-testid="cbt-init-companion" data-record-id="${id}"`);
      expect(brakka).toMatch(new RegExp(`data-testid="cbt-init-row-card" data-record-id="${id}"`));
    }
    expect(brakka).toMatch(/data-testid="cbt-init-row-hp" data-record-id="drake"[^>]*>22 \/ 22</);
    // Thorn's own-initiative summon (another player's): a band, the owner chip, no icon.
    const fe3 = rowHtml(html, "cbt-init-row", "fe3");
    expect(fe3).toMatch(/data-testid="cbt-init-row-band"[^>]*data-value="healthy"/);
    expect(fe3).toMatch(
      /data-testid="cbt-init-row-owner" data-record-id="fe3" data-value="ch-thorn"/,
    );
    expect(fe3).not.toContain("cbt-init-row-card");
    expect(fe3).not.toContain("cursor-pointer");
    // No row of its own for an in-turn companion.
    expect(rowIds(html)).toEqual(["wolf", "brakka", "mira", "owlbear", "goblin", "thorn", "fe3"]);
  });

  test("FR-CBT-119 player rows: player-2 sees the Owlbear's band and owner chip, no numbers, no card icon, no click handler", () => {
    const html = as("p2");
    const owl = rowHtml(html, "cbt-init-row", "owlbear");
    expect(owl).toMatch(/data-testid="cbt-init-row-band"[^>]*data-value="healthy"/);
    expect(owl).not.toContain("cbt-init-row-hp");
    expect(owl).not.toContain("45 / 59");
    expect(owl).not.toContain("cbt-init-row-card");
    expect(owl).not.toContain("cursor-pointer");
    expect(owl).toMatch(
      /data-testid="cbt-init-row-owner" data-record-id="owlbear" data-value="ch-mira"/,
    );
    // Its own Wolf: a line in Thorn's row with HP and the card icon.
    const thorn = rowHtml(html, "cbt-init-row", "thorn");
    expect(thorn).toContain('data-testid="cbt-init-companion" data-record-id="wolfpet"');
    expect(thorn).toMatch(/data-testid="cbt-init-row-card" data-record-id="wolfpet"/);
    // Brakka's lines: bands only.
    const brakka = rowHtml(html, "cbt-init-row", "brakka");
    expect(brakka).toContain('data-testid="cbt-init-companion" data-record-id="drake"');
    expect(brakka).not.toContain("cbt-init-row-card");
    expect(brakka).not.toContain("22 / 22");
  });

  test("FR-CBT-119 player rows: names whole on rows and lines (FR-CBTX-57), lines inside their owner's row (FR-CBT-125)", () => {
    const html = as("p1");
    const names = [...html.matchAll(/<[^>]*data-testid="cbt-init-row-name"[^>]*>/g)].map(
      (m) => m[0],
    );
    expect(names.length).toBe(10);
    for (const n of names) expect(n).not.toContain("truncate");
    const thorn = rowHtml(html, "cbt-init-row", "thorn");
    expect(thorn).toContain('data-testid="cbt-init-companion" data-record-id="wolfpet"');
  });
});

/** A live TurnChanged frame moving the players' turn to `id`. */
const turnFrame = (id: string) => ({
  cause: { name: "TurnChanged" },
  changes: [
    {
      type: "encounter",
      id: "e1",
      op: "upsert" as const,
      data: { id: "e1", status: "started", round: 1, playerTurnCombatantId: id },
    },
  ],
});
const alert = (viewer: "p1" | "p2", id: string, store?: RecordStore) =>
  turnAlertFor(turnFrame(id), store ?? companionStore(viewer, id))?.detail ?? null;

describe("FR-CBT-115 owner's turn alert", () => {
  test("FR-CBT-115 owner's turn alert: the Owlbear's turn alerts player-1 'Owlbear (Mira)', player-2 nothing", () => {
    expect(alert("p1", "owlbear")).toBe("Owlbear (Mira)");
    expect(turnAlertFor(turnFrame("owlbear"), companionStore("p1", "owlbear"))?.title).toBe(
      "Your turn",
    );
    expect(alert("p2", "owlbear")).toBeNull();
  });

  test("FR-CBT-115 owner's turn alert: Brakka's names its in-turn companions; Thorn + Wolf; FE 3 alerts player-2", () => {
    expect(alert("p1", "brakka")).toBe("Brakka + Drake Companion, Fire Elemental 2");
    expect(alert("p2", "thorn")).toBe("Thorn + Wolf");
    expect(alert("p1", "mira")).toBe("Mira");
    expect(alert("p2", "fe3")).toBe("Fire Elemental 3 (Thorn)");
    expect(alert("p1", "fe3")).toBeNull();
    // Another's PC or a plain monster: nothing.
    expect(alert("p2", "brakka")).toBeNull();
    expect(alert("p1", "goblin")).toBeNull();
  });

  test("FR-CBT-115 owner's turn alert: never from a snapshot or another cause", () => {
    const store = companionStore("p1", "owlbear");
    expect(
      turnAlertFor({ ...turnFrame("owlbear"), cause: { name: "CombatantRevealed" } }, store),
    ).toBeNull();
    expect(turnAlertFor({ ...turnFrame("owlbear"), changes: [] }, store)).toBeNull();
  });
});

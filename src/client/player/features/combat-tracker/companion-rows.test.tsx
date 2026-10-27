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
    // FR-KIT-26: the HP bar carries the ID; its numbers follow the track.
    expect(owl).toMatch(
      /data-testid="cbt-init-row-hp"[^>]*data-record-id="owlbear"[^>]*>.*?<span[^>]*>45 \/ 59</,
    );
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
    expect(brakka).toMatch(
      /data-testid="cbt-init-row-hp"[^>]*data-record-id="drake"[^>]*>.*?<span[^>]*>22 \/ 22</,
    );
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
    // K12 re-test (walkthrough 4, amends FR-CBTX-57 for child rows): an after-owner child's name
    // is one line, truncated with its full text in a Tooltip; every other name stays whole.
    const childNames = new Set(
      [
        ...html.matchAll(
          /data-child="true"[^>]*><span data-testid="cbt-init-row-name" data-value="([^"]+)"/g,
        ),
      ].map((m) => m[1]),
    );
    expect([...childNames]).toEqual(["Owlbear"]);
    for (const n of names) {
      const v = /data-value="([^"]+)"/.exec(n)?.[1] ?? "";
      if (childNames.has(v)) expect(n).toMatch(/truncate[^"]*" data-state="closed"/);
      else expect(n).not.toContain("truncate");
    }
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

describe("FR-CBT-107 'After Mira' on player rows (walkthrough fix)", () => {
  test("FR-CBT-107 order per turn mode: an after-owner row says 'After Mira' for every player; own / in-turn rows don't", () => {
    for (const viewer of ["p1", "p2"] as const) {
      const html = as(viewer);
      const owl = rowHtml(html, "cbt-init-row", "owlbear");
      expect(owl).toMatch(
        /data-testid="cbt-init-row-after" data-record-id="owlbear"[^>]*>After Mira</,
      );
      expect(rowHtml(html, "cbt-init-row", "fe3")).not.toContain("cbt-init-row-after");
      expect(rowHtml(html, "cbt-init-row", "goblin")).not.toContain("cbt-init-row-after");
    }
  });
});

/** The `cbt-init-companion` line `id` alone (up to the next line or the row's end). */
const lineOf = (html: string, id: string) => {
  const line = rowHtml(html, "cbt-init-companion", id);
  const end = line.indexOf('data-testid="cbt-init-row"');
  return end < 0 ? line : line.slice(0, end);
};

describe("FR-CBT-142 compact companion line (players)", () => {
  test("FR-CBT-142 compact companion line: owner (player-1) — name, '22 / 22', AC from its card, chips slot, card icon; no ⋯", () => {
    const drake = lineOf(as("p1"), "drake");
    expect(drake).toContain(">Drake Companion<");
    expect(drake).toMatch(
      /data-testid="cbt-init-row-hp"[^>]*data-record-id="drake"[^>]*>.*?<span[^>]*>22 \/ 22</,
    );
    expect(drake).toMatch(/data-testid="cbt-init-row-ac" data-record-id="drake"[^>]*>AC 13</);
    expect(drake).toMatch(/data-testid="cbt-init-row-card" data-record-id="drake"/);
    expect(drake).not.toContain("cbt-init-companion-menu");
    expect(drake).not.toContain("cbt-init-row-menu");
    expect(drake).not.toContain("cbt-init-row-band");
    // One row: NameLine holds the stats (side) and the card icon (end); no portrait or marker.
    expect(drake).toContain("data-name-end");
    expect(drake).not.toContain("Current turn");
  });

  test("FR-CBT-142 compact companion line: other player (player-2) — name, band, chips; no AC, no card icon, no ⋯", () => {
    const drake = lineOf(as("p2"), "drake");
    expect(drake).toContain(">Drake Companion<");
    expect(drake).toMatch(/data-testid="cbt-init-row-band"[^>]*data-value="healthy"/);
    for (const id of ["cbt-init-row-hp", "cbt-init-row-ac", "cbt-init-row-card"]) {
      expect(drake).not.toContain(id);
    }
    expect(drake).not.toContain("cbt-init-companion-menu");
    expect(drake).not.toContain("cursor-pointer");
    // player-2's own in-turn pet (Thorn's Wolf) gets the owner's line.
    const wolf = lineOf(as("p2"), "wolfpet");
    expect(wolf).toMatch(/data-testid="cbt-init-row-card" data-record-id="wolfpet"/);
    expect(wolf).toContain("cbt-init-row-ac");
  });
});

// Sprint 6 CP2 (CBT §13.3), DM client: Initiative rows for companions (FR-CBT-118), the order /
// line layout (FR-CBT-107), Companion ▸ items and intents (FR-CBT-111), the token menu entry.
// Static render over the companions fight (`companions-fixture.tsx`).
import { describe, expect, test } from "bun:test";
import { CBT_INTENTS } from "@shared/combat-tracker/schemas";
import { companionLayout, modeLabel } from "@ui/features/combat-tracker/companions";
import {
  companionStore,
  DM_ROWS,
  renderWith,
  rowHtml,
} from "@ui/features/combat-tracker/companions-fixture";
import { companionIntent, companionMenuOf, PET_OWNER_HINT } from "./companion-menu";
import { dmInitiativeWindow } from "./initiative-window";
import { combatTokenMenu } from "./token-menu-entries";

const Body = dmInitiativeWindow.component;
const dm = () => renderWith(companionStore("dm"), <Body kind="cbt.initiative" instance="" />);

/** Row ids in DOM order. */
const rowIds = (html: string) =>
  [...html.matchAll(/data-testid="cbt-init-row" data-record-id="([^"]+)"/g)].map((m) => m[1]);

describe("FR-CBT-107 order per turn mode (client layout)", () => {
  test("FR-CBT-107 in-turn companion has no row: lines go into the owner's row, after-owner indented, own by its number", () => {
    const layout = companionLayout(DM_ROWS as never[], "position");
    const ids = layout.map((r) => (r.c as { id: string }).id);
    expect(ids).toEqual(["wolf", "brakka", "mira", "owlbear", "goblin", "thorn", "fe3"]);
    const brakka = layout.find((r) => (r.c as { id: string }).id === "brakka");
    expect(brakka?.lines.map((l) => (l as { id: string }).id)).toEqual(["drake", "fe2"]);
    const owlbear = layout.find((r) => (r.c as { id: string }).id === "owlbear");
    expect(owlbear?.indent).toBe(true);
    expect((owlbear?.owner as { id: string } | null)?.id).toBe("mira");
    // `own`: ranked by its number, not indented (its owner chip still names Thorn).
    const fe3 = layout.find((r) => (r.c as { id: string }).id === "fe3");
    expect(fe3?.indent).toBe(false);
    // The owner removed (ranked by the server): the in-turn companion gets its own row.
    const ranked = DM_ROWS.map((r) => (r.id === "drake" ? { ...r, position: 3 } : r));
    expect(
      companionLayout(ranked as never[], "position").map((r) => (r.c as { id: string }).id),
    ).toContain("drake");
    // A line whose owner isn't listed stays a row (never lost).
    const noOwner = DM_ROWS.filter((r) => r.id !== "brakka");
    expect(
      companionLayout(noOwner as never[], "position").map((r) => (r.c as { id: string }).id),
    ).toContain("drake");
  });

  test("FR-CBT-107 order per turn mode: the DM's rows render in rank order with no row for in-turn companions", () => {
    const html = dm();
    expect(rowIds(html)).toEqual(["wolf", "brakka", "mira", "owlbear", "goblin", "thorn", "fe3"]);
    expect(html).not.toContain('data-testid="cbt-init-row" data-record-id="drake"');
  });
});

describe("FR-CBT-118 DM rows", () => {
  test("FR-CBT-118 DM rows: owner chip with the player's colour dot, mode icon, after-owner indented with the owner's number", () => {
    const html = dm();
    const owl = rowHtml(html, "cbt-init-row", "owlbear");
    expect(owl).toContain('data-indent="true"');
    expect(owl).toMatch(
      /data-testid="cbt-init-row-owner" data-record-id="owlbear" data-value="ch-mira"/,
    );
    expect(owl).toContain("background-color:#e69f00");
    expect(owl).toContain(">Mira</span>");
    expect(owl).toMatch(
      /data-testid="cbt-init-row-mode" data-record-id="owlbear" data-value="after-owner"/,
    );
    expect(owl).toContain('aria-label="After Mira"');
    // No roll or input: Mira's number, "After Mira".
    expect(owl).toMatch(
      /data-testid="cbt-init-row-init" data-record-id="owlbear"[^>]*data-value="15"/,
    );
    expect(owl).not.toContain('data-testid="cbt-init-row-roll"');
    expect(owl).not.toMatch(/<input[^>]*data-testid="cbt-init-row-init"/);
    // `own`: the owner chip, the dice icon, its own number input.
    const fe3 = rowHtml(html, "cbt-init-row", "fe3");
    expect(fe3).not.toContain("data-indent");
    expect(fe3).toMatch(
      /data-testid="cbt-init-row-owner" data-record-id="fe3" data-value="ch-thorn"/,
    );
    expect(fe3).toContain("background-color:#56b4e9");
    expect(fe3).toMatch(/data-testid="cbt-init-row-mode" data-record-id="fe3" data-value="own"/);
    expect(fe3).toMatch(/<input[^>]*data-testid="cbt-init-row-init"[^>]*data-record-id="fe3"/);
    // Not a companion: no chip, no icon.
    const goblin = rowHtml(html, "cbt-init-row", "goblin");
    expect(goblin).not.toContain("cbt-init-row-owner");
    expect(goblin).not.toContain("cbt-init-row-mode");
  });

  test("FR-CBT-142 compact companion line: DM — the drake and Fire Elemental 2 are one-row lines in Brakka's row: name, '22 / 22', AC, card, ⋯ (Attack ▸ inside)", () => {
    const html = dm();
    const brakka = rowHtml(html, "cbt-init-row", "brakka");
    expect(
      [...brakka.matchAll(/data-testid="cbt-init-companion" data-record-id="([^"]+)"/g)].map(
        (m) => m[1],
      ),
    ).toEqual(["drake", "fe2"]);
    const drake = brakka.slice(
      brakka.indexOf('data-testid="cbt-init-companion" data-record-id="drake"'),
    );
    const own = drake.slice(0, drake.indexOf('data-record-id="fe2"'));
    expect(own).toContain(">Drake Companion<");
    expect(own).toMatch(
      /data-testid="cbt-init-row-hp"[^>]*data-record-id="drake"[^>]*>.*?<span[^>]*>22 \/ 22</,
    );
    expect(own).toMatch(/data-testid="cbt-init-row-ac" data-record-id="drake">AC [^<]+</);
    expect(own).toContain('data-testid="cbt-init-row-card"');
    expect(own).toMatch(/data-testid="cbt-init-companion-menu" data-record-id="drake"/);
    // One row: no band, no Attack button or row menu of its own (both inside ⋯), no stats line.
    expect(own).not.toContain("cbt-init-row-band");
    expect(own).not.toMatch(/data-testid="cbt-init-row-attack"/);
    expect(own).not.toMatch(/data-testid="cbt-init-row-menu"/);
    // HP, AC ride in the name line's side slot; card + ⋯ in its end slot (NameLine fits them).
    const side = own.slice(own.indexOf("data-name-side"));
    expect(side.indexOf("cbt-init-row-hp")).toBeLessThan(side.indexOf("data-name-end"));
    expect(own.indexOf("data-name-end")).toBeLessThan(own.indexOf("cbt-init-companion-menu"));
    expect(drake).toMatch(
      /data-testid="cbt-init-row-mode" data-record-id="drake" data-value="in-owner-turn"/,
    );
    const label = modeLabel("in-owner-turn", "Brakka").replace("'", "&#x27;");
    expect(drake).toContain(`aria-label="${label}"`);
    // A line sits in its owner's row: no owner chip, no turn marker, no initiative control.
    const line = drake.slice(0, drake.indexOf('data-record-id="fe2"'));
    expect(line).not.toContain("cbt-init-row-owner");
    expect(line).not.toContain("cbt-init-row-init");
    expect(line).not.toContain("Current turn");
  });

  test("FR-CBT-118 DM rows: WF's row rules hold with the extra line (FR-CBTX-57 / FR-CBT-125): names whole, lines inside the row's box", () => {
    const html = dm();
    // FR-CBTX-57: every name (rows and lines) is NameLine's: no truncation class or ellipsis.
    const names = [...html.matchAll(/<[^>]*data-testid="cbt-init-row-name"[^>]*>/g)].map(
      (m) => m[0],
    );
    expect(names.length).toBe(DM_ROWS.length);
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
    // FR-CBT-125: lines are inside a `cbt-init-row` (the list viewport clips and counts rows).
    const lists = html.slice(html.indexOf('data-testid="cbt-init-list"'));
    for (const id of ["drake", "fe2", "wolfpet"]) {
      const at = lists.indexOf(`data-testid="cbt-init-companion" data-record-id="${id}"`);
      expect(at).toBeGreaterThan(-1);
    }
    // The chips ride in the name line's side slot (never fold, FR-CBTX-54).
    const owl = rowHtml(html, "cbt-init-row", "owlbear");
    const side = owl.slice(owl.indexOf("data-name-side"));
    expect(side.indexOf("cbt-init-row-owner")).toBeLessThan(side.indexOf("cbt-init-row-ally"));
  });

  test("FR-CBT-118 DM rows: Companion ▸ items — owner choices, three modes, Release / Turn hostile; a pet's owner locked", () => {
    const pcs = [
      { characterId: "ch-brakka", name: "Brakka", hasPlayer: true },
      { characterId: "ch-mira", name: "Mira", hasPlayer: true },
      { characterId: "ch-npc", name: "Bram", hasPlayer: false },
    ];
    // Goblin 2 (not a companion): owners only.
    const g = companionMenuOf({ ownerCharacterId: null, turnMode: null, pet: false }, pcs);
    expect(g.owners.map((o) => [o.characterId, o.checked, o.reason])).toEqual([
      ["ch-brakka", false, null],
      ["ch-mira", false, null],
      ["ch-npc", false, "Bram has no player"],
    ]);
    expect(g.modes.every((m) => m.reason !== null && !m.checked)).toBe(true);
    expect(g.release).not.toBeNull();
    // A summon of Mira's: all enabled, its mode checked.
    const s = companionMenuOf({ ownerCharacterId: "ch-mira", turnMode: "own", pet: false }, pcs);
    expect(s.modes.map((m) => [m.mode, m.checked, m.reason])).toEqual([
      ["after-owner", false, null],
      ["in-owner-turn", false, null],
      ["own", true, null],
    ]);
    expect(s.owners.find((o) => o.characterId === "ch-mira")?.checked).toBe(true);
    expect(s.release).toBeNull();
    // A pet: modes yes; owner, release and hostile locked to the Party window.
    const p = companionMenuOf(
      { ownerCharacterId: "ch-mira", turnMode: "after-owner", pet: true },
      pcs,
    );
    expect(p.owners.every((o) => o.reason === PET_OWNER_HINT)).toBe(true);
    expect(p.release).toBe(PET_OWNER_HINT);
    expect(p.modes.every((m) => m.reason === null)).toBe(true);
  });

  test("FR-CBT-118 DM rows: the token menu has Companion ▸ between the side and Remove", () => {
    const ids = [...combatTokenMenu].sort((a, b) => a.order - b.order).map((e) => e.id);
    expect(ids.indexOf("cbt.companion")).toBe(ids.indexOf("cbt.side") + 1);
    expect(ids.indexOf("cbt.remove")).toBe(ids.indexOf("cbt.companion") + 1);
  });
});

describe("FR-CBT-111 pet owner and in-turn guard (client)", () => {
  test("FR-CBT-111 pet owner and in-turn guard: each item sends cbt.setCompanion with the server's shape", () => {
    expect(CBT_INTENTS.setCompanion).toBe("cbt.setCompanion");
    const goblin = { id: "g2", turnMode: null, ownerCharacterId: null };
    expect(companionIntent.owner(goblin, "ch-mira")).toEqual({
      combatantId: "g2",
      owner: { characterId: "ch-mira" },
    });
    // A new owner keeps the mode.
    const owl = { id: "owlbear", turnMode: "after-owner" as const, ownerCharacterId: "ch-mira" };
    expect(companionIntent.owner(owl, "ch-brakka")).toEqual({
      combatantId: "owlbear",
      owner: { characterId: "ch-brakka", turnMode: "after-owner" },
    });
    expect(companionIntent.mode(owl, "own")).toEqual({
      combatantId: "owlbear",
      owner: { characterId: "ch-mira", turnMode: "own" },
    });
    expect(companionIntent.release(owl)).toEqual({ combatantId: "owlbear", owner: null });
    // OQ-CBT-82: turn hostile = release + an open side change to enemy, one intent.
    expect(companionIntent.hostile(owl)).toEqual({
      combatantId: "owlbear",
      owner: null,
      side: "enemy",
    });
  });
});

describe("FR-CHARX-59 DM opens the card", () => {
  test("FR-CHARX-59 DM card icon (walkthrough 9): every companion row and in-owner-turn line has the card icon; other rows none", () => {
    const html = dm();
    const cards = [...html.matchAll(/data-testid="cbt-init-row-card" data-record-id="([^"]+)"/g)]
      .map((m) => m[1])
      .sort();
    // Rows (Owlbear after Mira, FE 3 own) and lines (Drake, FE 2 in Brakka's row; Thorn's Wolf).
    expect(cards).toEqual(["drake", "fe2", "fe3", "owlbear", "wolfpet"]);
    expect(rowHtml(html, "cbt-init-companion", "drake")).toContain(
      'data-testid="cbt-init-row-card"',
    );
    for (const id of ["goblin", "wolf", "mira", "brakka", "thorn"]) {
      expect(cards).not.toContain(id);
    }
  });
});

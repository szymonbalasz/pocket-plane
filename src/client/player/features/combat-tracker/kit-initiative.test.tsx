// Kit parity K2 (kit-parity §6.3, FR-KIT-26, -30, -04), player client: the read-only Initiative
// on the kit grid. Static render over the companions fight as player-1 (Mira, Brakka) holds it,
// with the PCs' character figures each player receives (own: full; others: ADR-0063's whitelist).
import { describe, expect, test } from "bun:test";
import type { RecordStore } from "@shared/protocol/store";
import {
  companionStore,
  renderWith,
  rowHtml,
} from "@ui/features/combat-tracker/companions-fixture";
import { pcHp, playerInitiativeWindow } from "./initiative-window";

const Body = playerInitiativeWindow.component;

/** player-1's store: Mira (own, full record) 5 / 12, Thorn (another player's) 30 / 30. */
function p1Store(round = 1): RecordStore {
  const s = companionStore("p1", "goblin");
  const entity = { ...s.records.entity } as Record<string, Record<string, unknown>>;
  entity["ch-mira"] = { ...entity["ch-mira"], hpCurrent: 5, statBlock: { hpMax: 12, ac: 16 } };
  entity["ch-thorn"] = { ...entity["ch-thorn"], hpCurrent: 30, hpMax: 30, tempHp: 0, ac: 18 };
  const enc = { ...(s.records.encounter?.e1 as object), round };
  return { ...s, records: { ...s.records, entity, encounter: { e1: enc } } } as RecordStore;
}

const player = (store = p1Store()) => renderWith(store, <Body kind="cbt.initiative" instance="" />);
const tag = (html: string, id: string, rec?: string) =>
  html.match(
    new RegExp(`<\\w+[^>]*data-testid="${id}"${rec ? `[^>]*data-record-id="${rec}"` : ""}[^>]*>`),
  )?.[0] ?? "";
const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("FR-KIT-26 player hp", () => {
  test("FR-KIT-26 player hp: PCs show the HP bar with numbers from the character the player holds (own and others)", () => {
    expect(pcHp({ hpCurrent: 5, statBlock: { hpMax: 12 } })).toEqual({ cur: 5, max: 12 });
    expect(pcHp({ hpCurrent: 30, hpMax: 30 })).toEqual({ cur: 30, max: 30 });
    expect(pcHp({ name: "Mira" })).toBeNull();
    expect(pcHp(undefined)).toBeNull();
    const html = player();
    const mira = rowHtml(html, "cbt-init-row", "mira");
    expect(tag(mira, "cbt-init-row-hp", "mira")).toContain('data-band="bloodied"');
    expect(mira).toMatch(/data-testid="cbt-init-row-hp"[\s\S]*?>5 \/ 12</);
    const thorn = rowHtml(html, "cbt-init-row", "thorn");
    expect(thorn).toMatch(/data-testid="cbt-init-row-hp"[\s\S]*?>30 \/ 30</);
  });

  test("FR-KIT-26 player hp: an own companion shows its numbers; monsters and others' companions the band word only, never a bar length", () => {
    const html = player();
    expect(rowHtml(html, "cbt-init-row", "owlbear")).toMatch(
      /data-testid="cbt-init-row-hp"[\s\S]*?>45 \/ 59</,
    );
    for (const id of ["goblin", "wolf", "fe3"]) {
      const row = rowHtml(html, "cbt-init-row", id);
      const band = tag(row, "cbt-init-row-band", undefined);
      expect(band).toContain('data-slot="kit-hpbar"');
      expect(band).toMatch(/data-value="(healthy|bloodied|down)"/);
      expect(row).not.toContain("kit-hpbar-fill");
      expect(row).not.toContain('data-testid="cbt-init-row-hp"');
    }
  });

  test("FR-KIT-26 player hp (K9, K6 gap 3): bars with numbers sit on the list's one fixed track (≤ the kit's 120 px), so they line up", () => {
    const html = player();
    for (const id of ["mira", "thorn", "owlbear"]) {
      const row = rowHtml(html, "cbt-init-row", id);
      expect(tag(row, "cbt-init-row-hp", id)).toContain('data-track="fixed"');
      expect(row).toContain("w-[var(--hp-track,120px)] shrink");
      // K9 R1: the same stacked layout hooks as the DM's.
      expect(row).toMatch(
        /data-stats-line="true" class="[^"]*group-data-\[hp-stacked\]\/hp:basis-full/,
      );
    }
  });
});

describe("FR-KIT-30 player rows", () => {
  test("FR-KIT-30 player rows: a centred Round N, rows on the grid (medallion, name, HP line, PCs' large number, status) without grip or actions", () => {
    const html = player();
    const header = html.slice(html.indexOf('data-slot="init-header"') - 40);
    expect(header).toMatch(/text-center/);
    expect(text(header)).toMatch(/^[^<]*Round 1/);
    const goblin = rowHtml(html, "cbt-init-row", "goblin");
    expect(goblin).toContain('data-turn="true"');
    expect(goblin).toContain('aria-label="Current turn"');
    expect(goblin).toContain('data-slot="kit-medallion"');
    expect(goblin).toContain('data-slot="init-status"');
    const mira = tag(html, "cbt-init-row-init", "mira");
    expect(mira).toContain('data-slot="init-number"');
    expect(mira).toContain("text-2xl");
    for (const id of [
      "cbtx-init-row-grip",
      "cbt-init-row-attack",
      "cbt-init-row-menu",
      "cbt-init-menu",
    ]) {
      expect(html).not.toContain(`data-testid="${id}"`);
    }
    // An own companion's row stays clickable (its card).
    expect(rowHtml(html, "cbt-init-row", "owlbear")).toContain("cursor-pointer");
  });
});

describe("FR-KIT-04 player rows show no new fields", () => {
  test("FR-KIT-04 player rows show no new fields: no AC, moved feet, monster numbers or monster initiative; the DM-only rows' parts absent", () => {
    const html = player();
    // AC only on own companions' lines (FR-CBT-142, unchanged), never on a row.
    expect(text(html).match(/AC /g)?.length ?? 0).toBe(
      html.match(/data-testid="cbt-init-row-ac"/g)?.length ?? 0,
    );
    expect(html).not.toContain("cbt-init-row-moved");
    expect(html).not.toContain("cbt-init-row-tip");
    // Monsters: no init number (players see PCs' only, as today); no HP numbers for the Goblin.
    expect(tag(html, "cbt-init-row-init", "goblin")).toBe("");
    expect(rowHtml(html, "cbt-init-row", "goblin")).not.toMatch(/\d+ \/ \d+/);
    // Player-2 holds no numbers for player-1's companions.
    const p2 = renderWith(companionStore("p2"), <Body kind="cbt.initiative" instance="" />);
    expect(rowHtml(p2, "cbt-init-row", "owlbear")).not.toMatch(/\d+ \/ \d+/);
  });
});

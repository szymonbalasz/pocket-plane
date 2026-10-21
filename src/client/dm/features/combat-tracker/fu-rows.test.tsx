// Sprint 7 FU-combat, DM client (static render + pure logic): the Start dialog's kept-HP note
// (FR-CBT-141), the End dialog's summon-token and charmed lines (FR-CBT-144, OQ-CBT-94 A), the
// encounter editor's names, pinned footer and Back test ID (FR-CBT-146, -147, -149), the
// turn-mode radios' names and the portrait test ID (FR-CBT-151, FR-ENT-44). Measured widths and
// heights in a browser: e2e/combat-followups.e2e.ts.
import { describe, expect, test } from "bun:test";
import type { EncounterRecord } from "@shared/combat-tracker/schemas";
import { lazyAfterSnapshot } from "@shared/protocol/lazy";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { Dialog, TooltipProvider } from "@ui/components/ui/overlays";
import { companionStore, renderWith } from "@ui/features/combat-tracker/companions-fixture";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { PetForm } from "../entities/pet-dialog";
import { CreatureForm } from "./creature-form";
import { Editor } from "./encounters-window";
import { EndConfirmDescription } from "./end-confirm";
import {
  END_SUMMONS_SHOWN,
  endCharmedText,
  endLeavers,
  endSummonsText,
  START_KEPT_NOTE,
  startKeptNoteShown,
} from "./start-end";
import { SummonBody } from "./summon-dialog";

const at = { createdAt: "t", updatedAt: "t", portraitAssetId: null, tokenShape: null };
const monster = (id: string, name: string, cr = "1/4") => ({
  ...at,
  id,
  kind: "monster",
  campaignId: "c1",
  name,
  statBlock: { size: "medium", ac: 13, hpMax: 7, initBonus: 2, attacks: [], cr },
  ownerPlayerId: null,
  hpCurrent: null,
  derivedFromId: null,
  companionOf: null,
  turnMode: null,
  petPresent: false,
});

/** The companions fight with FE 2 / FE 3 summoned and Goblin made Mira's (charmed). */
function endStore(): RecordStore {
  const s = companionStore("dm");
  const combatant = { ...s.records.combatant } as Record<string, Record<string, unknown>>;
  for (const id of ["fe2", "fe3"]) {
    combatant[id] = { ...combatant[id], summoned: true, tokenId: `t-${id}` };
  }
  combatant.goblin = {
    ...combatant.goblin,
    ownerCharacterId: "ch-mira",
    ownerPlayerId: "p1",
    turnMode: "after-owner",
    pet: false,
    tokenId: "t-goblin",
  };
  return { ...s, records: { ...s.records, combatant } } as RecordStore;
}

describe("FR-CBT-144 End warns about summon tokens", () => {
  test("FR-CBT-144 End warns about summon tokens: both lines (OQ-CBT-94 A) after the first sentence, before the pending line", () => {
    for (const area of ["cbt-enc", "cbt-init"] as const) {
      const html = renderWith(
        endStore(),
        <Dialog open>
          <EndConfirmDescription encounterId="e1" area={area} />
        </Dialog>,
      );
      expect(html).toContain(
        `data-testid="${area}-end-summons" data-value="2">Summoned creatures&#x27; tokens are removed: Fire Elemental 2, Fire Elemental 3.<`,
      );
      expect(html).toContain(
        `data-testid="${area}-end-charmed">Mira&#x27;s charmed Goblin stays as a monster.<`,
      );
      const first = html.indexOf("Combatants leave the initiative list.");
      expect(first).toBeLessThan(html.indexOf(`${area}-end-summons`));
      expect(html.indexOf(`${area}-end-charmed`)).toBeLessThan(html.indexOf(`${area}-end-pending`));
    }
  });

  test("FR-CBT-144 End warns about summon tokens: no summons and no charmed → no lines; a dismissed summon (inactive) isn't listed; pets aren't charmed", () => {
    // The summons here have no token (nothing for End to remove); nobody is charmed.
    const s = companionStore("dm");
    const combatant = { ...s.records.combatant } as Record<string, Record<string, unknown>>;
    for (const id of ["fe2", "fe3"]) combatant[id] = { ...combatant[id], summoned: true };
    const html = renderWith(
      { ...s, records: { ...s.records, combatant } } as RecordStore,
      <Dialog open>
        <EndConfirmDescription encounterId="e1" area="cbt-init" />
      </Dialog>,
    );
    expect(html).not.toContain("cbt-init-end-summons");
    expect(html).not.toContain("cbt-init-end-charmed");
    const rows = Object.values(endStore().records.combatant ?? {}) as Parameters<
      typeof endLeavers
    >[0];
    const dismissed = rows.map((r) =>
      r.name === "Fire Elemental 2" ? { ...r, active: false } : r,
    );
    expect(endLeavers(dismissed, "e1", () => undefined).summons).toEqual(["Fire Elemental 3"]);
    // Pets (Owlbear, the drake, Thorn's Wolf) are never "charmed".
    expect(endLeavers(rows, "e1", () => undefined).charmed).toEqual([
      { owner: "Mira", name: "Goblin" },
    ]);
  });

  test("FR-CBT-144 End warns about summon tokens: 7 summons → 5 names + 'and 2 more'; the charmed sentence", () => {
    const names = Array.from({ length: 7 }, (_, i) => `Fire Elemental ${i + 1}`);
    expect(END_SUMMONS_SHOWN).toBe(5);
    expect(endSummonsText(names)).toBe(
      "Summoned creatures' tokens are removed: Fire Elemental 1, Fire Elemental 2, Fire Elemental 3, Fire Elemental 4, Fire Elemental 5 and 2 more.",
    );
    expect(endSummonsText([])).toBe("");
    expect(endCharmedText({ owner: "Mira", name: "Goblin 2" })).toBe(
      "Mira's charmed Goblin 2 stays as a monster.",
    );
  });
});

describe("FR-CBT-141 kept HP at Start (Start dialog)", () => {
  test("FR-CBT-141 kept HP at Start: the note shows whenever a monster binding takes a placed token; not for pets, created or token-less ones", () => {
    expect(START_KEPT_NOTE).toBe("Monsters that were in an earlier fight keep their HP.");
    expect(startKeptNoteShown([{ kind: "monster", binding: "token" }])).toBe(true);
    expect(
      startKeptNoteShown([
        { kind: "pc", binding: "token" },
        { kind: "monster", binding: "new" },
        { kind: "monster", binding: "none" },
        { kind: "monster", pet: true, binding: "token" },
      ]),
    ).toBe(false);
  });
});

/**
 * The editor with three entries. Started (read-only): the planned editor's Start dialog reads the
 * shell's free area, which a static render can't (its Start / Delete: the e2e).
 */
function editor(): string {
  const s = companionStore("dm");
  const enc: EncounterRecord = {
    id: "e2",
    campaignId: "c1",
    seq: 2,
    name: "Escort to the Ford",
    status: "started",
    partyCharacterIds: null,
    sceneId: null,
    round: 0,
    turnCombatantId: null,
    playerTurnCombatantId: null,
    createTokens: true,
    addHidden: true,
    startedAt: null,
    endedAt: null,
    createdAt: "t",
    updatedAt: "t",
  } as EncounterRecord;
  const defs = [
    monster("d-goblin", "Goblin"),
    monster("d-elite", "Elite Goblin Warrior", "1/2"),
    monster("d-fe", "Fire Elemental", "5"),
  ];
  const entries = Object.fromEntries(
    defs.map((d, i) => [
      `en${i}`,
      {
        id: `en${i}`,
        campaignId: "c1",
        encounterId: "e2",
        seq: i + 1,
        definitionId: d.id,
        quantity: 2,
        hpMode: "average",
        side: "enemy",
      },
    ]),
  );
  const store = {
    ...s,
    records: {
      ...s.records,
      encounter: { e2: enc },
      "encounter-entry": entries,
      entity: { ...s.records.entity, ...Object.fromEntries(defs.map((d) => [d.id, d])) },
    },
  } as RecordStore;
  return renderWith(store, <Editor encounter={enc} back={() => {}} />);
}

const tags = (html: string, id: string) =>
  [...html.matchAll(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`, "g"))].map((m) => m[0]);

describe("FR-CBT-146 / -147 / -149 encounter editor", () => {
  test("FR-CBT-146 editor names at min width: each entry shows its name whole (wraps between words, ≥ 96 px, never truncated), then CR; the controls wrap to a second line when narrow", () => {
    const html = editor();
    const names = [...html.matchAll(/data-testid="cbt-enc-entry-name"[^>]*>([^<]+)</g)].map(
      (m) => m[1],
    );
    expect(names).toEqual(["Goblin", "Elite Goblin Warrior", "Fire Elemental"]);
    for (const t of tags(html, "cbt-enc-entry-name")) {
      expect(t).toContain("min-w-24");
      expect(t).toContain("[overflow-wrap:normal]");
      expect(t).not.toContain("truncate");
    }
    // The row wraps; the controls are one group pushed right (same line when room, else below).
    for (const t of tags(html, "cbt-enc-entry")) expect(t).toContain("flex-wrap");
    expect(html).toMatch(
      /class="ml-auto flex shrink-0 items-center gap-2"><button[^>]*data-testid="cbt-enc-entry-dec"/,
    );
  });

  test("FR-CBT-147 editor footer pinned: header and actions never scroll; entries, options and party scroll between them", () => {
    const html = editor();
    const root = tags(html, "cbt-enc-editor")[0] ?? "";
    expect(root).toContain("h-full");
    const body = tags(html, "cbt-enc-editor-body")[0] ?? "";
    for (const c of ["min-h-0", "flex-1", "overflow-y-auto"]) expect(body).toContain(c);
    const actions = tags(html, "cbt-enc-editor-actions")[0] ?? "";
    expect(actions).toContain("shrink-0");
    const at = (id: string) => html.indexOf(`data-testid="${id}"`);
    expect(at("cbt-enc-editor-body")).toBeLessThan(at("cbt-enc-entry"));
    expect(at("cbt-enc-party")).toBeLessThan(at("cbt-enc-editor-actions"));
    expect(at("cbt-enc-editor-actions")).toBeLessThan(at("cbt-enc-end"));
  });

  test("FR-CBT-149 editor back test id: Back carries cbt-enc-editor-back, aria-label kept", () => {
    expect(tags(editor(), "cbt-enc-editor-back")[0]).toContain('aria-label="Back"');
  });
});

/** Static render with the DM store of pets-ui (players for the owner Select). */
function renderPetForm(): string {
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        everLive: true,
        store: {
          ...emptyStore(),
          you: { campaignId: "c1", role: "dm", playerId: null },
          records: { entity: {}, player: {} },
        },
        lazy: lazyAfterSnapshot(1),
        connection: { load: () => null, retryLoad: () => null },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <Dialog open>
          <PetForm base={null} onDone={() => {}} />
        </Dialog>
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

describe("FR-CBT-151 / FR-ENT-44 accessible names", () => {
  const LABELS = ["After the owner", "In the owner&#x27;s turn", "Own initiative"];

  test("FR-CBT-151 accessible names: the Summon… dialog's turn-mode radios are named by their labels; the creature form's portrait button has its test ID", () => {
    const html = renderWith(
      companionStore("dm"),
      <Dialog open>
        <SummonBody preset="ch-mira" freeCell={() => null} />
      </Dialog>,
    );
    const radios = tags(html, "cbt-summon-mode");
    expect(radios.map((t) => t.match(/aria-label="([^"]+)"/)?.[1])).toEqual(LABELS);
    for (const t of radios) expect(t).toContain('role="radio"');
    const form = renderWith(
      companionStore("dm"),
      <Dialog open>
        <CreatureForm mode={{ kind: "new" }} close={() => {}} />
      </Dialog>,
    );
    expect(form).toMatch(/<button[^>]*data-testid="cbt-form-portrait"/);
  });

  test("FR-ENT-44 turn-mode radio names: the pet dialog's radios are named by their labels", () => {
    const radios = tags(renderPetForm(), "ent-pet-mode");
    expect(radios.map((t) => t.match(/aria-label="([^"]+)"/)?.[1])).toEqual(LABELS);
    for (const t of radios) expect(t).toContain('role="radio"');
  });
});

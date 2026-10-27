// Kit parity K3 (§6.6, FR-KIT-62–65 + the slice's FR-KIT-01/03/07 checks): the DM's damage-card
// popup as the kit's window: title bar with the Later gem, result lines ending in Result-box
// inputs, one compact line per target, footer Dismiss · card actions · Apply. Static renders of
// the popup over an in-code store (Brakka's Flame Tongue card; a Goblin added as target).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMBATANT_TYPE, ENCOUNTER_TYPE } from "@shared/combat-tracker/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { lazyAfterSnapshot } from "@shared/protocol/lazy";
import type { RecordStore } from "@shared/protocol/store";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { cardNote, combatStore, flameCard } from "@ui/features/gems/combat-fixture";
import { SyncContext, type SyncState } from "@ui/sync/store";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { PopupBody, toHitOutcome } from "./attack-popup";
import { emptyDraft, useCombatDialogs } from "./popup-store";

const GOBLIN = {
  id: "cb-gob",
  encounterId: "e1",
  name: "Goblin",
  kind: "monster",
  hidden: false,
  hpCurrent: 7,
  hpMax: 7,
  tempHp: 0,
  tokenId: null,
  imageAssetId: null,
  entityId: null,
  initiative: 12,
};

function render(note: NotificationRecord, wrap: (n: ReactElement) => ReactElement = (n) => n) {
  const s = combatStore({ viewer: "dm", note });
  const store: RecordStore = {
    ...s,
    records: {
      ...s.records,
      [COMBATANT_TYPE]: { ...s.records[COMBATANT_TYPE], [GOBLIN.id]: GOBLIN },
      [ENCOUNTER_TYPE]: { e1: { id: "e1", status: "started", round: 1, turnCombatantId: null } },
    },
  };
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store,
        notLiveSince: null,
        everLive: true,
        lazy: lazyAfterSnapshot(1),
        connection: { sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {wrap(<PopupBody card={note} close={() => {}} />)}
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

const DM_CARD = cardNote(flameCard(), { audience: "dm", audiencePlayerId: null });
const at = (html: string, needle: string) => html.indexOf(needle);

// A static render reads a zustand store's initial state (the server snapshot): the Goblin as an
// added target (FR-CBT-33 "Add target") goes into it for each test.
const initial = useCombatDialogs.getInitialState() as { drafts: Record<string, unknown> };
const before = initial.drafts;
beforeEach(() => {
  initial.drafts = { n1: { ...emptyDraft(), added: [GOBLIN.id] } };
});
afterEach(() => {
  initial.drafts = before;
});

describe("FR-KIT-62 title bar", () => {
  test("FR-KIT-62 title bar: `cbt-popup-drag` is a window bar with '{attacker} — {attack}', the step marker and the gem close = Later; the footer has no Later", () => {
    const html = render(DM_CARD);
    const bar = html.slice(at(html, 'data-testid="cbt-popup-drag"'), at(html, "</div>"));
    expect(bar).toContain('data-slot="card-bar"');
    expect(bar).toContain(">Brakka — Flame Tongue greatsword</h2>");
    expect(bar).toContain('data-testid="cbt-popup-step"');
    expect(bar).toMatch(/data-testid="cbt-popup-later" aria-label="Later"[^>]*><svg/);
    expect(html.split('data-testid="cbt-popup-later"').length - 1).toBe(1);
    expect(html.slice(at(html, 'data-slot="card-footer"'))).not.toContain("Later");
  });
});

describe("FR-KIT-63 result lines", () => {
  test("FR-KIT-63 result lines: 'To hit' and 'Damage, <type>' lines end in Result-box inputs (to-hit outcome by natural, damage → damage); dice stay small in the label", () => {
    const html = render(DM_CARD);
    expect(html).toMatch(
      /<div data-slot="card-line"[^>]*><label[^>]*for="cbt-popup-tohit">To hit <span class="font-mono text-xs[\s\S]*?<\/label><input data-slot="kit-result"[^>]*data-testid="cbt-popup-tohit" data-outcome="plain"/,
    );
    expect(html).toMatch(
      /<div data-slot="card-line"[^>]*><label[^>]*for="cbt-popup-damage">Damage, slashing <span class="font-mono[\s\S]*?<\/label><div[^>]*><input data-slot="kit-result"[^>]*data-testid="cbt-popup-damage" data-outcome="damage"/,
    );
    // The extra part's line ends in its own box.
    expect(html).toMatch(
      /for="cbt-popup-damage-part-1">\+ fire<\/label><div[^>]*><input data-slot="kit-result"[^>]*data-testid="cbt-popup-damage-part" data-value="1"/,
    );
    expect(toHitOutcome(20)).toBe("crit");
    expect(toHitOutcome(1)).toBe("fumble");
    expect(toHitOutcome(14)).toBe("plain");
    expect(toHitOutcome(null)).toBe("plain");
    const crit = render(
      cardNote(flameCard({ crit: true, toHit: { ...flameCard().toHit, natural: 20 } as never }), {
        audience: "dm",
        audiencePlayerId: null,
      }),
    );
    expect(crit).toMatch(
      /class="[^"]*text-hp-full[^"]*"[^>]*data-testid="cbt-popup-tohit" data-outcome="crit"/,
    );
  });
});

describe("FR-KIT-64 target rows", () => {
  test("FR-KIT-64 target rows: one line: Medallion (sm) + 'Name · AC' chip, Hit, the multiplier control, the preview; Remove on hover / focus; part chips wrap below", () => {
    const html = render(DM_CARD);
    const row = html.slice(
      at(html, 'data-testid="cbt-popup-target-row" data-record-id="cb-gob"'),
      at(html, "</li>"),
    );
    expect(row).toContain('data-slot="card-target"');
    const first = row.slice(0, at(row, 'data-testid="cbt-popup-target-part"'));
    const order = [
      'data-slot="card-target-chip"',
      'data-slot="kit-medallion" data-size="sm"',
      ">Goblin</span>",
      'data-testid="mod-popup-ac"',
      'data-testid="cbt-popup-target-hit"',
      'data-testid="cbt-popup-target-mult"',
      'data-testid="cbt-popup-target-preview"',
      'data-testid="cbt-popup-target-remove"',
    ].map((id) => at(first, id));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The whole first line is one flex-wrap row (one line at 440, wraps only when narrower).
    expect(first).toMatch(/^[\s\S]*?<div class="flex flex-wrap items-center/);
    // Remove: a hover / focus group (always shown without hover, FR-KIT-03).
    expect(first).toMatch(
      /class="[^"]*opacity-0[^"]*group-hover\/target:opacity-100[^"]*group-focus-within\/target:opacity-100[^"]*\[@media\(hover:none\)\]:opacity-100[^"]*" data-testid="cbt-popup-target-remove"/,
    );
    // The fire part's chip on its own line under it.
    expect(at(row, 'data-testid="cbt-popup-target-part"')).toBeGreaterThan(
      at(row, 'data-testid="cbt-popup-target-remove"'),
    );
  });
});

describe("FR-KIT-65 footer", () => {
  test("FR-KIT-65 footer: Dismiss (ghost) left, the card actions in the middle, Apply (primary) right", () => {
    const html = render(DM_CARD);
    const foot = html.slice(at(html, 'data-slot="card-footer"'));
    const order = ["cbt-popup-dismiss", "cbt-card-actions", "cbt-popup-apply"].map((id) =>
      at(foot, `data-testid="${id}"`),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(foot).toMatch(/data-variant="ghost"[^>]*data-testid="cbt-popup-dismiss"/);
    expect(foot).toMatch(/data-variant="default"[^>]*data-testid="cbt-popup-apply"/);
  });
});

describe("FR-KIT-01 / -03 / -07 (damage card)", () => {
  test("FR-KIT-01 same DOM per theme: the popup renders the same markup under Simple Dark and Gilt & Stone; no theme read", () => {
    const [a, b] = (["default", "gilt"] as const).map((t) =>
      render(DM_CARD, (n) => <div data-theme={t}>{n}</div>).replace(t, "·"),
    );
    expect(a).toBe(b ?? "");
    expect(readFileSync(join(import.meta.dir, "attack-popup.tsx"), "utf8")).not.toMatch(
      /data-theme|gilt/,
    );
  });

  test("FR-KIT-03 reachable: Later, Dismiss, Apply, Add target, every multiplier and Remove stay in the DOM", () => {
    const html = render(DM_CARD);
    for (const id of [
      "cbt-popup-later",
      "cbt-popup-dismiss",
      "cbt-popup-apply",
      "cbt-popup-target-add",
      "cbt-popup-target-hit",
      "cbt-popup-target-remove",
      "cbt-popup-tohit",
      "cbt-popup-damage",
      "cbt-popup-damage-part",
    ]) {
      expect(html).toContain(`data-testid="${id}"`);
    }
    expect(html.split('data-testid="cbt-popup-target-mult-option"').length - 1).toBe(4);
  });

  test("FR-KIT-07 slots present: card-bar, card-line, card-target, card-footer", () => {
    const html = render(DM_CARD);
    for (const slot of ["card-bar", "card-line", "card-target", "card-footer", "kit-result"]) {
      expect(html).toContain(`data-slot="${slot}"`);
    }
  });
});

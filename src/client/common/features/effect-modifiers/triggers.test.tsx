// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// MOD R6 client (FR-MOD-45, -47, -49, -50): the Triggers block in the Active effects tab (lazy
// load states, rows, warnings, owner / DM / locked), the trigger editor (fields, formula errors
// and the live value, preview, payload) and its draft model. Static render over a fake store.
import { describe, expect, test } from "bun:test";
import { CREATURE_SHEET_TYPE, defaultSheetData } from "@shared/character-sheet/sheet";
import { EFFECT_PRESET_TYPE } from "@shared/effect-modifiers/schemas";
import { TRIGGER_PRESETS } from "@shared/effect-modifiers/trigger-presets";
import { RULE_TRIGGER_TYPE } from "@shared/effect-modifiers/trigger-records";
import type { TriggerRule } from "@shared/effect-modifiers/triggers";
import { ENTITY_TYPE, IMPORTED_ENTITY_TYPE } from "@shared/entities/schemas";
import { emptyLoaded, type LazyState, lazyAfterSnapshot } from "@shared/protocol/lazy";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { ActiveEffectsSection } from "./section";
import { TriggerForm } from "./trigger-editor";
import {
  blankTrigger,
  draftFromPreset,
  draftOfRule,
  everyOptions,
  putTriggerPayload,
  REDACTED_MESSAGE,
  ruleOfDraft,
  withEvent,
} from "./trigger-editor-model";
import { ownerTriggers } from "./trigger-owner";
import { TriggersBlock } from "./triggers";

const BRAKKA_STATS = {
  size: "medium",
  ac: 14,
  hpMax: 55,
  initBonus: 1,
  speed: 30,
  attacks: [],
  abilities: { str: 18, dex: 12, con: 16, int: 8, wis: 12, cha: 10 },
  level: 5,
  className: "Barbarian",
  classes: [{ name: "Barbarian", level: 5, hitDie: "d12" }],
};
const ELITE_STATS = {
  size: "small",
  ac: 16,
  hpMax: 15,
  initBonus: 2,
  speed: 30,
  attacks: [],
  abilities: { str: 14, dex: 14, con: 12, int: 10, wis: 8, cha: 8 },
  cr: "1/2",
};
const RAGE_ROW = { id: "f-rage", name: "Rage", source: "", text: "", used: 0, usesMax: 3 };

const DF_RULE: TriggerRule = {
  on: "hit",
  requires: { preset: "p-rage" },
  when: [{ if: "via", via: "weapon" }, { if: "ownTurn" }],
  every: "turn",
  then: { do: "damage", formula: "1d6 + floor(level(barbarian) / 2)", type: "radiant" },
};
const divineFury = {
  id: "t-df",
  campaignId: "c1",
  seq: 1,
  characterId: "brakka" as string | null,
  definitionId: null as string | null,
  ownerPlayerId: "p1" as string | null,
  name: "Divine Fury",
  enabled: true,
  public: true,
  updatedAt: "2026-10-16T00:00:00.000Z",
  rule: DF_RULE,
};
const broken = {
  ...divineFury,
  id: "t-broken",
  seq: 2,
  name: "Frenzy",
  enabled: false,
  rule: { ...divineFury.rule, requires: { preset: "gone" }, every: { feature: "f-gone" } },
};
const thornTrigger = { ...divineFury, id: "t-thorn", characterId: "thorn", name: "Thorn's" };
const eliteTrigger = {
  ...divineFury,
  id: "t-elite",
  characterId: null,
  definitionId: "srd-elite",
  ownerPlayerId: null,
  name: "Martial Advantage",
  public: false,
  rule: TRIGGER_PRESETS.find((p) => p.key === "martial-advantage")?.rule,
};

type Lazy = "loading" | "error" | "ready";
function syncState(o: {
  role: "dm" | "player";
  lazy?: Lazy;
  locked?: boolean;
  triggers?: readonly object[];
  offline?: boolean;
}) {
  const lazy: LazyState = { ...lazyAfterSnapshot(1) };
  if (o.lazy === "ready" || o.lazy === undefined)
    lazy.loaded = { ...emptyLoaded(), types: [RULE_TRIGGER_TYPE] };
  if (o.lazy === "error") lazy.failed = { ...emptyLoaded(), types: [RULE_TRIGGER_TYPE] };
  if (o.lazy === "loading") lazy.loading = { ...emptyLoaded(), types: [RULE_TRIGGER_TYPE] };
  const records = {
    [ENTITY_TYPE]: {
      brakka: {
        id: "brakka",
        kind: "character",
        name: "Brakka",
        ownerPlayerId: "p1",
        statBlock: BRAKKA_STATS,
      },
    },
    [IMPORTED_ENTITY_TYPE]: {
      "srd-elite": { id: "srd-elite", kind: "monster", name: "Elite", statBlock: ELITE_STATS },
    },
    [EFFECT_PRESET_TYPE]: {
      "p-rage": { id: "p-rage", seq: 1, characterId: "brakka", name: "Rage", modifiers: [] },
      ...(o.role === "dm"
        ? { "p-ward": { id: "p-ward", seq: 2, characterId: null, name: "Frost Ward" } }
        : {}),
    },
    [CREATURE_SHEET_TYPE]: {
      s1: {
        id: "s1",
        entityId: "brakka",
        ...defaultSheetData(),
        features: [RAGE_ROW],
        locked: o.locked === true,
      },
    },
    [RULE_TRIGGER_TYPE]: Object.fromEntries(
      (o.triggers ?? [divineFury, broken]).map((t) => [(t as { id: string }).id, t]),
    ),
  };
  const you = { campaignId: "c1", role: o.role, playerId: o.role === "dm" ? null : "p1" };
  return createStore<SyncState>()(
    () =>
      ({
        state: o.offline ? "reconnecting" : "live",
        store: { ...emptyStore(), you, records },
        lazy,
        notLiveSince: null,
        everLive: true,
        connection: {
          sendIntent: () => Promise.resolve({}),
          load: () => null,
          retryLoad: () => null,
        },
      }) as unknown as SyncState,
  );
}

function render(
  o: Parameters<typeof syncState>[0],
  node = <ActiveEffectsSection creatureId="brakka" client={o.role} />,
) {
  return renderToStaticMarkup(
    <SyncContext.Provider value={syncState(o)}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {node}
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

const count = (html: string, s: string) => html.split(s).length - 1;
/** The opening tags carrying `data-testid="<id>"` (attribute order is React's). */
const tags = (html: string, id: string) =>
  html.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`, "g")) ?? [];

describe("FR-MOD-49 Triggers block", () => {
  test("FR-MOD-49 lazy: 'Loading triggers…' until loaded; error → 'Couldn't load triggers' + Retry", () => {
    const loading = render({ role: "player", lazy: "loading" });
    expect(loading).toContain('data-testid="mod-trigger-loading" data-state="loading"');
    expect(loading).toContain("Loading triggers…");
    expect(loading).not.toContain('data-testid="mod-trigger"');
    const error = render({ role: "player", lazy: "error" });
    expect(error).toContain('data-testid="mod-trigger-loading" data-state="error"');
    expect(error).toContain("load triggers");
    expect(error).toContain('data-testid="mod-trigger-retry"');
    expect(render({ role: "player" })).not.toContain("mod-trigger-loading");
  });

  test("FR-MOD-49 owner: row with sentence, '= 1d6+2', enabled state, warnings; New / Start from / Edit / Delete", () => {
    const html = render({ role: "player" });
    expect(html).toContain('data-testid="mod-triggers-block"');
    expect(html).toContain('data-testid="mod-trigger" data-record-id="t-df" data-state="on"');
    expect(html).toContain('data-testid="mod-trigger" data-record-id="t-broken" data-state="off"');
    expect(html).toContain("Once per turn, on a weapon hit on your turn, while Rage is on:");
    expect(html).toContain('data-testid="mod-trigger-value" data-value="1d6+2"');
    expect(html).toContain("= 1d6+2");
    expect(html).toContain('data-testid="mod-trigger-warning" data-value="uses-broken"');
    expect(html).toContain("Uses link broken");
    expect(html).toContain('data-testid="mod-trigger-warning" data-value="missing-preset"');
    expect(html).toContain("Requires a missing preset");
    expect(count(html, 'data-testid="mod-trigger-warning"')).toBe(2);
    for (const id of ["mod-trigger-new", "mod-trigger-from-menu"]) {
      expect(html).toContain(`data-testid="${id}"`);
    }
    expect(count(html, 'data-testid="mod-trigger-edit"')).toBe(2);
    expect(count(html, 'data-testid="mod-trigger-delete"')).toBe(2);
    expect(html).toMatch(/data-testid="mod-trigger-enabled"[^>]*data-record-id="t-df"/);
  });

  test("FR-MOD-45 locked sheet: owner read-only (no New / Edit / Delete, switch disabled); DM still edits", () => {
    const html = render({ role: "player", locked: true });
    expect(html).toContain('data-testid="mod-trigger" data-record-id="t-df"');
    expect(html).not.toContain('data-testid="mod-trigger-new"');
    expect(html).not.toContain('data-testid="mod-trigger-edit"');
    expect(html).not.toContain('data-testid="mod-trigger-delete"');
    const switches = tags(html, "mod-trigger-enabled");
    expect(switches).toHaveLength(2);
    expect(switches.every((t) => t.includes('disabled=""'))).toBe(true);
    expect(html).toContain("Locked by the DM");
    const dm = render({ role: "dm", locked: true });
    expect(dm).toContain('data-testid="mod-trigger-new"');
    expect(count(dm, 'data-testid="mod-trigger-edit"')).toBe(2);
  });

  test("FR-MOD-47 player view: own character's triggers only; monster triggers never", () => {
    const rows = [divineFury, thornTrigger, eliteTrigger] as never[];
    const html = render({ role: "player", triggers: rows });
    expect(html).toContain('data-record-id="t-df"');
    expect(html).not.toContain("t-thorn");
    expect(html).not.toContain("t-elite");
    expect(html).not.toContain("Martial Advantage");
    expect(ownerTriggers(rows, { kind: "definition", id: "srd-elite" }, "player")).toEqual([]);
    expect(
      ownerTriggers(rows, { kind: "definition", id: "srd-elite" }, "dm").map((t) => t.id),
    ).toEqual(["t-elite"]);
  });

  test("FR-MOD-49 disconnected: last rows stay; New, Start from, Edit, Delete and the Switch disabled", () => {
    const html = render({ role: "player", offline: true });
    expect(html).toContain('data-testid="mod-trigger" data-record-id="t-df"');
    for (const id of [
      "mod-trigger-new",
      "mod-trigger-from-menu",
      "mod-trigger-edit",
      "mod-trigger-delete",
      "mod-trigger-enabled",
    ]) {
      const found = tags(html, id);
      expect(found.length).toBeGreaterThan(0);
      expect(found.every((t) => t.includes('disabled=""'))).toBe(true);
    }
  });

  test("FR-MOD-49 empty: 'No triggers yet — New or Start from a preset'", () => {
    expect(render({ role: "player", triggers: [] })).toContain(
      "No triggers yet — New or Start from a preset",
    );
  });

  test("FR-MOD-28 definition owner (DM): monster trigger with its CR value; players get nothing", () => {
    const owner = { kind: "definition", id: "srd-elite" } as const;
    const dm = render({ role: "dm", triggers: [eliteTrigger] }, <TriggersBlock owner={owner} />);
    expect(dm).toContain('data-testid="mod-trigger" data-record-id="t-elite"');
    expect(dm).toContain('data-testid="mod-trigger-value" data-value="2d6"');
    expect(dm).toContain('data-testid="mod-trigger-new"');
    const player = render(
      { role: "player", triggers: [eliteTrigger] },
      <TriggersBlock owner={owner} />,
    );
    expect(player).not.toContain("t-elite");
    expect(player).not.toContain('data-testid="mod-trigger-new"');
  });
});

/** The editor's form (the Dialog's portal doesn't render statically; the form is its body). */
function renderForm(
  o: Parameters<typeof syncState>[0],
  start: Parameters<typeof TriggerForm>[0]["start"],
) {
  return render(o, <TriggerForm start={start} onDone={() => {}} />);
}

describe("FR-MOD-50 trigger editor", () => {
  const owner = { kind: "character", id: "brakka" } as const;

  test("FR-MOD-50 fields, live value 'Brakka now: 1d6+2', preview sentence, Save", () => {
    const draft = draftOfRule(divineFury, DF_RULE);
    const html = renderForm({ role: "player" }, { owner, draft, id: "t-df", title: "Edit" });
    for (const id of [
      "event",
      "requires",
      "filter",
      "filter-kind",
      "every",
      "formula",
      "formula-value",
      "type",
      "public",
      "preview",
      "save",
    ]) {
      expect(html).toContain(`data-testid="mod-trig-editor-${id}"`);
    }
    expect(html).toContain('data-testid="mod-trig-editor-formula-value" data-value="1d6+2"');
    expect(html).toContain("Brakka now: 1d6+2");
    expect(html).toContain("while Rage is on");
    expect(html).not.toContain("mod-trig-editor-formula-error");
  });

  test("FR-MOD-50 formula errors inline with the position; too many dice for this owner", () => {
    const base = draftOfRule(divineFury, DF_RULE);
    const bad = renderForm(
      { role: "player" },
      { owner, draft: { ...base, formula: "1d6 + foo" }, title: "x" },
    );
    expect(bad).toContain('data-testid="mod-trig-editor-formula-error"');
    expect(bad).toContain("Unknown name ‘foo’ at 7");
    expect(tags(bad, "mod-trig-editor-save")[0]).toContain('disabled=""');
    const big = renderForm(
      { role: "player" },
      { owner, draft: { ...base, formula: "20d6+6d8" }, title: "x" },
    );
    expect(big).toContain("Too many dice: 26 &gt; 25");
  });

  test("FR-MOD-50 kinds per event: roll → roll filter + part / mode; turnStart → reminder, each only; feature for characters", () => {
    const roll = withEvent(blankTrigger("character"), "roll", "character");
    // The blank's `via` filter isn't allowed on roll triggers; the required `roll` filter is added.
    expect(roll.when.map((f) => f.kind)).toEqual(["roll"]);
    expect(roll.effect).toBe("part");
    const html = renderForm({ role: "dm" }, { owner, draft: roll, title: "x" });
    expect(html).toContain('data-testid="mod-trig-editor-do"');
    const ts = withEvent(blankTrigger("definition"), "turnStart", "definition");
    expect(ts.when).toEqual([]);
    expect(ts.every).toBe("each");
    expect(ts.effect).toBe("remind");
    expect(everyOptions("turnStart", "character")).toEqual(["each"]);
    expect(everyOptions("hit", "definition")).not.toContain("feature");
    expect(everyOptions("hit", "character")).toContain("feature");
    // #223: roll triggers can't spend feature uses.
    expect(everyOptions("roll", "character")).not.toContain("feature");
    const remind = renderForm(
      { role: "dm" },
      {
        owner: { kind: "definition", id: "srd-elite" },
        draft: { ...ts, text: "regain {value} HP", formula: "10" },
        title: "x",
      },
    );
    expect(remind).toContain('data-testid="mod-trig-editor-text"');
    expect(remind).toContain("Elite now: 10");
  });

  test("FR-MOD-46 Start from: each built-in round-trips through the editor for its owner kind only", () => {
    for (const p of TRIGGER_PRESETS) {
      const owner = { kind: p.owner, id: "o1" };
      const f = draftFromPreset(p.key, owner);
      const r = f && ruleOfDraft(f.draft);
      expect(r?.ok && r.rule).toEqual(p.rule);
      expect(f?.draft.name).toBe(p.name);
      expect(f?.draft.public).toBe(p.public);
      const other = p.owner === "character" ? "definition" : "character";
      expect(draftFromPreset(p.key, { kind: other, id: "o1" })).toBeUndefined();
    }
    expect(draftFromPreset("divine-fury", { kind: "character", id: "o1" })).toBeUndefined();
    const df = ruleOfDraft(draftOfRule(divineFury, DF_RULE));
    expect(df.ok && df.rule).toEqual(DF_RULE);
  });

  test("FR-MOD-46 owner-specific fields to confirm: a checkbox each; Save waits for them", () => {
    const draft = draftOfRule(divineFury, DF_RULE);
    const html = renderForm(
      { role: "player" },
      { owner, draft, title: "x", confirm: ["requires", "every"] },
    );
    expect(html).toContain('data-testid="mod-trig-editor-confirm" data-value="requires"');
    expect(html).toContain('data-testid="mod-trig-editor-confirm" data-value="every"');
    expect(tags(html, "mod-trig-editor-save")[0]).toContain('disabled=""');
    const plain = renderForm({ role: "player" }, { owner, draft, title: "x" });
    expect(plain).not.toContain("mod-trig-editor-confirm");
    expect(tags(plain, "mod-trig-editor-save")[0]).not.toContain('disabled=""');
  });

  test("FR-MOD-45 payload: create without id, replace with id; owner ref; invalid drafts don't build", () => {
    const start = draftFromPreset("sneak-attack", { kind: "character", id: "thorn" });
    if (!start) throw new Error("sneak-attack missing");
    const d = { ...start.draft, name: " Sneak " };
    const r = ruleOfDraft(d);
    if (!r.ok) throw new Error(r.message);
    expect(putTriggerPayload(d, r.rule, { characterId: "thorn" })).toEqual({
      trigger: { characterId: "thorn", name: "Sneak", enabled: true, public: true, rule: r.rule },
    });
    expect(putTriggerPayload(d, r.rule, { definitionId: "d1" }, "t1").trigger).toMatchObject({
      id: "t1",
      definitionId: "d1",
    });
    expect(ruleOfDraft({ ...d, formula: "1d7" }).ok).toBe(false);
    expect(ruleOfDraft({ ...d, every: "feature", feature: "" })).toMatchObject({ ok: false });
    expect(ruleOfDraft({ ...blankTrigger("character"), on: "roll", when: [] }).ok).toBe(false);
  });

  test("FR-MOD-47 a player's redacted ref is shown but can't be saved back", () => {
    const copy = { ...divineFury.rule, requires: { name: "Frost Ward" } };
    const d = draftOfRule(divineFury, copy as never);
    expect(d.requiresName).toBe("Frost Ward");
    expect(ruleOfDraft(d)).toEqual({ ok: false, message: REDACTED_MESSAGE, path: ["requires"] });
    expect(ruleOfDraft({ ...d, requires: "rage", requiresName: null }).ok).toBe(true);
    const html = renderForm({ role: "player" }, { owner, draft: d, title: "x" });
    expect(html).toContain('data-testid="mod-trig-editor-invalid"');
    expect(tags(html, "mod-trig-editor-save")[0]).toContain('disabled=""');
  });
});

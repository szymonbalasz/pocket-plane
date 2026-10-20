// Companion card, client (CHARX §13, CBT §13.3; sprint 6 CP4): card data (FR-CHARX-60), picker
// (FR-CHARX-61), header (FR-CHARX-62), HP control and pet edits (FR-CHARX-63), rolls (FR-CHARX-64), conditions (FR-CHARX-65), not a sheet (FR-CHARX-66),
// visibility (FR-CHARX-67), states (FR-CHARX-68). Pure models + static server renders over a
// fake sync store (the repo's client test style: no DOM). The window defs (FR-CHARX-59): each
// client's `companion-window.test.ts`.
import { afterEach, describe, expect, test } from "bun:test";
import { CHAR_ROLL } from "@shared/character-sheet/schemas";
import { COMBATANT_TYPE, type CombatantView, ENCOUNTER_TYPE } from "@shared/combat-tracker/schemas";
import { companionCard, ENTITY_TYPE, type MonsterStatBlock } from "@shared/entities/schemas";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../../sync/store";
import { createWindowRegistry } from "../../play-shell/registry";
import { ShellProvider } from "../../play-shell/ShellContext";
import { changedHint, fieldReducer, idleField, setFieldError } from "../edit-model";
import { createSheetMemory } from "../selection";
import {
  CompanionCard,
  CompanionCardView,
  type CompanionDmParts,
  canDismissFromCard,
  DISMISS_TURN_HINT,
  DM_EMPTY_TEXT,
  EMPTY_TEXT,
  IN_FIGHT_HP_HINT,
  OFFLINE_TEXT,
  PET_ADJUST_HP,
} from "./CompanionCard";
import {
  type CompanionEntityLike,
  companionEntries,
  companionMemoryKey,
  leftCompanion,
  modeText,
  ownerText,
  ownsCompanion,
  resetCompanionMemory,
  selectCompanion,
  shownEntry,
  sizeTypeText,
} from "./picker";
import { cardCritOptions, cardRollIntent, cardRowSpecs } from "./rolls";
import { COMPANION_KIND } from "./window";

// ---------- fixtures (CBT §13.3: Owlbear pet of Mira, a Fire Elemental summon) ----------

const owlbearBlock = {
  size: "large",
  ac: 13,
  hpMax: 59,
  initBonus: 1,
  speed: 40,
  attacks: [
    { id: "beak", name: "Beak", toHit: 7, damage: "1d10+5", damageType: "piercing" },
    { id: "claws", name: "Claws", toHit: 7, damage: "2d8+5", damageType: "slashing" },
  ],
  cr: "3",
  type: "monstrosity",
} as MonsterStatBlock;

const mira: CompanionEntityLike = {
  id: "mira",
  kind: "character",
  name: "Mira",
  ownerPlayerId: "p1",
};
const thorn: CompanionEntityLike = {
  id: "thorn",
  kind: "character",
  name: "Thorn",
  ownerPlayerId: "p2",
};
/** The owner's pet row (full minus `derivedFromId`, FR-ENT-37). */
const owlPet: CompanionEntityLike = {
  id: "owl",
  kind: "monster",
  name: "Owlbear",
  campaignId: "c1",
  portraitAssetId: null,
  ownerPlayerId: "p1",
  companionOf: "mira",
  turnMode: "after-owner",
  hpCurrent: 45,
  statBlock: owlbearBlock,
};
/** Player-2's view of the Owlbear while present (FR-ENT-37): redacted. */
const owlRedacted = {
  id: "owl",
  kind: "monster",
  name: "Owlbear",
  portraitAssetId: null,
  ownerPlayerId: "p1",
  companionOf: "mira",
  band: "bloodied",
} as CompanionEntityLike;
const wolfPet: CompanionEntityLike = {
  ...owlPet,
  id: "wolf",
  name: "Wolf",
  ownerPlayerId: "p2",
  companionOf: "thorn",
  turnMode: "in-owner-turn",
  hpCurrent: 11,
  statBlock: {
    ...owlbearBlock,
    hpMax: 11,
    attacks: [{ id: "bite", name: "Bite", toHit: 4, damage: "2d4+2" }],
  },
};

const enc = { id: "e1", status: "started", round: 2, playerTurnCombatantId: null };
const owlCard = companionCard(owlbearBlock, () => "x");
const feCard = companionCard(
  {
    size: "large",
    ac: 13,
    hpMax: 102,
    initBonus: 3,
    speed: 50,
    attacks: [{ name: "Touch", toHit: 6, damage: "2d6+3", damageType: "fire" }],
    cr: "5",
    type: "elemental",
  } as MonsterStatBlock,
  () => "touch-card",
);
const base = {
  encounterId: "e1",
  removed: false as const,
  movedFt: 0,
  tokenId: null,
  imageAssetId: null,
};
/** The owner's view of its companions (FR-CBT-116; a pet's names its row). */
const owlC = {
  ...base,
  id: "c-owl",
  entityId: "owl",
  kind: "monster",
  name: "Owlbear",
  playerPosition: 2,
  band: "healthy",
  side: "ally",
  ownerCharacterId: "mira",
  ownerPlayerId: "p1",
  turnMode: "after-owner",
  hpCurrent: 30,
  hpMax: 59,
  tempHp: 5,
  pet: true,
  card: owlCard,
} as CombatantView;
const feC = {
  ...owlC,
  id: "c-fe",
  name: "Fire Elemental",
  turnMode: "in-owner-turn",
  hpCurrent: 102,
  hpMax: 102,
  tempHp: 0,
  entityId: undefined,
  pet: false,
  card: feCard,
} as CombatantView;
/** Player-2's view of the Owlbear combatant: band + owner ids only. */
const owlBand = {
  ...base,
  id: "c-owl",
  kind: "monster",
  name: "Owlbear",
  playerPosition: 2,
  band: "bloodied",
  side: "ally",
  ownerCharacterId: "mira",
  ownerPlayerId: "p1",
  turnMode: "after-owner",
} as CombatantView;
/** The DM's rows: entity ids, side, hidden flags. */
const dmC = (c: CombatantView, entityId: string, extra: object = {}) =>
  ({ ...c, entityId, active: true, hidden: false, publicSide: "ally", ...extra }) as CombatantView;

const P1 = { role: "player", playerId: "p1" } as const;
const P2 = { role: "player", playerId: "p2" } as const;
const DM = { role: "dm", playerId: null } as const;

function storeOf(
  viewer: { role: "dm" | "player"; playerId: string | null },
  records: { entities?: object[]; combatants?: object[]; effects?: object[]; fight?: boolean },
): RecordStore {
  const byId = (rows: object[] = []) =>
    Object.fromEntries(rows.map((r) => [(r as { id: string }).id, r]));
  return {
    ...emptyStore(),
    you: { campaignId: "c1", ...viewer } as RecordStore["you"],
    records: {
      [ENTITY_TYPE]: byId(records.entities),
      [COMBATANT_TYPE]: byId(records.combatants),
      [ENCOUNTER_TYPE]: byId(records.fight === false ? [] : [enc]),
      effect: byId(records.effects),
      player: byId([
        { id: "p1", name: "Player 1" },
        { id: "p2", name: "Player 2" },
      ]),
    },
  };
}

function render(store: RecordStore, node: ReactNode, live = true) {
  const g = globalThis as { document?: unknown };
  g.document = { title: "", hidden: false };
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: live ? "live" : "offline",
        store,
        notLiveSince: null,
        everLive: true,
        connection: { sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  try {
    return renderToStaticMarkup(
      <SyncContext.Provider value={sync}>
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <ShellProvider registry={createWindowRegistry("player", [])}>{node}</ShellProvider>
        </TooltipProvider>
      </SyncContext.Provider>,
    );
  } finally {
    delete g.document;
  }
}

const has = (html: string, testId: string, attrs = "") =>
  new RegExp(`data-testid="${testId}"${attrs}`).test(html);
const count = (html: string, testId: string) =>
  (html.match(new RegExp(`data-testid="${testId}"`, "g")) ?? []).length;
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
/** A `disabled` attribute (not the `disabled:` class variants). */
const isDisabled = (tag: string) => / disabled=""/.test(tag);
/** The tag carrying `testId` (+ more attributes). */
const tagOf = (html: string, testId: string, more = "") => {
  const m = html.match(new RegExp(`<[a-z]+[^>]*data-testid="${testId}"${more}[^>]*>`));
  if (!m) throw new Error(`no ${testId}${more}`);
  return m[0];
};

const dmParts: CompanionDmParts = {
  hpButton: (c) => <button type="button" data-testid="test-dm-hp" data-record-id={c.id} />,
  effects: (c) => <span data-testid="test-dm-effects" data-record-id={c.id} />,
};

afterEach(() => resetCompanionMemory());

// ---------- tests ----------

describe("FR-CHARX-60 card fields", () => {
  test("FR-CHARX-60 card fields: a pet out of a fight from its stat block, in a fight from the combatant card; row ids stable; +N more; no speed → —", () => {
    const out = companionEntries(P1, [mira, owlPet], []);
    expect(out).toHaveLength(1);
    expect(out[0]?.card).toMatchObject({
      size: "large",
      type: "monstrosity",
      ac: 13,
      hpMax: 59,
      speed: 40,
    });
    expect(out[0]?.card?.attacks.map((a) => a.id)).toEqual(["beak", "claws"]);
    expect(out[0]?.hp).toEqual({ current: 45, max: 59, temp: 0 });
    // In a fight: the combatant's card and HP.
    const fight = companionEntries(P1, [mira, owlPet], [owlC]);
    expect(fight[0]?.card).toBe(owlCard);
    expect(fight[0]?.hp).toEqual({ current: 30, max: 59, temp: 5 });
    // Rows carry the stable card row id; a definition edit (Claws +8) keeps it.
    const edited = {
      ...owlPet,
      statBlock: {
        ...owlbearBlock,
        attacks: [owlbearBlock.attacks[0], { ...owlbearBlock.attacks[1], toHit: 8 }],
      },
    } as CompanionEntityLike;
    const html = render(storeOf(P1, { entities: [mira, edited], fight: false }), <CompanionCard />);
    expect(tagOf(html, "charx-companion-attack", ' data-record-id="claws"')).toBeTruthy();
    expect(text(html)).toContain("Claws · +8 · 2d8+5 slashing");
    expect(text(html)).toContain("Beak · +7 · 1d10+5 piercing");
    // 9 attacks → 8 rows + "+1 more"; a block without speed → "—".
    const { speed: _s, ...noSpeed } = owlbearBlock;
    const nine = {
      ...owlPet,
      statBlock: {
        ...noSpeed,
        attacks: Array.from({ length: 9 }, (_, i) => ({
          id: `a${i}`,
          name: `A${i}`,
          toHit: 1,
          damage: "1d4",
        })),
      },
    } as CompanionEntityLike;
    const many = render(storeOf(P1, { entities: [mira, nine], fight: false }), <CompanionCard />);
    expect(count(many, "charx-companion-attack")).toBe(8);
    expect(text(many)).toContain("+1 more");
    expect(text(many)).toContain("Speed — ");
    expect(tagOf(many, "charx-companion-speed")).not.toContain("data-value");
    expect(sizeTypeText({ size: "large", type: "monstrosity" })).toBe("Large monstrosity");
    expect(sizeTypeText({ size: "medium" })).toBe("Medium");
  });
});

describe("FR-CHARX-61 picker", () => {
  test("FR-CHARX-61 picker: owner sees own pet + own summon, a pet in a fight once; DM all; sorted by owner, then name; memory; a dismissed one moves on", () => {
    const p1 = companionEntries(P1, [mira, thorn, owlPet, owlRedacted], [owlC, feC, owlBand]);
    expect(p1.map((e) => [e.name, e.key, e.combatant?.id ?? null])).toEqual([
      ["Fire Elemental", "c-fe", "c-fe"],
      ["Owlbear", "owl", "c-owl"],
    ]);
    // The DM: every pet (in a fight or not) and every companion combatant.
    const dm = companionEntries(
      DM,
      [mira, thorn, owlPet, wolfPet],
      [
        dmC(owlC, "owl"),
        dmC(feC, "fe-def"),
        dmC(
          {
            ...owlC,
            id: "c-gob",
            name: "Goblin",
            ownerCharacterId: undefined,
            ownerPlayerId: undefined,
            pet: false,
          } as CombatantView,
          "gob",
        ),
      ],
    );
    expect(dm.map((e) => `${e.ownerName}:${e.name}`)).toEqual([
      "Mira:Fire Elemental",
      "Mira:Owlbear",
      "Thorn:Wolf",
    ]);
    expect(dm.find((e) => e.name === "Owlbear")?.combatant?.id).toBe("c-owl");
    // Selection memory per browser (as FR-CHARX-47), key per campaign and viewer.
    expect(companionMemoryKey("c1", "player", "p1")).toBe("pp.companion.v1.c1.p1");
    expect(companionMemoryKey("c1", "dm", null)).toBe("pp.companion.v1.c1.dm");
    const backend = new Map<string, string>();
    resetCompanionMemory(
      createSheetMemory(
        () => ({
          getItem: (k) => backend.get(k) ?? null,
          setItem: (k, v) => void backend.set(k, v),
        }),
        () => {},
      ),
    );
    selectCompanion("owl");
    expect(shownEntry(p1, "owl")?.name).toBe("Owlbear");
    // A request with the combatant id (Initiative row) selects the same entry.
    expect(shownEntry(p1, "c-owl")?.key).toBe("owl");
    // Gone (dismissed) → the first remaining, else empty.
    const after = p1.filter((e) => e.key !== "c-fe");
    expect(shownEntry(after, "c-fe")?.name).toBe("Owlbear");
    expect(shownEntry([], "c-fe")).toBeNull();
    // The picker renders an option per companion with its record id.
    const html = render(
      storeOf(P1, { entities: [mira, owlPet], combatants: [owlC, feC] }),
      <CompanionCard />,
    );
    expect(count(html, "charx-companion-option")).toBe(2);
    expect(has(html, "charx-companion-option", ' data-record-id="c-fe"')).toBe(true);
  });
});

describe("FR-CHARX-62 header", () => {
  test('FR-CHARX-62 header: "Mira\'s pet" / "Mira\'s summon", the mode in words, In combat only while a combatant, the side chip only off ally', () => {
    expect(modeText("after-owner", "Mira")).toBe("Acts after Mira");
    expect(modeText("in-owner-turn", "Mira")).toBe("In Mira's turn");
    expect(modeText("own", "Mira")).toBe("Own initiative");
    const out = render(storeOf(P1, { entities: [mira, owlPet], fight: false }), <CompanionCard />);
    expect(text(out)).toContain("Mira's pet");
    expect(text(out)).toContain("Acts after Mira");
    expect(tagOf(out, "charx-companion-mode")).toContain('data-value="after-owner"');
    expect(has(out, "charx-companion-in-combat")).toBe(false);
    selectCompanion("c-fe");
    const fe = render(
      storeOf(P1, { entities: [mira, owlPet], combatants: [owlC, feC] }),
      <CompanionCard />,
    );
    expect(text(fe)).toContain("Mira's summon");
    expect(text(fe)).toContain("In Mira's turn");
    expect(has(fe, "charx-companion-in-combat")).toBe(true);
    expect(has(fe, "charx-companion-side")).toBe(false);
    const hostile = { ...feC, side: "enemy" } as CombatantView;
    const e = companionEntries(P1, [mira], [hostile]);
    expect(e[0]?.side).toBe("enemy");
    expect(ownerText({ ownerName: "Mira", petId: null })).toBe("Mira's summon");
    const html = render(
      storeOf(P1, { entities: [mira], combatants: [hostile] }),
      <CompanionCard />,
    );
    expect(tagOf(html, "charx-companion-side")).toContain('data-value="enemy"');
  });
});

describe("FR-CHARX-63 HP control and edits", () => {
  test("FR-CHARX-63 HP control by state: a pet out of a fight ± for owner and DM (pet.adjustHp); in a fight read-only for the owner with the hint, the DM's button; a summon never ±", () => {
    expect(PET_ADJUST_HP).toBe("pet.adjustHp");
    const outP = render(storeOf(P1, { entities: [mira, owlPet], fight: false }), <CompanionCard />);
    expect(count(outP, "charx-companion-hp-adjust")).toBe(2);
    expect(tagOf(outP, "charx-companion-hp")).toContain('data-value="45"');
    expect(text(outP)).toContain("45 / 59");
    const outDm = render(
      storeOf(DM, { entities: [mira, owlPet], fight: false }),
      <CompanionCard dm={dmParts} />,
    );
    expect(count(outDm, "charx-companion-hp-adjust")).toBe(2);
    // In a fight: the owner reads "30 / 59" + "Temp 5" and the hint, no control.
    const inP = render(
      storeOf(P1, { entities: [mira, owlPet], combatants: [owlC] }),
      <CompanionCard />,
    );
    expect(text(inP)).toContain("30 / 59");
    expect(text(inP)).toContain("Temp 5");
    expect(text(inP)).toContain(IN_FIGHT_HP_HINT);
    expect(has(inP, "charx-companion-hp-adjust")).toBe(false);
    const inDm = render(
      storeOf(DM, { entities: [mira, owlPet], combatants: [dmC(owlC, "owl")] }),
      <CompanionCard dm={dmParts} />,
    );
    expect(tagOf(inDm, "test-dm-hp")).toContain('data-record-id="c-owl"');
    expect(text(inDm)).not.toContain(IN_FIGHT_HP_HINT);
    // A summon: never a ± control (the owner reads the hint).
    selectCompanion("c-fe");
    const fe = render(storeOf(P1, { entities: [mira], combatants: [feC] }), <CompanionCard />);
    expect(has(fe, "charx-companion-hp-adjust")).toBe(false);
    expect(text(fe)).toContain(IN_FIGHT_HP_HINT);
  });

  test("FR-CHARX-63 owner edits a pet on the card: Edit on the Owlbear, not on the Fire Elemental; AC, HP max, Speed inputs and attack rows; Add hidden at 8 rows; HP max 0 blocked; a remote edit while focused shows the hint", () => {
    // (A static render shows the first entry: the store's initial selection.)
    const html = render(
      storeOf(P1, { entities: [mira, owlPet], combatants: [owlC] }),
      <CompanionCard />,
    );
    expect(tagOf(html, "charx-companion-edit")).toContain('data-state="off"');
    selectCompanion("c-fe");
    const fe = render(
      storeOf(P1, { entities: [mira, owlPet], combatants: [owlC, feC] }),
      <CompanionCard />,
    );
    expect(has(fe, "charx-companion-edit")).toBe(false);
    // Edit mode (a static render opens it through the test prop): the card's fields + rows.
    resetCompanionMemory();
    const editing = render(
      storeOf(P1, { entities: [mira, owlPet], fight: false }),
      <EditingCard pet={owlPet} />,
    );
    for (const path of [
      "ac",
      "hpMax",
      "speed",
      "attacks.claws.name",
      "attacks.claws.toHit",
      "attacks.claws.damage",
      "attacks.claws.damageType",
    ]) {
      expect(has(editing, "charx-field", ` data-value="${path}"`)).toBe(true);
    }
    expect(has(editing, "charx-attack-bonus")).toBe(true); // Magic Select
    expect(has(editing, "charx-attack-extra-add")).toBe(true); // Add damage type
    expect(count(editing, "charx-row-delete")).toBe(2);
    expect(has(editing, "charx-row-move")).toBe(false); // moving rows stays the DM's
    expect(has(editing, "charx-row-add", ' data-value="attacks"')).toBe(true);
    // Add hidden at 8 rows.
    const eight = {
      ...owlPet,
      statBlock: {
        ...owlbearBlock,
        attacks: Array.from({ length: 8 }, (_, i) => ({
          id: `a${i}`,
          name: `A${i}`,
          toHit: 1,
          damage: "1d4",
        })),
      },
    } as CompanionEntityLike;
    const full = render(
      storeOf(P1, { entities: [mira, eight], fight: false }),
      <EditingCard pet={eight} />,
    );
    expect(has(full, "charx-row-add")).toBe(false);
    // Client mirror: HP max 0 is refused inline (nothing sent).
    expect(setFieldError("hpMax", 0)).not.toBeNull();
    expect(setFieldError("ac", 14)).toBeNull();
    // A remote change while the field is focused → "Changed by the DM" (player) / the owner (DM).
    let s = fieldReducer(idleField, { type: "focus", text: "13", committed: 13 });
    s = fieldReducer(s, { type: "input", text: "14" });
    s = fieldReducer(s, { type: "remote", committed: 15 });
    expect(s.changed).toBe(true);
    expect(changedHint("player", { npc: false, ownerName: null })).toBe("Changed by the DM");
    expect(changedHint("dm", { npc: false, ownerName: "Player 1" })).toBe("Changed by Player 1");
  });
});

/** The card in edit mode for `pet` (FR-CHARX-63): the view with `startEditing`. */
function EditingCard({ pet }: { pet: CompanionEntityLike }) {
  const e = companionEntries(P1, [mira, pet], [])[0];
  if (!e) throw new Error("no entry");
  return (
    <CompanionCardView
      e={e}
      pet={pet}
      client="player"
      picker={null}
      live
      npcSheet={false}
      ownerPlayerName="Player 1"
      startEditing
    />
  );
}

describe("FR-CHARX-64 card rolls", () => {
  test("FR-CHARX-64 card rolls: in a fight Attack / Damage / Attack + damage send cbt.attack {rolls: toHit} / cbt.rollDamage / cbt.attack as the companion with the row's attackId; out of a fight a pet's char.roll", () => {
    const fight = { combatantId: "c-owl" };
    const input = { mode: "advantage" as const };
    expect(cardRollIntent(fight, "claws", "toHit", input)).toEqual({
      name: "cbt.attack",
      payload: { attackerId: "c-owl", attackId: "claws", mode: "advantage", rolls: "toHit" },
    });
    expect(cardRollIntent(fight, "claws", "damage", { mode: "normal" })).toEqual({
      name: "cbt.rollDamage",
      payload: { attackerId: "c-owl", attackId: "claws" },
    });
    expect(cardRollIntent(fight, "claws", "attack", { mode: "normal" })).toEqual({
      name: "cbt.attack",
      payload: { attackerId: "c-owl", attackId: "claws", mode: "normal" },
    });
    // Physical dice: to-hit + damage entries split as combat takes them.
    const manual = [{ dice: [12] }, { dice: [3, 4] }] as never;
    expect(
      cardRollIntent(fight, "claws", "attack", { mode: "normal", manual }).payload,
    ).toMatchObject({
      manual: [{ dice: [12] }, { dice: [3, 4] }],
    });
    // Out of a fight: char.roll with the pet as the creature; never `public`.
    expect(
      cardRollIntent({ petId: "owl" }, "claws", "toHit", { mode: "normal", public: true }),
    ).toEqual({
      name: CHAR_ROLL,
      payload: { characterId: "owl", kind: "toHit", mode: "normal", attackId: "claws" },
    });
    // The roll control's specs: bonus folded, damage parts after the to-hit.
    const claws = owlCard.attacks[1];
    if (!claws) throw new Error("no claws");
    expect(cardRowSpecs({ ...claws, bonus: 1 }, "attack").map((s) => s.expression)).toEqual([
      "1d20+8",
      "2d8+6",
    ]);
    expect(cardRowSpecs(claws, "toHit")).toHaveLength(1);
    expect(cardRowSpecs(claws, "damage").map((s) => s.expression)).toEqual(["2d8+5"]);
    // FR-CBT-74: a Damage after a natural 20 on the row's pending to-hit card is critical.
    const pending = (natural: number) => ({
      id: "n1",
      seq: 3,
      kind: "damage-card",
      state: "pending",
      payload: {
        encounterId: "e1",
        attackerId: "c-owl",
        attackerName: "Owlbear",
        attackName: "Claws",
        damageType: "slashing",
        mode: "normal",
        crit: natural === 20,
        toHit: {
          rollId: "r",
          dice: [[natural, true]],
          constant: 7,
          total: natural + 7,
          natural,
          manual: false,
        },
        damage: null,
        attackId: claws.id,
      },
    });
    expect(cardCritOptions({ petId: "owl" }, claws, "damage", [])).toEqual({});
    expect(cardCritOptions(fight, claws, "toHit", [])).toEqual({});
    expect(cardCritOptions(fight, claws, "attack", [])).toEqual({ critExpressions: ["4d8+5"] });
    expect(cardCritOptions(fight, claws, "damage", [pending(20) as never])).toEqual({
      critExpressions: ["4d8+5"],
      crit: true,
    });
    expect(cardCritOptions(fight, claws, "damage", [pending(12) as never])).toEqual({});
    // The rows render the three buttons, enabled while live, disabled offline.
    const html = render(
      storeOf(P1, { entities: [mira, owlPet], combatants: [owlC] }),
      <CompanionCard />,
    );
    expect(count(html, "charx-companion-roll")).toBe(6);
    for (const kind of ["toHit", "damage", "attack"]) {
      expect(tagOf(html, "charx-companion-roll", ` data-value="${kind}"`)).toSatisfy(
        (t: string) => !isDisabled(t),
      );
    }
    const off = render(
      storeOf(P1, { entities: [mira, owlPet], combatants: [owlC] }),
      <CompanionCard />,
      false,
    );
    expect(isDisabled(tagOf(off, "charx-companion-roll", ' data-value="toHit"'))).toBe(true);
    // A summon out of a fight never exists; a summon in a fight rolls as its combatant.
    selectCompanion("c-fe");
    const fe = render(storeOf(P1, { entities: [mira], combatants: [feC] }), <CompanionCard />);
    expect(tagOf(fe, "charx-companion-roll", ' data-value="attack"')).toContain(
      'data-record-id="touch-card"',
    );
  });
});

describe("FR-CHARX-65 conditions", () => {
  test("FR-CHARX-65 conditions: chips of the combatant's effects the viewer receives; none out of a fight; the owner has no chip menu, the DM the row's", () => {
    const poisoned = {
      id: "fx1",
      kind: "condition",
      condition: "poisoned",
      level: null,
      label: null,
      targetCombatantId: "c-owl",
      targetCharacterId: null,
      encounterId: "e1",
      endsRound: null,
    };
    const other = { ...poisoned, id: "fx2", targetCombatantId: "c-gob" };
    const html = render(
      storeOf(P1, { entities: [mira, owlPet], combatants: [owlC], effects: [poisoned, other] }),
      <CompanionCard />,
    );
    expect(tagOf(html, "charx-companion-effect")).toContain('data-record-id="fx1"');
    expect(count(html, "charx-companion-effect")).toBe(1);
    expect(html).not.toContain('aria-haspopup="menu"');
    const out = render(
      storeOf(P1, { entities: [mira, owlPet], effects: [poisoned], fight: false }),
      <CompanionCard />,
    );
    expect(has(out, "charx-companion-effect")).toBe(false);
    const dm = render(
      storeOf(DM, {
        entities: [mira, owlPet],
        combatants: [dmC(owlC, "owl")],
        effects: [poisoned],
      }),
      <CompanionCard dm={dmParts} />,
    );
    expect(tagOf(dm, "test-dm-effects")).toContain('data-record-id="c-owl"');
  });
});

describe("FR-CHARX-66 not a sheet", () => {
  test("FR-CHARX-66 not a sheet: no abilities, skills, saves, spells, notes or sections; the DM's Open NPC sheet only for pets and customs", () => {
    const html = render(
      storeOf(P1, { entities: [mira, owlPet], combatants: [owlC] }),
      <CompanionCard />,
    );
    for (const id of [
      "charx-ability",
      "charx-save",
      "charx-skill",
      "charx-spell",
      "charx-notes",
      "charx-section",
      "char-sheet-tab",
      "charx-companion-npc-sheet",
    ]) {
      expect(html).not.toContain(`data-testid="${id}`);
    }
    for (const word of ["Skills", "Saving", "Spells", "Notes", "Inventory"]) {
      expect(text(html)).not.toContain(word);
    }
    const custom = {
      id: "fe-def",
      kind: "monster",
      name: "Fire Elemental",
      campaignId: "c1",
      statBlock: owlbearBlock,
      ownerPlayerId: null,
    } as CompanionEntityLike;
    const dmStore = (entities: CompanionEntityLike[], c: CombatantView[]) =>
      storeOf(DM, { entities, combatants: c });
    // Pet → link.
    const pet = render(dmStore([mira, owlPet], [dmC(owlC, "owl")]), <CompanionCard dm={dmParts} />);
    expect(has(pet, "charx-companion-npc-sheet")).toBe(true);
    // A summon of a custom definition → link; of an imported one (no campaign row) → none.
    const summonCustom = render(
      dmStore([mira, custom], [dmC(feC, "fe-def")]),
      <CompanionCard dm={dmParts} />,
    );
    expect(has(summonCustom, "charx-companion-npc-sheet")).toBe(true);
    const summonImported = render(
      dmStore([mira], [dmC(feC, "srd-fe")]),
      <CompanionCard dm={dmParts} />,
    );
    expect(has(summonImported, "charx-companion-npc-sheet")).toBe(false);
  });
});

describe("FR-CHARX-67 card visibility", () => {
  test("FR-CHARX-67 card visibility (client): player-2's redacted Owlbear and band-only combatant give an empty picker and no card", () => {
    expect(companionEntries(P2, [mira, thorn, owlRedacted], [owlBand])).toEqual([]);
    expect(ownsCompanion("p2", [mira, thorn, owlRedacted], [owlBand])).toBe(false);
    // Player-2's own pet still shows; never player-1's.
    const p2 = companionEntries(P2, [thorn, owlRedacted, wolfPet], [owlBand]);
    expect(p2.map((e) => e.name)).toEqual(["Wolf"]);
  });
});

describe("FR-CHARX-68 states", () => {
  test("FR-CHARX-68 states: loading skeleton, empty text, disconnected banner with disabled buttons, the companion that left named before the picker moves on", () => {
    const loading = render({ ...emptyStore() }, <CompanionCard />);
    expect(has(loading, "charx-companion-loading")).toBe(true);
    const empty = render(storeOf(P1, { entities: [mira], fight: false }), <CompanionCard />);
    expect(text(empty)).toContain(EMPTY_TEXT);
    const dmEmpty = render(
      storeOf(DM, { entities: [mira], fight: false }),
      <CompanionCard dm={dmParts} />,
    );
    expect(text(dmEmpty)).toContain(DM_EMPTY_TEXT);
    const off = render(
      storeOf(P1, { entities: [mira, owlPet], fight: false }),
      <CompanionCard />,
      false,
    );
    expect(text(off)).toContain(OFFLINE_TEXT);
    // Last values stay; every button is disabled.
    expect(text(off)).toContain("45 / 59");
    for (const tag of off.match(
      /<button[^>]*data-testid="charx-companion-(roll|hp-adjust|edit)"[^>]*>/g,
    ) ?? []) {
      expect(isDisabled(tag)).toBe(true);
    }
    // The one shown leaves (Dismiss, hostile, hidden, released) → its name, then the next one.
    const before = companionEntries(P1, [mira, owlPet], [owlC, feC]);
    const fe = before.find((e) => e.key === "c-fe") ?? null;
    const after = companionEntries(P1, [mira, owlPet], [owlC]);
    expect(leftCompanion(fe, after)).toBe("Fire Elemental");
    expect(leftCompanion(fe, before)).toBeNull();
    expect(shownEntry(after, "c-fe")?.name).toBe("Owlbear");
  });
});

describe("FR-CBT-112 Dismiss from the card (CP3)", () => {
  test("FR-CBT-112 dismiss: the owner dismisses their summon from the card; never a pet; the DM any companion in the fight; the turn combatant → 'Press Next first'", () => {
    // player-1's Fire Elemental (a summon): Dismiss.
    const summon = render(storeOf(P1, { entities: [mira], combatants: [feC] }), <CompanionCard />);
    expect(tagOf(summon, "cbt-companion-dismiss", ' data-record-id="c-fe"')).toBeTruthy();
    expect(isDisabled(tagOf(summon, "cbt-companion-dismiss"))).toBe(false);
    // player-1's Owlbear (a pet) in the fight: no Dismiss for the owner.
    const pet = render(
      storeOf(P1, { entities: [mira, owlPet], combatants: [owlC] }),
      <CompanionCard />,
    );
    expect(has(pet, "cbt-companion-dismiss")).toBe(false);
    // Out of a fight: nothing to dismiss.
    expect(canDismissFromCard({ petId: null, combatant: null }, "player")).toBe(false);
    // The DM: a pet in the fight too.
    expect(canDismissFromCard({ petId: "owl", combatant: owlC }, "dm")).toBe(true);
    expect(canDismissFromCard({ petId: "owl", combatant: owlC }, "player")).toBe(false);
    // Its turn now (the player's shown turn): disabled with the hint.
    const turn = render(
      {
        ...storeOf(P1, { entities: [mira], combatants: [feC] }),
        records: {
          ...storeOf(P1, { entities: [mira], combatants: [feC] }).records,
          [ENCOUNTER_TYPE]: { e1: { ...enc, playerTurnCombatantId: "c-fe" } },
        },
      } as RecordStore,
      <CompanionCard />,
    );
    const tag = tagOf(turn, "cbt-companion-dismiss");
    expect(isDisabled(tag)).toBe(true);
    expect(tag).toContain(`title="${DISMISS_TURN_HINT}"`);
    // Offline: disabled.
    const off = render(
      storeOf(P1, { entities: [mira], combatants: [feC] }),
      <CompanionCard />,
      false,
    );
    expect(isDisabled(tagOf(off, "cbt-companion-dismiss"))).toBe(true);
  });
});

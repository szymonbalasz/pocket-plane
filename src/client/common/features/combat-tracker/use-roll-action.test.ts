// Sprint 15 S4 (#385, ADR-0073 decision 2): the DM's "Use as attack" / "Use as damage" log
// actions over a fake store: who sees them on which line (FR-DICE-97), the attacker a line's actor
// resolves to, and what the action does: the intent at once or the popup's step (FR-CBT-174).
import { beforeEach, describe, expect, test } from "bun:test";
import { CBT_INTENTS, COMBATANT_TYPE, ENCOUNTER_TYPE } from "@shared/combat-tracker/schemas";
import {
  GAME_LOG_ENTRY_TYPE,
  type GameLogEntryView,
  type RollPayloadItem,
} from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { actionsFor, entryActions } from "../dice-roll-log/entry-actions";
import {
  canUseRoll,
  intentForRoll,
  resolveAttacker,
  runUseRoll,
  USE_AS_ATTACK,
  USE_AS_DAMAGE,
  useUseRollRequest,
} from "./use-roll-action";

const item = (p: Partial<RollPayloadItem> = {}): RollPayloadItem => ({
  rollId: "r1",
  expression: "2d6",
  mode: "normal",
  manual: false,
  dice: [
    { faces: 6, value: 3, kept: true },
    { faces: 6, value: 4, kept: true },
  ],
  constant: 0,
  total: 7,
  natural: null,
  label: null,
  ...p,
});
const d20 = item({
  rollId: "r20",
  expression: "1d20+5",
  dice: [{ faces: 20, value: 12, kept: true }],
  constant: 5,
  total: 17,
  natural: 12,
});

const entry = (o: Partial<GameLogEntryView> = {}): GameLogEntryView => ({
  id: "e1",
  campaignId: "c1",
  n: 1,
  at: "2026-10-29T10:00:00.000Z",
  kind: "roll",
  category: "other",
  public: true,
  undone: false,
  rollerRole: "dm",
  rollerPlayerId: null,
  actorName: "DM",
  payload: [item()],
  rollIds: ["r1"],
  encounterId: null,
  supersededBy: null,
  ...o,
});

const byId = <T extends { id: string }>(rows: T[]) =>
  Object.fromEntries(rows.map((r) => [r.id, r]));

const fighter = (id: string, name: string, o: object = {}) => ({
  id,
  encounterId: "enc",
  name,
  kind: "monster",
  entityId: null,
  tokenId: null,
  active: true,
  removed: false,
  position: 0,
  ...o,
});

/** Round 1 of the tray-attacks fight, cut down: Mira and Brakka (player-1), Thorn, two Goblins. */
function store(o: { role?: "dm" | "player"; started?: boolean } = {}): RecordStore {
  const role = o.role ?? "dm";
  return {
    ...emptyStore(),
    you: { campaignId: "c1", role, playerId: role === "dm" ? null : "p1" },
    records: {
      [ENCOUNTER_TYPE]: byId([{ id: "enc", status: o.started === false ? "draft" : "started" }]),
      [COMBATANT_TYPE]: byId([
        fighter("cb-brakka", "Brakka", { kind: "pc", entityId: "brakka", position: 2 }),
        fighter("cb-mira", "Mira", { kind: "pc", entityId: "mira", position: 3 }),
        fighter("cb-gob", "Goblin", { entityId: "def-gob", tokenId: "t-gob", position: 4 }),
        fighter("cb-gob2", "Goblin 2", { entityId: "def-gob", tokenId: "t-gob2", position: 5 }),
        fighter("cb-thorn", "Thorn", { kind: "pc", entityId: "thorn", position: 6 }),
        fighter("cb-wolf", "Wolf", { entityId: "def-wolf", tokenId: "t-wolf", position: 1 }),
        fighter("cb-gone", "Bandit", { removed: true, position: 7 }),
      ]),
      [ENTITY_TYPE]: byId([
        { id: "mira", kind: "character", name: "Mira", ownerPlayerId: "p1" },
        { id: "brakka", kind: "character", name: "Brakka", ownerPlayerId: "p1" },
        { id: "thorn", kind: "character", name: "Thorn", ownerPlayerId: "p2" },
        { id: "def-gob", kind: "monster", name: "Goblin", ownerPlayerId: null },
        { id: "def-wolf", kind: "monster", name: "Dire Wolf", ownerPlayerId: null },
      ]),
      [TOKEN_TYPE]: byId([{ id: "t-wolf", name: "Grey Wolf" }]),
      player: byId([
        { id: "p1", name: "Player 1" },
        { id: "p2", name: "Player 2" },
      ]),
      [GAME_LOG_ENTRY_TYPE]: {},
    },
  } as unknown as RecordStore;
}

const shown = (s: RecordStore, e: GameLogEntryView) =>
  actionsFor(entryActions, s, e).map((a) => a.label);

describe("FR-DICE-97 use-as availability", () => {
  test("FR-DICE-97 use-as availability: DM only, on an unused roll line in a started encounter; attack needs a d20, damage 1–3 damage rolls", () => {
    const dm = store();
    // A plain 2d6: damage only (no d20).
    expect(shown(dm, entry())).toEqual([USE_AS_DAMAGE]);
    // A d20 roll: attack; its damage items are those without a natural (none) → no damage.
    expect(shown(dm, entry({ payload: [d20] }))).toEqual([USE_AS_ATTACK]);
    // A d20 and a damage roll in one line: both.
    expect(shown(dm, entry({ payload: [d20, item()] }))).toEqual([USE_AS_ATTACK, USE_AS_DAMAGE]);
    // Tagged items win: an attack-tagged item; damage-tagged items only.
    const tagged = [d20, item({ purpose: "damage", part: { type: "fire", extra: false } })];
    expect(shown(dm, entry({ payload: tagged }))).toEqual([USE_AS_ATTACK, USE_AS_DAMAGE]);
    // Four damage rolls: more than a card holds.
    const four = [1, 2, 3, 4].map((i) => item({ rollId: `r${i}` }));
    expect(shown(dm, entry({ payload: four }))).toEqual([]);
    // Players never; no started encounter → none.
    expect(shown(store({ role: "player" }), entry({ payload: [d20, item()] }))).toEqual([]);
    expect(shown(store({ started: false }), entry({ payload: [d20, item()] }))).toEqual([]);
  });

  test("FR-DICE-97 use-as availability: hidden on used, combat-owned, undone, superseded and non-roll lines", () => {
    const dm = store();
    const you = dm.you as NonNullable<RecordStore["you"]>;
    const both = (e: GameLogEntryView) =>
      canUseRoll("attack", dm, e, you) || canUseRoll("damage", dm, e, you);
    const base = { payload: [d20, item()] };
    expect(both(entry(base))).toBe(true);
    expect(both(entry({ ...base, dmPayload: { items: [], usedByCardId: "card1" } }))).toBe(false);
    expect(both(entry({ ...base, encounterId: "enc" }))).toBe(false);
    expect(both(entry({ ...base, undone: true }))).toBe(false);
    expect(both(entry({ ...base, supersededBy: "e2" }))).toBe(false);
    expect(both(entry({ ...base, kind: "cbt.applied" }))).toBe(false);
    expect(both(entry({ payload: "unreadable" }))).toBe(false);
  });
});

describe("FR-CBT-174 attacker resolve", () => {
  test("FR-CBT-174 attacker resolve: a combatant's name, a token's, an entity with one combatant; a player's 'me' roll → their only PC; else unresolved", () => {
    const s = store();
    expect(resolveAttacker(s, entry({ actorName: "Goblin 2" }))).toBe("cb-gob2");
    expect(resolveAttacker(s, entry({ actorName: "Grey Wolf" }))).toBe("cb-wolf");
    expect(resolveAttacker(s, entry({ actorName: "Dire Wolf" }))).toBe("cb-wolf");
    // Mira rolled by her player: her name.
    const asMira = { rollerRole: "player" as const, rollerPlayerId: "p1", actorName: "Mira" };
    expect(resolveAttacker(s, entry(asMira))).toBe("cb-mira");
    // Player 1 as "me": two PCs → the DM picks; Player 2 as "me": Thorn.
    const me1 = { rollerRole: "player" as const, rollerPlayerId: "p1", actorName: "Player 1" };
    expect(resolveAttacker(s, entry(me1))).toBeNull();
    const me2 = { rollerRole: "player" as const, rollerPlayerId: "p2", actorName: "Player 2" };
    expect(resolveAttacker(s, entry(me2))).toBe("cb-thorn");
    // The DM as DM; a removed combatant's name.
    expect(resolveAttacker(s, entry())).toBeNull();
    expect(resolveAttacker(s, entry({ actorName: "Bandit" }))).toBeNull();
  });
});

describe("FR-CBT-174 use roll step", () => {
  const sent: { name: string; payload: unknown }[] = [];
  const ctx = (s: RecordStore) => ({
    store: s,
    send: (name: string, payload: unknown) => {
      sent.push({ name, payload });
      return Promise.resolve({ cardId: "card9", attached: false });
    },
  });
  beforeEach(() => {
    sent.length = 0;
    useUseRollRequest.setState({ open: null, n: 0 });
  });

  test("FR-CBT-174 use roll step: resolved and typed → `cbt.useRoll` at once, then the popup on the card", async () => {
    const s = store();
    const asMira = { rollerRole: "player" as const, rollerPlayerId: "p1", actorName: "Mira" };
    await runUseRoll("attack", entry({ ...asMira, payload: [d20] }), ctx(s));
    expect(sent).toEqual([
      {
        name: CBT_INTENTS.useRoll,
        payload: { entryId: "e1", as: "attack", attackerId: "cb-mira" },
      },
    ]);
    expect(useUseRollRequest.getState()).toMatchObject({ open: { cardId: "card9" }, n: 1 });
    // A typed damage roll by a resolved actor: no step either, no `types`.
    const typed = item({ purpose: "damage", part: { type: "slashing", extra: false } });
    await runUseRoll("damage", entry({ actorName: "Goblin", payload: [typed] }), ctx(s));
    expect(sent[1]?.payload).toEqual({ entryId: "e1", as: "damage", attackerId: "cb-gob" });
  });

  test("FR-CBT-174 use roll step: unresolved attacker or an untyped damage roll → the step, nothing sent", async () => {
    const s = store();
    await runUseRoll("damage", entry(), ctx(s));
    expect(useUseRollRequest.getState().open).toEqual({
      step: { entryId: "e1", as: "damage", attackerId: null },
    });
    // Resolved (the Goblin) but untyped: the step with the attacker preset.
    await runUseRoll("damage", entry({ actorName: "Goblin" }), ctx(s));
    expect(useUseRollRequest.getState()).toMatchObject({
      open: { step: { entryId: "e1", as: "damage", attackerId: "cb-gob" } },
      n: 2,
    });
    expect(sent).toEqual([]);
  });

  test("FR-CBT-174 use roll step: Make card's intent carries a type per untyped damage roll only", () => {
    const base = item({ rollId: "a", purpose: "damage", part: { type: null, extra: false } });
    const extra = item({ rollId: "b", purpose: "damage", part: { type: "fire", extra: true } });
    const e = entry({ payload: [base, extra] });
    expect(intentForRoll(e, "damage", "cb-mira", { a: "piercing" })).toEqual({
      entryId: "e1",
      as: "damage",
      attackerId: "cb-mira",
      types: ["piercing", null],
    });
    // The base part left "No type".
    expect(intentForRoll(e, "damage", "cb-mira", {}).types).toEqual([null, null]);
    expect(intentForRoll(entry({ payload: [d20] }), "attack", "cb-mira", { r20: "fire" })).toEqual({
      entryId: "e1",
      as: "attack",
      attackerId: "cb-mira",
    });
  });
});

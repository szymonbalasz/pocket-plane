// Combat's tray route (FR-CBT-172) and the sheet route's staged parts / rowless crit match
// (FR-CBT-170, -171 client side; ADR-0073).
import { describe, expect, test } from "bun:test";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { rollRoutes } from "../character-sheet/roll-routes";
import { routeFor } from "../character-sheet/routing";
import { trayRoutes } from "../dice-extras/tray-routes";
import { trayRouteFor } from "../dice-extras/tray-routing";
import { pendingToHitCard } from "./roll-route";
import { combatTrayRoute, trayAttacker } from "./tray-route";

const pc = (id: string, entityId: string, o: object = {}) => ({
  id,
  encounterId: "e1",
  kind: "pc",
  entityId,
  tokenId: `t-${entityId}`,
  name: entityId,
  removed: false,
  ...o,
});

/** A pending to-hit-only card of `attackerId` (row `o`), natural `natural`. */
const card = (id: string, seq: number, natural: number, o: object = {}) => ({
  id,
  seq,
  kind: "damage-card",
  state: "pending",
  payload: {
    encounterId: "e1",
    attackerId: "cb-brakka",
    attackerName: "Brakka",
    attackName: "Attack",
    damageType: null,
    mode: "normal",
    crit: natural === 20,
    toHit: {
      rollId: "r",
      dice: [[natural, true]],
      constant: 9,
      total: natural + 9,
      natural,
      manual: false,
    },
    damage: null,
    ...o,
  },
});

function fight(
  o: {
    role?: "dm" | "player";
    status?: string;
    combatants?: object[];
    cards?: ReturnType<typeof card>[];
  } = {},
): RecordStore {
  const role = o.role ?? "player";
  const combatants = o.combatants ?? [
    pc("cb-brakka", "brakka"),
    pc("cb-thorn", "thorn"),
    { ...pc("cb-gob", "goblin"), kind: "monster", tokenId: "t-gob", name: "Goblin" },
  ];
  return {
    ...emptyStore(),
    you: { campaignId: "c1", role, playerId: role === "dm" ? null : "p1" },
    records: {
      entity: {
        brakka: {
          id: "brakka",
          kind: "character",
          name: "Brakka",
          ownerPlayerId: "p1",
          statBlock: { attacks: [{ id: "ft", name: "Flame Tongue", toHit: 9, damage: "2d6+5" }] },
        },
        thorn: { id: "thorn", kind: "character", name: "Thorn", ownerPlayerId: "p2" },
      },
      encounter: { e1: { id: "e1", status: o.status ?? "started", round: 1 } },
      combatant: Object.fromEntries(combatants.map((c) => [(c as { id: string }).id, c])),
      notification: Object.fromEntries((o.cards ?? []).map((c) => [c.id, c])),
    },
  };
}

const brakka = { entityId: "brakka" };

describe("FR-CBT-172 tray route", () => {
  test("FR-CBT-172 tray route claims", async () => {
    const sent: [string, unknown][] = [];
    const send = (n: string, p: unknown) => {
      sent.push([n, p]);
      return Promise.resolve({});
    };
    // Brakka's free 1d20+9 → a rowless to-hit card; the tray's label and mode.
    const atk = trayRouteFor(trayRoutes, fight(), {
      purpose: "attack",
      mode: "advantage",
      label: "Shove",
      actor: brakka,
    });
    expect(atk?.crit).toBe(false);
    await atk?.send(send, [{ expression: "1d20+9" }], {
      mode: "advantage",
      manual: [{ diceTotal: 17 }],
    });
    // Damage completes it (the server's rowless match); no label → none sent.
    const dmg = trayRouteFor(trayRoutes, fight(), {
      purpose: "damage",
      mode: "normal",
      actor: brakka,
    });
    await dmg?.send(
      send,
      [
        { expression: "2d6", type: "slashing" },
        { expression: "1d8", type: "fire" },
      ],
      { mode: "normal", manual: [{ diceTotal: 7 }, { diceTotal: 5 }] },
    );
    expect(sent).toEqual([
      [
        "cbt.attack",
        {
          attackerId: "cb-brakka",
          mode: "advantage",
          rolls: "toHit",
          parts: [{ expression: "1d20+9" }],
          rowless: true,
          label: "Shove",
          manual: [{ diceTotal: 17 }],
        },
      ],
      [
        "cbt.rollDamage",
        {
          attackerId: "cb-brakka",
          parts: [
            { expression: "2d6", type: "slashing" },
            { expression: "1d8", type: "fire" },
          ],
          rowless: true,
          manual: { diceTotal: 7 },
          manualExtra: [{ diceTotal: 5 }],
        },
      ],
    ]);
    // Out of combat, "me", another player's PC, a removed / inactive combatant → unclaimed.
    const claim = (s: RecordStore, actor: object | undefined) =>
      combatTrayRoute.claim(s, {
        purpose: "attack",
        mode: "normal",
        ...(actor ? { actor: actor as never } : {}),
      });
    expect(claim(fight({ status: "ended" }), brakka)).toBeNull();
    expect(claim(fight(), undefined)).toBeNull();
    expect(claim(fight(), { entityId: "thorn" })).toBeNull();
    expect(
      claim(fight({ combatants: [pc("cb-brakka", "brakka", { removed: true })] }), brakka),
    ).toBeNull();
    expect(
      claim(fight({ combatants: [pc("cb-brakka", "brakka", { active: false })] }), brakka),
    ).toBeNull();
  });

  test("FR-CBT-172 the attacker: player own PC / companion; DM combatant, bound token, one-combatant entity", () => {
    const pet = {
      ...pc("cb-wolf", "wolf"),
      kind: "monster",
      ownerPlayerId: "p1",
      ownerCharacterId: "brakka",
    };
    const s = fight({ combatants: [pc("cb-brakka", "brakka"), pet] });
    expect(trayAttacker(s, brakka)?.id).toBe("cb-brakka");
    expect(trayAttacker(s, { entityId: "wolf" })?.id).toBe("cb-wolf");
    // Players can't name a token or a combatant.
    expect(trayAttacker(s, { tokenId: "t-brakka" })).toBeNull();
    const dm = fight({ role: "dm" });
    expect(trayAttacker(dm, { combatantId: "cb-gob" })?.id).toBe("cb-gob");
    expect(trayAttacker(dm, { tokenId: "t-gob" })?.id).toBe("cb-gob");
    expect(trayAttacker(dm, { entityId: "thorn" })?.id).toBe("cb-thorn");
    // An entity with two combatants (two goblins) is ambiguous.
    const two = fight({
      role: "dm",
      combatants: [
        { ...pc("g1", "goblin"), kind: "monster" },
        { ...pc("g2", "goblin"), kind: "monster" },
      ],
    });
    expect(trayAttacker(two, { entityId: "goblin" })).toBeNull();
  });

  test("FR-CBT-172 crit: the attacker's latest pending to-hit-only card (any row) has a natural 20", () => {
    const crit = (cards: ReturnType<typeof card>[]) =>
      combatTrayRoute.claim(fight({ cards }), { purpose: "damage", mode: "normal", actor: brakka })
        ?.crit;
    expect(crit([card("n1", 1, 20, { attackId: "ft" })])).toBe(true);
    expect(crit([card("n1", 1, 20)])).toBe(true);
    expect(crit([card("n1", 1, 20), card("n2", 2, 11, { attackId: "ft" })])).toBe(false);
    expect(crit([])).toBe(false);
    // Attack never shows the badge.
    const atk = combatTrayRoute.claim(fight({ cards: [card("n1", 1, 20)] }), {
      purpose: "attack",
      mode: "normal",
      actor: brakka,
    });
    expect(atk?.crit).toBe(false);
  });
});

describe("FR-CBT-171 rowless match on the client", () => {
  test("FR-CBT-171 match rules", () => {
    const notes = (cards: ReturnType<typeof card>[]) =>
      cards as unknown as Parameters<typeof pendingToHitCard>[0];
    const row = card("n1", 1, 12, { attackId: "ft" });
    const rowless = card("n2", 1, 12);
    // row ↔ same row ✓, row ↔ rowless ✓ (either side), two rows ✗.
    expect(pendingToHitCard(notes([row]), "cb-brakka", { attackId: "ft" })).not.toBeNull();
    expect(pendingToHitCard(notes([rowless]), "cb-brakka", { attackId: "ft" })).not.toBeNull();
    expect(pendingToHitCard(notes([row]), "cb-brakka", null)).not.toBeNull();
    expect(pendingToHitCard(notes([row]), "cb-brakka", { attackId: "other" })).toBeNull();
    // The sheet's Damage after a rowless natural 20: critical.
    const s = fight({ cards: [card("n1", 1, 20)] });
    const claim = routeFor(rollRoutes, s, "brakka", "damage", { attackId: "ft" });
    expect(claim?.crit).toBe(true);
  });
});

describe("FR-CBT-170 staged parts on the sheet route", () => {
  test("FR-CBT-170 staged parts ride on Attack and Damage, not on Attack + damage", async () => {
    const sent: [string, unknown][] = [];
    const send = (n: string, p: unknown) => {
      sent.push([n, p]);
      return Promise.resolve(null);
    };
    const s = fight();
    const ref = { attackId: "ft" };
    const parts = [{ expression: "1d20+1d4+9" }];
    await routeFor(rollRoutes, s, "brakka", "toHit", ref)?.send(send, {
      mode: "normal",
      parts,
    } as never);
    const dmg = [{ expression: "3d6+5", type: "slashing" as const }];
    await routeFor(rollRoutes, s, "brakka", "damage", ref)?.send(send, {
      mode: "normal",
      parts: dmg,
    } as never);
    await routeFor(rollRoutes, s, "brakka", "toHit", ref)?.send(send, { mode: "normal" });
    expect(sent).toEqual([
      [
        "cbt.attack",
        { attackerId: "cb-brakka", mode: "normal", rolls: "toHit", attackId: "ft", parts },
      ],
      ["cbt.rollDamage", { attackerId: "cb-brakka", attackId: "ft", parts: dmg }],
      ["cbt.attack", { attackerId: "cb-brakka", mode: "normal", rolls: "toHit", attackId: "ft" }],
    ]);
  });
});

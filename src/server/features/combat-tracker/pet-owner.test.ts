// Sprint 7 FU-combat: FR-MAP-88's server invariant (every token of a pet carries the pet's owner
// after End as well as after Start / Add, every turn mode; Start / Add re-assert only as a safety
// net) and FR-CBT-145 (End deletes every summon's surviving token, whatever its owner now; a
// charmed companion keeps its token without an owner, #310 (2)).
import { describe, expect, test } from "bun:test";
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import type { EncounterRecord } from "@shared/combat-tracker/schemas";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { token } from "../../db/schema";
import { createEncounter } from "./encounters";
import { setRemoved } from "./initiative";
import { startCommand } from "./lifecycle";
import { summonSetup } from "./summon-testing";

type Setup = ReturnType<typeof summonSetup>;

const owners = (t: Setup) => [
  t.tokenRow(t.petTokens.owlbear).ownerPlayerId,
  t.tokenRow(t.petTokens.drake).ownerPlayerId,
];
const tokenExists = (t: Setup, id: string) =>
  t.s.db.select().from(token).where(eq(token.id, id)).get() !== undefined;
const nextFight = (t: Setup) =>
  t.run<EncounterRecord>(createEncounter.name, {
    name: "Next",
    partyCharacterIds: null,
    entries: [],
  });

describe("FR-MAP-88 companion marker after End → Start (server invariant)", () => {
  test("FR-MAP-88 companion marker after End → Start: pets' tokens keep their owner after End and after Start, every turn mode", () => {
    const t = summonSetup();
    const mine = [t.h.p1.id, t.h.p2.id];
    expect(owners(t)).toEqual(mine);
    // The drake switches to its own initiative for this fight (all three modes in play).
    t.setCompanion({ combatantId: t.id("Drake"), owner: t.owner(t.thornId, "own") });
    t.summon();
    t.endEncounter();
    expect(owners(t)).toEqual(mine);
    const next = nextFight(t);
    t.run(startCommand.name, {
      encounterId: next.id,
      sceneId: t.sceneId,
      petIds: [t.owlbear, t.drake],
    });
    expect(owners(t)).toEqual(mine);
    // Nothing differed, so Start sent no token owner rows (the re-assert is only a safety net).
    const started = t.events.at(-1)?.event;
    expect(started?.type).toBe("EncounterStarted");
    const tokenRows = (started?.changes ?? []).filter(
      (c) => c.type === TOKEN_TYPE && Object.values(t.petTokens).includes(c.id),
    );
    expect(tokenRows).toEqual([]);
  });

  test("FR-MAP-88 companion marker after End → Start: Start / Add re-assert a pet token's lost owner (safety net)", () => {
    const t = summonSetup();
    t.endEncounter();
    // Simulate a lost owner (no command clears it today).
    t.s.db.$client.run("update token set owner_player_id = null where id in (?, ?)", [
      t.petTokens.owlbear,
      t.petTokens.drake,
    ]);
    const next = nextFight(t);
    t.run(startCommand.name, { encounterId: next.id, sceneId: t.sceneId, petIds: [t.owlbear] });
    expect(owners(t)).toEqual([t.h.p1.id, null]);
    t.run(CBTX_INTENTS.addCombatants, {
      encounterId: next.id,
      items: [{ tokenId: t.petTokens.drake }],
    });
    expect(owners(t)).toEqual([t.h.p1.id, t.h.p2.id]);
    // Dismiss of another creature leaves them alone; End keeps them.
    const [fe] = t.summon({ encounterId: next.id });
    t.dismiss({ combatantId: fe as string });
    t.run("cbt.end", { encounterId: next.id });
    expect(owners(t)).toEqual([t.h.p1.id, t.h.p2.id]);
  });
});

describe("FR-CBT-145 End removes every summon's token", () => {
  test("FR-CBT-145 End removes hostile summon tokens: hostile, released and removed summons lose their tokens; charmed and pets keep theirs", () => {
    const t = summonSetup();
    const [hostile] = t.summon();
    const [released] = t.summon({ ownerCharacterId: t.thornId });
    const [removed] = t.summon();
    const tok = (id?: string) => t.combatantRow(id as string).tokenId as string;
    const summonTokens = [tok(hostile), tok(released), tok(removed)];
    t.setCompanion({ combatantId: hostile as string, owner: null, side: "enemy" });
    t.setCompanion({ combatantId: released as string, owner: null });
    t.run(setRemoved.name, { combatantId: removed as string, removed: true });
    // Goblin 2 charmed by Mira (a companion made with `cbt.setCompanion`, not summoned).
    const g2 = t.id("Goblin 2");
    t.setCompanion({ combatantId: g2, owner: t.owner(t.miraId) });
    const g2Token = tok(g2);
    expect(t.tokenRow(g2Token).ownerPlayerId).toBe(t.h.p1.id);
    const n = t.events.length;
    t.endEncounter();
    for (const id of summonTokens) expect(tokenExists(t, id)).toBe(false);
    expect(t.tokenRow(g2Token).ownerPlayerId).toBeNull();
    expect(owners(t)).toEqual([t.h.p1.id, t.h.p2.id]);
    // One EncounterEnded carries the deletes; each player who held a token gets its delete.
    const ended = t.events.slice(n).find((e) => e.event.type === "EncounterEnded")?.event;
    const deletes = (ended?.changes ?? []).filter((c) => c.type === TOKEN_TYPE && c.after === null);
    expect(deletes.map((c) => c.id).sort()).toEqual([...summonTokens].sort());
    for (const v of [t.p1V, t.p2V]) {
      const wire = t.wire(ended?.changes ?? [], v).filter((w) => w.type === TOKEN_TYPE);
      for (const id of summonTokens) {
        expect(wire).toContainEqual(expect.objectContaining({ id, op: "delete" }));
      }
    }
  });

  test("FR-CBT-145 End removes hostile summon tokens: a dismissed summon's token is already gone; End finds nothing for it", () => {
    const t = summonSetup();
    const [fe] = t.summon();
    const feToken = t.combatantRow(fe as string).tokenId as string;
    t.dismiss({ combatantId: fe as string });
    expect(tokenExists(t, feToken)).toBe(false);
    const n = t.events.length;
    t.endEncounter();
    const ended = t.events.slice(n).find((e) => e.event.type === "EncounterEnded")?.event;
    expect((ended?.changes ?? []).filter((c) => c.id === feToken)).toEqual([]);
  });
});

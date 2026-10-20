import { describe, expect, test } from "bun:test";
import { planBindings, ranks } from "@shared/combat-tracker/rules";
import {
  COMBATANT_TYPE,
  type CombatantRecord,
  ENCOUNTER_TYPE,
  type EncounterRecord,
} from "@shared/combat-tracker/schemas";
import { MAP_INTENTS } from "@shared/scenes-map/schemas";
import { UPDATE } from "../entities/commands";
import { MAP_REST } from "../scenes-map/commands";
import { createEncounter } from "./encounters";
import { TOKEN_IN_ENCOUNTER } from "./hooks";
import { endCommand, startCommand } from "./lifecycle";
import { combatSetup, eliteBlock } from "./testing";

const pos = (rows: CombatantRecord[]) =>
  [...rows]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((r) => [r.name, r.playerPosition]);

function started() {
  const t = combatSetup();
  const enc = t.createAmbush();
  t.run(startCommand.name, { encounterId: enc.id, sceneId: t.sceneId });
  return { ...t, enc };
}

describe("FR-CBT-13 order (unit)", () => {
  const row = (id: string, o: Partial<Parameters<typeof ranks>[0][number]> = {}) => ({
    id,
    seq: 0,
    kind: "monster" as const,
    initiative: null,
    initBonus: 0,
    active: true,
    removed: false,
    hidden: false,
    ...o,
  });
  test("FR-CBT-13 initiative desc, bonus desc, PC before monster, seq; none last", () => {
    const r = ranks([
      row("none", { seq: 1, initBonus: 9 }),
      row("m12b2s3", { seq: 3, initiative: 12, initBonus: 2 }),
      row("m12b2s2", { seq: 2, initiative: 12, initBonus: 2 }),
      row("pc12b2", { seq: 9, initiative: 12, initBonus: 2, kind: "pc" }),
      row("m12b3", { seq: 8, initiative: 12, initBonus: 3 }),
      row("m18", { seq: 7, initiative: 18 }),
    ]);
    const order = [...r]
      .sort((a, b) => (a[1].position ?? 0) - (b[1].position ?? 0))
      .map(([id]) => id);
    expect(order).toEqual(["m18", "m12b3", "pc12b2", "m12b2s2", "m12b2s3", "none"]);
  });
  test("FR-CBT-13 playerPosition skips hidden, removed, inactive", () => {
    const r = ranks([
      row("a", { seq: 1, initiative: 20 }),
      row("h", { seq: 2, initiative: 19, hidden: true }),
      row("r", { seq: 3, initiative: 18, removed: true }),
      row("b", { seq: 4, initiative: 17 }),
    ]);
    expect([...r.values()]).toEqual([
      { position: 1, playerPosition: 1 },
      { position: 2, playerPosition: null },
      { position: 3, playerPosition: null },
      { position: 4, playerPosition: 2 },
    ]);
  });
  test("FR-CBT-08 binding: token seq order, copies; token-less numbered (FR-MAP-16)", () => {
    const slot = (entityId: string, name: string) => ({
      kind: "monster" as const,
      entityId,
      name,
      portraitAssetId: "p",
    });
    const tok = (id: string, seq: number, hidden = false) => ({
      id,
      seq,
      definitionId: "gob",
      name: id,
      imageAssetId: `img-${id}`,
      hidden,
    });
    const b = planBindings(
      [slot("gob", "Goblin"), slot("gob", "Goblin"), slot("gob", "Goblin"), slot("wolf", "Wolf")],
      [tok("Goblin 2", 5), tok("Goblin", 2, true)],
    );
    expect(b.map((x) => [x.tokenId, x.name, x.imageAssetId, x.hidden])).toEqual([
      ["Goblin", "Goblin", "img-Goblin", true],
      ["Goblin 2", "Goblin 2", "img-Goblin 2", false],
      [null, "Goblin 3", "p", false],
      [null, "Wolf", "p", false],
    ]);
  });
});

describe("FR-CBT-07 FR-CBT-08 FR-CBT-10 start / end", () => {
  test("FR-CBT-07 FR-CBT-08 start binds tokens; hidden copied; monster HP; ranks", () => {
    const t = started();
    const rows = t.combatants(t.enc.id);
    expect(rows.map((r) => [r.name, r.kind, r.tokenId !== null, r.hidden])).toEqual([
      ["Mira", "pc", true, false],
      ["Thorn", "pc", true, false],
      ["Goblin", "monster", true, false],
      ["Goblin 2", "monster", true, false],
      ["Wolf", "monster", true, true],
      ["Elite Goblin Warrior", "monster", true, true],
    ]);
    const by = t.byName(t.enc.id);
    expect(by.Goblin?.tokenId).toBe(t.tokens.goblin);
    expect(by["Goblin 2"]?.tokenId).toBe(t.tokens.goblin2);
    expect(by.Wolf).toMatchObject({ hpCurrent: 11, hpMax: 11 });
    expect(by.Mira).toMatchObject({ hpCurrent: null, hpMax: null });
    // Sprint 2 (FR-CBT-64): monsters rolled at Start rank first; PCs without initiative last.
    const ranked = pos(rows);
    expect(ranked.slice(4)).toEqual([
      ["Thorn", 3],
      ["Mira", 4],
    ]);
    for (const r of rows) expect(r.initiative === null).toBe(r.kind === "pc");
    const visible = ranked.slice(0, 4).filter(([n]) => n === "Goblin" || n === "Goblin 2");
    expect(visible.map(([, p]) => p)).toEqual([1, 2]);
    const ev = t.events.at(-1)?.event;
    expect(ev?.type).toBe("EncounterStarted");
    expect(ev?.payload).toMatchObject({ encounterId: t.enc.id, sceneId: t.sceneId });
    expect(t.logTypes().at(-1)).toBe("EncounterStarted");
    expect(t.s.db.$client.query("select round, status from encounter").get()).toEqual({
      round: 0,
      status: "started",
    });
  });

  test("FR-CBT-07 second start conflict; not planned conflict; scene of another campaign", () => {
    const t = started();
    const other = t.createAmbush();
    expect(
      t.err(() => t.run(startCommand.name, { encounterId: other.id, sceneId: t.sceneId })).code,
    ).toBe("conflict");
    expect(
      t.err(() => t.run(startCommand.name, { encounterId: t.enc.id, sceneId: t.sceneId })).code,
    ).toBe("conflict");
    t.run(endCommand.name, { encounterId: t.enc.id });
    expect(
      t.err(() => t.run(startCommand.name, { encounterId: other.id, sceneId: "nope" })).code,
    ).toBe("not_found");
    expect(t.count("combatant")).toBe(6);
  });

  test("FR-CBT-08 token-less extra goblin is numbered and visible; party list honoured", () => {
    const t = combatSetup();
    const enc = t.run<EncounterRecord>(createEncounter.name, {
      name: "Many",
      partyCharacterIds: [t.thornId],
      entries: [{ definitionId: t.h.goblinId, quantity: 3 }],
      createTokens: false,
    });
    t.run(startCommand.name, { encounterId: enc.id, sceneId: t.sceneId });
    expect(t.combatants(enc.id).map((r) => [r.name, r.tokenId === null, r.hidden])).toEqual([
      ["Thorn", false, false],
      ["Goblin", false, false],
      ["Goblin 2", false, false],
      ["Goblin 3", true, false],
    ]);
  });

  test("FR-CBT-10 end: ended + endedAt; combatants inactive; players get deletes", () => {
    const t = started();
    t.run(endCommand.name, { encounterId: t.enc.id });
    const ev = t.events.at(-1)?.event;
    expect(ev?.type).toBe("EncounterEnded");
    expect(ev?.changes.filter((c) => c.type === COMBATANT_TYPE)).toHaveLength(6);
    expect(t.combatants(t.enc.id).every((c) => !c.active)).toBe(true);
    const v = t.h.viewer("player", t.h.p1.id);
    for (const c of ev?.changes ?? []) {
      expect(t.s.records.filterChange(c, v)?.op ?? "none").toMatch(/delete|none/);
    }
    expect(t.err(() => t.run(endCommand.name, { encounterId: t.enc.id })).code).toBe("conflict");
  });

  test("FR-CBT-27 visibility matrix: started encounter redacted; combatants per rule", () => {
    const t = started();
    const pl = t.h.snapshot(t.h.viewer("player", t.h.p2.id));
    expect(pl[ENCOUNTER_TYPE]).toEqual([
      { id: t.enc.id, status: "started", round: 0, playerTurnCombatantId: null },
    ]);
    const cs = pl[COMBATANT_TYPE] as Record<string, unknown>[];
    expect(cs.map((c) => c.name)).toEqual(["Mira", "Thorn", "Goblin", "Goblin 2"]);
    const gob = cs.find((c) => c.name === "Goblin");
    expect(gob).toEqual({
      id: expect.any(String),
      encounterId: t.enc.id,
      kind: "monster",
      tokenId: t.tokens.goblin,
      name: "Goblin",
      imageAssetId: null,
      playerPosition: expect.any(Number),
      band: "healthy",
      removed: false,
      movedFt: 0,
      side: "enemy",
    });
    expect(Object.keys(cs[0] ?? {}).sort()).toEqual(
      [
        "encounterId",
        "entityId",
        "id",
        "imageAssetId",
        "initiative",
        "kind",
        "movedFt",
        "name",
        "playerPosition",
        "removed",
        "side",
        "tokenId",
      ].sort(),
    );
    const raw = JSON.stringify(pl);
    for (const leak of ["Elite Goblin Warrior", "Ambush at the Ford", '"position"']) {
      expect(raw).not.toContain(leak);
    }
    for (const leak of ["hpMax", "hpCurrent", '"initRollId"']) {
      expect(JSON.stringify(cs)).not.toContain(leak);
    }
    for (const leak of ['"turnCombatantId"', "sceneId", "Wolf"]) {
      expect(raw).not.toContain(leak);
    }
    const dm = t.h.snapshot(t.h.viewer("dm"));
    expect(dm[COMBATANT_TYPE]).toHaveLength(6);
  });
});

describe("FR-CBT-09 token-changed hook", () => {
  test("FR-CBT-09 reveal Wolf → combatant upsert + ranks shift in the token event", () => {
    const t = started();
    t.run(MAP_INTENTS.setTokenHidden, { tokenId: t.tokens.wolf, hidden: false });
    const ev = t.events.at(-1)?.event;
    expect(ev?.type).toBe("TokenRevealed");
    const by = t.byName(t.enc.id);
    expect(by.Wolf?.hidden).toBe(false);
    expect(by.Wolf?.playerPosition).toBeNumber();
    const v = t.h.viewer("player", t.h.p1.id);
    const wire = (ev?.changes ?? []).map((c) => t.s.records.filterChange(c, v)).filter(Boolean);
    expect(wire.some((w) => w?.type === COMBATANT_TYPE && w.id === by.Wolf?.id)).toBe(true);
    // Hide again → delete for players.
    t.run(MAP_INTENTS.setTokenHidden, { tokenId: t.tokens.wolf, hidden: true });
    const hide = t.events.at(-1)?.event;
    const del = (hide?.changes ?? []).map((c) => t.s.records.filterChange(c, v));
    expect(del.some((w) => w?.op === "delete" && w.id === by.Wolf?.id)).toBe(true);
  });

  test("FR-CBT-09 rename / image copy; delete bound token → conflict; after End → set null", () => {
    const t = started();
    t.run(MAP_INTENTS.updateToken, { tokenId: t.tokens.goblin, name: "Sneaky" });
    expect(t.byName(t.enc.id).Sneaky?.tokenId).toBe(t.tokens.goblin);
    const e = t.err(() => t.run(MAP_INTENTS.deleteToken, { tokenId: t.tokens.goblin2 }));
    expect(e).toMatchObject({ code: "conflict", message: TOKEN_IN_ENCOUNTER });
    expect(t.err(() => t.run(MAP_REST.deleteScene, { id: t.sceneId })).message).toBe(
      TOKEN_IN_ENCOUNTER,
    );
    t.run(endCommand.name, { encounterId: t.enc.id });
    t.run(MAP_INTENTS.deleteToken, { tokenId: t.tokens.goblin2 });
    expect(t.byName(t.enc.id)["Goblin 2"]?.tokenId).toBeNull();
  });
});

describe("FR-CBT-06 definition-changed hook", () => {
  test("FR-CBT-06 hpMax follows (full → new max, else clamped); portrait copies follow", () => {
    const t = started();
    const by = t.byName(t.enc.id);
    // Elite token carries no image; give the combatant the portrait copy to test following.
    t.s.db.$client.run(
      `update combatant set image_asset_id = 'art-elite' where id = '${by["Elite Goblin Warrior"]?.id}'`,
    );
    t.run(UPDATE, {
      id: t.eliteId,
      name: "Elite Goblin Warrior",
      portraitAssetId: "art-mira",
      statBlock: { ...eliteBlock, hpMax: 9 },
    });
    const elite = t.byName(t.enc.id)["Elite Goblin Warrior"];
    expect(elite).toMatchObject({ hpMax: 9, hpCurrent: 9, imageAssetId: "art-mira" });
    const ev = t.events.at(-1)?.event;
    expect(ev?.type).toBe("EntityUpdated");
    expect(ev?.changes.some((c) => c.type === COMBATANT_TYPE && c.id === elite?.id)).toBe(true);
  });
});

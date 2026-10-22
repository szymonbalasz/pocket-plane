// TT2 roll requests in process (FR-DICEX-73–82, FR-NOTE-58–64, FR-CHARX-90, FR-DICE-79–80): send
// (targets, caps, prompts without a hidden DC), answer (built by the server: sheet bonuses and
// MOD parts via `sheetRoll`, custom with none; physical; audience; repeat), decline, close, roll
// for missing, lifecycle, the owner-change hook line, and `gem.spend` refusing an answer.
import { describe, expect, test } from "bun:test";
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import {
  OPEN_REQUESTS_MAX,
  ROLL_REQUEST_KIND,
  ROLL_REQUEST_TYPE,
  type RollRequestPromptPayload,
  type RollRequestRecord,
} from "@shared/dice-extras/requests";
import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import type { GameLogEntryRecord, RollPayloadItem } from "@shared/dice-roll-log/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { MAP_INTENTS } from "@shared/scenes-map/schemas";
import { asc, eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { gameLogEntry, notification, rollRequest } from "../../db/schema";
import type { Actor } from "../../events/types";
import { setFeature } from "../campaign-management/features";
import { charRoll, sheetRoll } from "../character-sheet/commands";
import { endCommand } from "../combat-tracker/lifecycle";
import { modSetup } from "../effect-modifiers/testing";
import { adjustGems, spendGem } from "../gems/commands";
import { answerRequest, closeRequest, declineRequest, request, rollForMissing } from "./requests";
import { toRequestRecord } from "./table-rows";

const PERCEPTION = { kind: "skill", key: "perception", expression: null } as const;

function setup() {
  const t = modSetup();
  const p1 = t.player(t.h.p1);
  const p2 = t.player(t.h.p2);
  const send = (o: Record<string, unknown> = {}, actor: Actor = t.h.dm) =>
    t.run<{ requestId: string }>(
      request.name,
      {
        roll: PERCEPTION,
        characterIds: [t.miraId, t.thornId],
        dc: 15,
        dcShown: false,
        mode: "normal",
        results: "hidden",
        ...o,
      },
      actor,
    ).requestId;
  const req = (id: string) =>
    toRequestRecord(
      t.s.db.select().from(rollRequest).where(eq(rollRequest.id, id)).get() as never,
    ) as RollRequestRecord;
  const target = (id: string, characterId: string) =>
    req(id).targets.find((x) => x.characterId === characterId) as RollRequestRecord["targets"][0];
  const answer = (id: string, characterId: string, actor: Actor, o: object = {}) =>
    t.run<{ rollId: string; entryId: string }>(
      answerRequest.name,
      { requestId: id, characterId, mode: "normal", ...o },
      actor,
    );
  const entry = (id: string) =>
    t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, id)).get() as GameLogEntryRecord;
  const items = (id: string) => entry(id).payload as RollPayloadItem[];
  const prompts = () =>
    t.s.db
      .select()
      .from(notification)
      .where(eq(notification.kind, ROLL_REQUEST_KIND))
      .orderBy(asc(notification.seq))
      .all() as NotificationRecord[];
  const prompt = (nid: string) => prompts().find((n) => n.id === nid) as NotificationRecord;
  return { ...t, p1, p2, send, req, target, answer, entry, items, prompts, prompt };
}

/** The bonus of a `1d20+N` / `2d20kh1+N` expression. */
const bonusOf = (expression: string) => Number(/([+-]\d+)$/.exec(expression)?.[1] ?? 0);

describe("TT2 roll requests (in process)", () => {
  test("FR-DICEX-74 request send: row + one prompt per target (owner, action Roll), NotificationCreated before RollRequested", () => {
    const t = setup();
    const before = t.events.length;
    const id = t.send({ label: "Spot the ambush" });
    const r = t.req(id);
    expect(r).toMatchObject({
      label: "Spot the ambush",
      dc: 15,
      dcShown: false,
      results: "hidden",
      state: "open",
      closedAt: null,
    });
    expect(r.targets.map((x) => [x.name, x.playerId, x.state])).toEqual([
      ["Mira", t.h.p1.id, "open"],
      ["Thorn", t.h.p2.id, "open"],
    ]);
    const ps = t.prompts();
    expect(
      ps.map((n) => [n.audience, n.audiencePlayerId, n.actionLabel, n.actionPlayerId]),
    ).toEqual([
      ["player", t.h.p1.id, "Roll", t.h.p1.id],
      ["player", t.h.p2.id, "Roll", t.h.p2.id],
    ]);
    expect(r.targets.map((x) => x.notificationId)).toEqual(ps.map((n) => n.id));
    expect(t.events.slice(before).map((e) => e.event.type)).toEqual([
      "NotificationCreated",
      "NotificationCreated",
      "RollRequested",
    ]);
    // Default label; players can't send; ≤ 5 open.
    expect(t.req(t.send()).label).toBe("Perception");
    expect(t.err(() => t.send({}, t.p1)).code).toBe("forbidden");
    for (let i = 2; i < OPEN_REQUESTS_MAX; i++) t.send();
    expect(t.err(() => t.send()).code).toBe("conflict");
  });

  test("FR-DICEX-75 request targets: owned, not hidden PCs only; anything else → invalid, nothing written", () => {
    const t = setup();
    const n = t.prompts().length;
    expect(t.err(() => t.send({ characterIds: [t.h.goblinId] })).code).toBe("invalid");
    expect(t.err(() => t.send({ characterIds: [t.miraId, "nope"] })).code).toBe("invalid");
    expect(t.err(() => t.send({ characterIds: [t.miraId, t.miraId] })).code).toBe("invalid");
    // Thorn hidden from players in the fight (#141).
    t.run(MAP_INTENTS.setTokenHidden, { tokenId: t.tokens.thorn, hidden: true });
    expect(t.err(() => t.send()).code).toBe("invalid");
    expect([t.prompts().length, t.s.db.select().from(rollRequest).all().length]).toEqual([n, 0]);
    expect(t.req(t.send({ characterIds: [t.miraId] })).targets).toHaveLength(1);
  });

  test("FR-DICEX-77 DC never leaks: prompts carry the DC only when shown; never success; no player key", () => {
    const t = setup();
    const hidden = t.send();
    const shown = t.send({ dcShown: true, roll: { kind: "save", key: "dex", expression: null } });
    const payload = (nid: string) => t.prompt(nid).payload as RollRequestPromptPayload;
    const h = t.req(hidden).targets[0]?.notificationId as string;
    const s = t.req(shown).targets[0]?.notificationId as string;
    expect([payload(h).dc, t.prompt(h).text]).toEqual([null, "DM: Perception"]);
    expect([payload(s).dc, t.prompt(s).text]).toEqual([15, "DM: DEX save · DC 15"]);
    for (const n of t.prompts()) {
      expect(JSON.stringify(n.payload)).not.toMatch(/success|results/);
    }
    for (const p of [t.h.p1.id, t.h.p2.id]) {
      expect(Object.keys(t.h.snapshot(t.h.viewer("player", p)))).not.toContain(ROLL_REQUEST_TYPE);
    }
    expect(t.h.snapshot(t.h.viewer("dm"))[ROLL_REQUEST_TYPE]).toHaveLength(2);
  });

  test("FR-DICEX-78 FR-DICEX-76 FR-NOTE-62 answer: sheet bonus, physical, mode changed by the roller, hidden audience = the target's player, answer marker, resolved by the roller, repeat conflict", () => {
    const t = setup();
    const id = t.send();
    // Another player's target → not_found (never forbidden); unknown request → not_found.
    expect(t.err(() => t.answer(id, t.thornId, t.p1)).code).toBe("not_found");
    expect(t.err(() => t.answer("nope", t.miraId, t.p1)).code).toBe("not_found");
    const r = t.answer(id, t.miraId, t.p1, { manual: { diceTotal: 11 } });
    const e = t.entry(r.entryId);
    const [item] = t.items(r.entryId);
    expect(e).toMatchObject({
      kind: ROLL_KIND,
      category: "skill-check",
      actorName: "Mira",
      public: false,
      audiencePlayerId: t.h.p1.id,
    });
    expect(item).toMatchObject({ label: "Perception", answer: true });
    const total = 11 + bonusOf(item?.expression ?? "");
    expect(item?.total).toBe(total);
    expect(t.target(id, t.miraId)).toMatchObject({
      state: "rolled",
      entryId: r.entryId,
      total,
      natural: 11,
      success: total >= 15,
    });
    // The prompt is resolved by its owner with the total; a repeat → conflict.
    const nid = t.target(id, t.miraId).notificationId;
    expect(t.prompt(nid)).toMatchObject({
      state: "resolved",
      resolution: { outcome: "rolled", total },
      closedByRole: "player",
    });
    expect(t.err(() => t.answer(id, t.miraId, t.p1)).code).toBe("conflict");
    expect(t.events.at(-2)?.event.type).toBe("RollRequestAnswered");
    // The DM may answer for Thorn: still the target's player's audience.
    const d = t.answer(id, t.thornId, t.h.dm, { mode: "advantage" });
    expect(t.entry(d.entryId)).toMatchObject({ public: false, audiencePlayerId: t.h.p2.id });
    expect(t.items(d.entryId)[0]?.expression).toMatch(/^2d20kh1/);
  });

  test("FR-DICEX-78 answer: Bless part on a save via sheetRoll; custom gets no sheet bonuses or hooks; public for all", () => {
    const t = setup();
    t.bless();
    const save = t.send({
      roll: { kind: "save", key: "wis", expression: null },
      results: "public",
    });
    const a = t.answer(save, t.miraId, t.p1, { manual: { diceTotal: 9 } });
    const [item] = t.items(a.entryId);
    expect(t.entry(a.entryId)).toMatchObject({ public: true, audiencePlayerId: null });
    expect(item?.mods?.map((p) => p.label)).toEqual(["Bless"]);
    expect(t.target(save, t.miraId).total).toBe(item?.total ?? -1);
    const custom = t.send({
      roll: { kind: "custom", key: null, expression: "1d20" },
      results: "public",
    });
    const c = t.answer(custom, t.miraId, t.p1, { manual: { diceTotal: 7 } });
    const [ci] = t.items(c.entryId);
    expect(t.entry(c.entryId)).toMatchObject({ category: "other", public: true });
    expect([ci?.expression, ci?.total, ci?.mods, ci?.answer]).toEqual(["1d20", 7, undefined, true]);
    expect(t.target(custom, t.miraId)).toMatchObject({ total: 7, natural: 7, success: false });
  });

  test("FR-DICEX-78 answer not rerollable: gem.spend on an answer entry → conflict with the reason", () => {
    const t = setup();
    t.run(setFeature.name, { feature: GEMS_FEATURE, on: true });
    t.run(adjustGems.name, { characterId: t.miraId, gem: "inspiration", delta: 1 });
    const id = t.send({ results: "public" });
    const r = t.answer(id, t.miraId, t.p1, { manual: { diceTotal: 3 } });
    const e = t.err(() =>
      t.run(
        spendGem.name,
        { characterId: t.miraId, gem: "inspiration", entryId: r.entryId },
        t.p1,
        "tt2-spend",
      ),
    );
    expect([e.code, e.message]).toEqual(["conflict", "A requested roll can't be rerolled"]);
  });

  test("FR-DICEX-79 decline: target declined, prompt resolved; FR-DICEX-82 all done → closed", () => {
    const t = setup();
    const id = t.send();
    t.run(declineRequest.name, { requestId: id, characterId: t.thornId }, t.p2);
    expect(t.target(id, t.thornId).state).toBe("declined");
    expect(t.prompt(t.target(id, t.thornId).notificationId)).toMatchObject({
      state: "resolved",
      resolution: { outcome: "declined" },
    });
    expect(t.events.at(-2)?.event.type).toBe("RollRequestDeclined");
    expect(t.req(id).state).toBe("open");
    expect(
      t.err(() => t.run(declineRequest.name, { requestId: id, characterId: t.thornId }, t.p2)).code,
    ).toBe("conflict");
    t.answer(id, t.miraId, t.p1);
    expect(t.req(id).state).toBe("closed");
    expect(t.err(() => t.answer(id, t.miraId, t.p1)).code).toBe("conflict");
  });

  test("FR-DICEX-80 FR-NOTE-62 close: open targets missed, prompts closed by rule; players can't close", () => {
    const t = setup();
    const id = t.send();
    t.answer(id, t.miraId, t.p1);
    expect(t.err(() => t.run(closeRequest.name, { requestId: id }, t.p1)).code).toBe("forbidden");
    t.run(closeRequest.name, { requestId: id });
    const r = t.req(id);
    expect([r.state, r.targets.map((x) => x.state)]).toEqual(["closed", ["rolled", "missed"]]);
    expect(t.prompt(t.target(id, t.thornId).notificationId)).toMatchObject({
      state: "resolved",
      resolution: { outcome: "missed" },
      closedByRole: null,
    });
    expect(t.err(() => t.run(closeRequest.name, { requestId: id })).code).toBe("conflict");
  });

  test("FR-DICEX-81 roll for missing: DM rolls open targets (hidden → the current owner), then closes", () => {
    const t = setup();
    const id = t.send();
    t.answer(id, t.miraId, t.p1);
    const out = t.run<{ entryIds: string[] }>(rollForMissing.name, { requestId: id });
    expect(out.entryIds).toHaveLength(1);
    const e = t.entry(out.entryIds[0] as string);
    expect(e).toMatchObject({
      rollerRole: "dm",
      actorName: "Thorn",
      public: false,
      audiencePlayerId: t.h.p2.id,
    });
    expect(t.items(e.id)[0]?.answer).toBe(true);
    const r = t.req(id);
    expect([r.state, r.targets.map((x) => x.state)]).toEqual(["closed", ["rolled", "rolled"]]);
    expect(t.events.at(-2)?.event).toMatchObject({
      type: "RollRequestClosed",
      payload: { requestId: id, rolled: out.entryIds },
    });
    const p = t.prompt(t.target(id, t.thornId).notificationId);
    expect(p).toMatchObject({ state: "resolved", closedByRole: null });
    expect(p.resolution).toEqual({ outcome: "rolled", total: t.target(id, t.thornId).total });
    // Public request: the DM's rolls are public.
    const pub = t.send({ results: "public", characterIds: [t.thornId] });
    const o2 = t.run<{ entryIds: string[] }>(rollForMissing.name, { requestId: pub });
    expect(t.entry(o2.entryIds[0] as string)).toMatchObject({ public: true });
  });

  test("FR-DICEX-82 lifecycle: no timer; End leaves it open", () => {
    const t = setup();
    const id = t.send();
    t.run(endCommand.name, { encounterId: t.enc.id });
    expect(t.req(id).state).toBe("open");
    expect(t.prompts().every((n) => n.state === "pending")).toBe(true);
  });

  test("FR-DICEX-65 owner change closes targets: open → missed, prompts resolved, new owner gets nothing", () => {
    const t = setup();
    const id = t.send();
    const only = t.send({ characterIds: [t.thornId] });
    t.answer(id, t.miraId, t.p1);
    const before = t.prompts().length;
    t.run("char.edit", { creatureId: t.thornId, set: { ownerPlayerId: t.h.p1.id } });
    expect(t.req(id)).toMatchObject({ state: "closed" });
    expect(t.req(only)).toMatchObject({ state: "closed" });
    expect(t.target(id, t.thornId).state).toBe("missed");
    for (const r of [id, only]) {
      expect(t.prompt(t.target(r, t.thornId).notificationId)).toMatchObject({
        state: "resolved",
        resolution: { outcome: "missed" },
        audiencePlayerId: t.h.p2.id,
      });
    }
    expect(t.prompts().length).toBe(before);
    // The resolves ride on EntityUpdated (hooks never emit).
    const types = t.events.at(-1)?.event.changes.map((c) => c.type);
    expect(types).toEqual(expect.arrayContaining(["entity", ROLL_REQUEST_TYPE, "notification"]));
  });

  test("FR-CHARX-90 sheet roll helper: char.roll unchanged; sheetRoll takes audience, label, answer", () => {
    const t = setup();
    const helper = defineCommand({
      name: "test.sheetRoll",
      roles: ["dm", "player"],
      input: charRoll.input,
      execute(input, env: CommandEnv) {
        return sheetRoll(env, input, {
          audience: { public: false, audiencePlayerId: t.h.p2.id },
          label: "Asked",
          answer: true,
        }).change.id;
      },
    });
    t.s.commands.register(helper);
    const input = {
      characterId: t.miraId,
      kind: "skill",
      skill: "perception",
      manual: [{ diceTotal: 10 }],
    };
    const plain = t.run<{ entryId: string }>(charRoll.name, input, t.p1);
    expect(t.entry(plain.entryId)).toMatchObject({ public: true, audiencePlayerId: null });
    expect(t.items(plain.entryId)[0]?.answer).toBeUndefined();
    expect(t.events.at(-1)?.event.type).toBe("CharacterRolled");
    const n = t.events.length;
    const id = t.run<string>(helper.name, input, t.p1);
    expect(t.events.length).toBe(n);
    expect(t.entry(id)).toMatchObject({ public: false, audiencePlayerId: t.h.p2.id });
    expect(t.items(id)[0]).toMatchObject({ label: "Asked", answer: true });
    expect(t.items(id)[0]?.total).toBe(t.items(plain.entryId)[0]?.total ?? -1);
  });
});

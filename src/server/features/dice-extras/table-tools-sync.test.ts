// TT0 over real sockets on `dice-log` (DM, Player 1 with Mira, Player 2 with Thorn): the 9 sprint-8
// events through the hub's visibility filter. The commands are TT1–TT4, so test-only commands write
// the rows and emit the events as those will (row + event in one transaction, prompts through
// `notify`, answers through `gameLog.append`'s `audience`). Players get no frame for
// `RollRequested` (FR-SYNC-17), only their own prompt, their own macros, the hidden answer only
// for the target's player; leak scans per player before and after a reconnect (FR-DICEX-92).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { AUDIO_ASSET_TYPE } from "@shared/assets-pipeline/audio";
import type { CampaignRecord } from "@shared/campaign-management/schemas";
import { ROLL_MACRO_TYPE, type RollMacroRecord } from "@shared/dice-extras/macros";
import {
  promptText,
  type RequestTarget,
  ROLL_REQUEST_KIND,
  ROLL_REQUEST_TYPE,
  type RollRequestRecord,
} from "@shared/dice-extras/requests";
import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import { AssetIngested } from "@shared/events/assets-pipeline";
import { AlertSoundSet, CampaignPaused, CampaignResumed } from "@shared/events/campaign-management";
import {
  MacroDeleted,
  MacroSaved,
  RollRequestAnswered,
  RollRequestClosed,
  RollRequested,
} from "@shared/events/dice-extras";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { Credential, ServerFrame } from "@shared/protocol/frames";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { asset, campaign, entity, player, rollMacro, rollRequest } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";
import { assetUpsert } from "../assets-pipeline/records";
import { toCampaignRecord } from "../campaign-management/records";
import { evaluate, rollPayloadItem } from "../dice-roll-log/evaluate";
import { append } from "../dice-roll-log/game-log";
import { notify, resolveNotification } from "../notifications/helpers";
import { readMacro, readRequest, toRequestRecord } from "./table-rows";

const DM: Credential = { role: "dm", secret: TEST_SECRET };
/** Strings that must never reach a player frame (or only the named one's). */
const DM_ONLY_MACRO = "AMBUSH-DM-ONLY";
const P2_MACRO = "INSPIRATION-FOR-P2";
const SECRET_LABEL = "SECRET-PERCEPTION";
const SOUND_ID = "sndsndsndsndsndsndsnd1";

const Id = z.string();

const cid = (env: CommandEnv) => env.actor.campaignId as string;

/** `dicex.saveMacro` as TT1 will: row + `MacroSaved` (one upsert). */
const saveMacro = defineCommand({
  name: "test.ttSaveMacro",
  input: z.strictObject({ id: Id, name: z.string(), playerId: Id.nullable() }),
  execute({ id, name, playerId }, env) {
    env.tx
      .insert(rollMacro)
      .values({
        id,
        campaignId: cid(env),
        playerId,
        creatureId: null,
        name,
        expression: "1d8",
        category: "other",
        order: 0,
        createdBy: null,
        updatedAt: env.ctx.clock.iso(),
      })
      .run();
    env.emit({
      type: MacroSaved.type,
      campaignId: cid(env),
      payload: { macroId: id },
      changes: [
        { type: ROLL_MACRO_TYPE, id, before: null, after: readMacro(env.tx, cid(env), id) },
      ],
    });
  },
});

const deleteMacro = defineCommand({
  name: "test.ttDeleteMacro",
  input: z.strictObject({ id: Id }),
  execute({ id }, env) {
    const before = readMacro(env.tx, cid(env), id);
    env.tx.delete(rollMacro).where(eq(rollMacro.id, id)).run();
    env.emit({
      type: MacroDeleted.type,
      campaignId: cid(env),
      payload: { macroId: id },
      changes: [{ type: ROLL_MACRO_TYPE, id, before, after: null }],
    });
  },
});

type Who = { characterId: string; playerId: string; name: string };

/** `dicex.request` as TT2 will: row + prompts (DC only when shown) + `RollRequested`. */
const sendRequest = defineCommand({
  name: "test.ttRequest",
  input: z.strictObject({
    id: Id,
    label: z.string(),
    results: z.enum(["public", "hidden"]),
    targets: z.array(z.strictObject({ characterId: Id, playerId: Id, name: z.string() })),
  }),
  execute({ id, label, results, targets }, env) {
    const roll = { kind: "skill" as const, key: "perception" as const, expression: null };
    const prompts = (targets as Who[]).map((t): RequestTarget => {
      const notificationId = notify(env, {
        kind: ROLL_REQUEST_KIND,
        audience: "player",
        audiencePlayerId: t.playerId,
        text: promptText(label, null),
        payload: {
          requestId: id,
          characterId: t.characterId,
          characterName: t.name,
          roll,
          label,
          dc: null,
          mode: "normal",
        },
        action: { label: "Roll", role: "player", playerId: t.playerId },
      });
      return {
        ...t,
        notificationId,
        state: "open",
        entryId: null,
        total: null,
        natural: null,
        success: null,
        at: null,
      };
    });
    const row = env.tx
      .insert(rollRequest)
      .values({
        id,
        campaignId: cid(env),
        seq: 1 + (env.tx.select().from(rollRequest).all().length ?? 0),
        roll,
        label,
        dc: 15,
        dcShown: false,
        mode: "normal",
        results,
        state: "open",
        targets: prompts,
        createdAt: env.ctx.clock.iso(),
        closedAt: null,
      })
      .returning()
      .get();
    env.emit({
      type: RollRequested.type,
      campaignId: cid(env),
      payload: { requestId: id },
      changes: [{ type: ROLL_REQUEST_TYPE, id, before: null, after: toRequestRecord(row) }],
    });
  },
});

/** Writes the answer line for a target (audience from the request) and marks it `state`. */
function rollTarget(env: CommandEnv, req: RollRequestRecord, t: RequestTarget) {
  const r = evaluate(env, {
    expression: "1d20+3",
    mode: "normal",
    category: "skill-check",
    label: req.label,
    actor: { kind: "entity", id: t.characterId, name: t.name },
    source: "dice",
  });
  const entry = append(env, {
    kind: ROLL_KIND,
    category: "skill-check",
    actorName: t.name,
    payload: [{ ...rollPayloadItem(r), answer: true }],
    rollIds: [r.id],
    audience:
      req.results === "public" ? { public: true } : { public: false, audiencePlayerId: t.playerId },
  });
  const target: RequestTarget = {
    ...t,
    state: "rolled",
    entryId: entry.id,
    total: r.total,
    natural: r.natural,
    success: r.total >= (req.dc ?? 0),
    at: env.ctx.clock.iso(),
  };
  return { entry, target, total: r.total };
}

function writeTargets(
  env: CommandEnv,
  req: RollRequestRecord,
  targets: RequestTarget[],
  closed: boolean,
) {
  env.tx
    .update(rollRequest)
    .set({
      targets,
      state: closed ? "closed" : "open",
      closedAt: closed ? env.ctx.clock.iso() : null,
    })
    .where(eq(rollRequest.id, req.id))
    .run();
  return readRequest(env.tx, cid(env), req.id);
}

/** `dicex.answerRequest` as TT2 will (by the target's player or the DM). */
const answer = defineCommand({
  name: "test.ttAnswer",
  roles: ["dm", "player"],
  input: z.strictObject({ requestId: Id, characterId: Id }),
  execute({ requestId, characterId }, env) {
    const req = readRequest(env.tx, cid(env), requestId) as RollRequestRecord;
    const t = req.targets.find((x) => x.characterId === characterId) as RequestTarget;
    const { entry, target, total } = rollTarget(env, req, t);
    const targets = req.targets.map((x) => (x.characterId === characterId ? target : x));
    const after = writeTargets(
      env,
      req,
      targets,
      targets.every((x) => x.state !== "open"),
    );
    env.emit({
      type: RollRequestAnswered.type,
      campaignId: cid(env),
      payload: { requestId, characterId, entryId: entry.id },
      changes: [entry, { type: ROLL_REQUEST_TYPE, id: requestId, before: req, after }],
    });
    resolveNotification(env, t.notificationId, { outcome: "rolled", total });
    return entry.id;
  },
});

/** `dicex.rollForMissing` as TT2 will: rolls open targets as the DM, closes. */
const rollForMissing = defineCommand({
  name: "test.ttRollForMissing",
  input: z.strictObject({ requestId: Id }),
  execute({ requestId }, env) {
    const req = readRequest(env.tx, cid(env), requestId) as RollRequestRecord;
    const rolled = req.targets
      .filter((t) => t.state === "open")
      .map((t) => ({ t, ...rollTarget(env, req, t) }));
    const targets = req.targets.map(
      (x) => rolled.find((r) => r.t.characterId === x.characterId)?.target ?? x,
    );
    const after = writeTargets(env, req, targets, true);
    env.emit({
      type: RollRequestClosed.type,
      campaignId: cid(env),
      payload: { requestId, rolled: rolled.map((r) => r.entry.id) },
      changes: [
        ...rolled.map((r) => r.entry),
        { type: ROLL_REQUEST_TYPE, id: requestId, before: req, after },
      ],
    });
    for (const r of rolled) {
      resolveNotification(
        env,
        r.t.notificationId,
        { outcome: "rolled", total: r.total },
        { byRule: true },
      );
    }
  },
});

/** `camp.pause` / `camp.resume` / `camp.setAlertSound` as TT3 / TT4 will (campaign upsert). */
const campaignState = defineCommand({
  name: "test.ttCampaign",
  input: z.strictObject({ op: z.enum(["pause", "resume", "sound"]) }),
  execute({ op }, env) {
    const id = cid(env);
    const before = env.tx.select().from(campaign).where(eq(campaign.id, id)).get();
    if (!before) throw new Error("no campaign");
    const set =
      op === "pause"
        ? {
            pause: {
              message: "Pizza break",
              imageAssetId: null,
              backAt: null,
              startedAt: env.ctx.clock.iso(),
            },
          }
        : op === "resume"
          ? { pause: null }
          : { alertSounds: { ...before.alertSounds, request: SOUND_ID } };
    env.tx.update(campaign).set(set).where(eq(campaign.id, id)).run();
    const after = env.tx.select().from(campaign).where(eq(campaign.id, id)).get();
    if (!after) throw new Error("no campaign");
    env.emit({
      type:
        op === "pause"
          ? CampaignPaused.type
          : op === "resume"
            ? CampaignResumed.type
            : AlertSoundSet.type,
      campaignId: id,
      payload: op === "sound" ? { alert: "request" } : { campaignId: id },
      changes: [
        { type: "campaign", id, before: toCampaignRecord(before), after: toCampaignRecord(after) },
      ],
    });
  },
});

/** A sound added to the library (TT3's upload): `asset` row of kind audio → `audio-asset` upsert. */
const addSound = defineCommand({
  name: "test.ttAddSound",
  input: z.strictObject({}),
  execute(_input, env) {
    const row = env.tx
      .insert(asset)
      .values({
        id: SOUND_ID,
        campaignId: cid(env),
        seq: 9_000,
        name: "Chime",
        hash: "chime-hash",
        mime: "audio/wav",
        bytes: 17_684,
        width: 0,
        height: 0,
        displayWidth: 0,
        displayHeight: 0,
        createdAt: env.ctx.clock.iso(),
        tags: [],
        kind: "audio",
        durationMs: 400,
      })
      .returning()
      .get();
    env.emit({
      type: AssetIngested.type,
      campaignId: cid(env),
      payload: { assetId: row.id, hash: row.hash, bytes: row.bytes, listed: true, tags: [] },
      changes: assetUpsert(row),
    });
  },
});

const TEST_COMMANDS = [
  saveMacro,
  deleteMacro,
  sendRequest,
  answer,
  rollForMissing,
  campaignState,
  addSound,
];

type EventFrame = Extract<ServerFrame, { type: "event" }>;
const eventsOf = (c: TestClient, name: string, from = 0) =>
  c.frames.slice(from).filter((f): f is EventFrame => f.type === "event" && f.cause.name === name);
const changeTypes = (frames: EventFrame[]) => frames.flatMap((f) => f.changes.map((ch) => ch.type));
async function until(pred: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("condition not reached in time");
    await Bun.sleep(10);
  }
}
async function reply(c: TestClient, intentId: string) {
  for (;;) {
    const f = await c.next(undefined, 3000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}

describe("TT0 table-tools events over sockets (dice-log)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let p1Id: string;
  let p2Id: string;
  let mira: Who;
  let thorn: Who;
  let dm: TestClient;
  let p1: TestClient;
  let p2: TestClient;
  const cred = (name: string): Credential => ({ role: "player", token: links[name] as string });
  const run = (def: (typeof TEST_COMMANDS)[number], input: unknown, as: "dm" | string = "dm") =>
    h.s.commands.run(def.name, input, {
      actor:
        as === "dm"
          ? { role: "dm", playerId: null, campaignId: activeId() }
          : { role: "player", playerId: as, campaignId: activeId() },
    });
  const activeId = () =>
    db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
  /** Every player frame and its stored records: no DM-only table-tools data. */
  const expectClean = (c: TestClient, label: string, also: string[] = []) => {
    const raw = c.raw();
    const forbidden = [
      DM_ONLY_MACRO,
      `"type":"${ROLL_REQUEST_TYPE}"`,
      `"${AUDIO_ASSET_TYPE}"`,
      '"success"',
      '"dc":15',
      ...also,
    ];
    expect([label, forbidden.filter((s) => raw.includes(s))]).toEqual([label, []]);
    expect([label, leakScan(h.s, c)]).toEqual([label, []]);
  };

  beforeAll(async () => {
    const loaded = await loadBundle("dice-log", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    const players = db.select().from(player).where(eq(player.campaignId, activeId())).all();
    links = Object.fromEntries(players.map((r) => [r.name, r.linkToken]));
    p1Id = players.find((p) => p.name === "Player 1")?.id as string;
    p2Id = players.find((p) => p.name === "Player 2")?.id as string;
    const pc = (name: string): Who => {
      const e = db
        .select()
        .from(entity)
        .where(and(eq(entity.campaignId, activeId()), eq(entity.name, name)))
        .get();
      if (!e?.ownerPlayerId) throw new Error(`no PC ${name}`);
      return { characterId: e.id, playerId: e.ownerPlayerId, name };
    };
    mira = pc("Mira");
    thorn = pc("Thorn");
    expect([mira.playerId, thorn.playerId]).toEqual([p1Id, p2Id]);
    h = await startTestServer({ db, fake: false, testMode: true });
    for (const c of TEST_COMMANDS) h.s.commands.register(c);
    dm = await h.live(DM);
    p1 = await h.live(cred("Player 1"));
    p2 = await h.live(cred("Player 2"));
  });

  afterAll(async () => {
    await h.stop();
    closeDb(db);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  });

  test("FR-DICEX-67 macros: MacroSaved / MacroDeleted reach the DM and only the player with playerId = them", async () => {
    const [d0, a0, b0] = [dm.frames.length, p1.frames.length, p2.frames.length];
    run(saveMacro, { id: "m-dm-only", name: DM_ONLY_MACRO, playerId: null });
    run(saveMacro, { id: "m-p2", name: P2_MACRO, playerId: p2Id });
    run(saveMacro, { id: "m-p1", name: "Luck", playerId: p1Id });
    await until(() => eventsOf(dm, MacroSaved.type, d0).length === 3);
    await until(() => eventsOf(p1, MacroSaved.type, a0).length === 1);
    await until(() => eventsOf(p2, MacroSaved.type, b0).length === 1);
    run(deleteMacro, { id: "m-p2" });
    await until(() => eventsOf(p2, MacroDeleted.type, b0).length === 1);
    await until(() => eventsOf(dm, MacroDeleted.type, d0).length === 1);
    // Player 1 saw neither the DM-only row nor P2's, nor the delete (no frame at all).
    await p1.expectNoFrame(150);
    expect(eventsOf(p1, MacroDeleted.type, a0)).toHaveLength(0);
    expect(Object.keys(p1.store.records[ROLL_MACRO_TYPE] ?? {})).toEqual(["m-p1"]);
    expect(Object.keys(p2.store.records[ROLL_MACRO_TYPE] ?? {})).toEqual([]);
    const dmRows = Object.values(dm.store.records[ROLL_MACRO_TYPE] ?? {}) as RollMacroRecord[];
    expect(dmRows.map((m) => m.id).sort()).toEqual(["m-dm-only", "m-p1"]);
    expectClean(p1, "p1 macros", [P2_MACRO]);
    expectClean(p2, "p2 macros");
  });

  test("FR-SYNC-17 FR-DICEX-74 RollRequested: DM gets the request; players no frame for it, each only their own prompt (no DC)", async () => {
    const [d0, a0, b0] = [dm.frames.length, p1.frames.length, p2.frames.length];
    run(sendRequest, {
      id: "req-hidden",
      label: SECRET_LABEL,
      results: "hidden",
      targets: [mira, thorn],
    });
    await until(() => eventsOf(dm, RollRequested.type, d0).length === 1);
    await until(() => eventsOf(p1, "NotificationCreated", a0).length === 1);
    await until(() => eventsOf(p2, "NotificationCreated", b0).length === 1);
    expect(changeTypes(eventsOf(dm, RollRequested.type, d0))).toEqual([ROLL_REQUEST_TYPE]);
    expect(eventsOf(dm, "NotificationCreated", d0)).toHaveLength(2);
    for (const [c, from, who] of [
      [p1, a0, mira],
      [p2, b0, thorn],
    ] as const) {
      expect(eventsOf(c, RollRequested.type, from)).toHaveLength(0);
      const prompts = Object.values(c.store.records.notification ?? {}) as NotificationRecord[];
      const mine = prompts.filter((n) => n.kind === ROLL_REQUEST_KIND);
      expect(mine).toHaveLength(1);
      expect(mine[0]?.audiencePlayerId).toBe(who.playerId);
      expect(mine[0]?.payload).toMatchObject({ characterId: who.characterId, dc: null });
      expect(mine[0]?.text).toBe(`DM: ${SECRET_LABEL}`);
    }
    const req = dm.store.records[ROLL_REQUEST_TYPE]?.["req-hidden"] as RollRequestRecord;
    expect([req.dc, req.targets.map((t) => t.state)]).toEqual([15, ["open", "open"]]);
    expectClean(p1, "p1 request");
    expectClean(p2, "p2 request");
  });

  test("FR-DICEX-77 FR-DICEX-84 hidden answer: DM + the target's player only; the other player gets no frame", async () => {
    const [d0, a0, b0] = [dm.frames.length, p1.frames.length, p2.frames.length];
    const entryId = run(
      answer,
      { requestId: "req-hidden", characterId: mira.characterId },
      p1Id,
    ) as string;
    await until(() => eventsOf(dm, RollRequestAnswered.type, d0).length === 1);
    await until(() => eventsOf(p1, RollRequestAnswered.type, a0).length === 1);
    await until(() => eventsOf(p1, "NotificationResolved", a0).length === 1);
    expect(changeTypes(eventsOf(dm, RollRequestAnswered.type, d0)).sort()).toEqual(
      ["game-log-entry", ROLL_REQUEST_TYPE].sort(),
    );
    expect(changeTypes(eventsOf(p1, RollRequestAnswered.type, a0))).toEqual(["game-log-entry"]);
    const entry = p1.store.records["game-log-entry"]?.[entryId] as {
      public: boolean;
      audiencePlayerId: string;
    };
    expect([entry.public, entry.audiencePlayerId]).toEqual([false, p1Id]);
    await p2.expectNoFrame(200);
    expect(p2.frames.length).toBe(b0);
    expect(p2.raw()).not.toContain(entryId);
    const req = dm.store.records[ROLL_REQUEST_TYPE]?.["req-hidden"] as RollRequestRecord;
    expect(req.targets.map((t) => t.state)).toEqual(["rolled", "open"]);
    expect(typeof req.targets[0]?.success).toBe("boolean");
    expectClean(p1, "p1 answer");
    expectClean(p2, "p2 answer");
  });

  test("FR-DICEX-81 roll for missing on a hidden request: Thorn's line to Player 2 only; RollRequestClosed; prompt resolved by rule", async () => {
    const [d0, a0, b0] = [dm.frames.length, p1.frames.length, p2.frames.length];
    run(rollForMissing, { requestId: "req-hidden" });
    await until(() => eventsOf(dm, RollRequestClosed.type, d0).length === 1);
    await until(() => eventsOf(p2, "NotificationResolved", b0).length === 1);
    await until(() => eventsOf(p2, RollRequestClosed.type, b0).length === 1);
    expect(changeTypes(eventsOf(p2, RollRequestClosed.type, b0))).toEqual(["game-log-entry"]);
    await p1.expectNoFrame(200);
    expect(p1.frames.length).toBe(a0);
    const req = dm.store.records[ROLL_REQUEST_TYPE]?.["req-hidden"] as RollRequestRecord;
    expect([req.state, req.targets.map((t) => t.state)]).toEqual(["closed", ["rolled", "rolled"]]);
    const thornEntry = req.targets[1]?.entryId as string;
    expect(p1.raw()).not.toContain(thornEntry);
    expectClean(p1, "p1 missing");
    expectClean(p2, "p2 missing");
  });

  test("FR-DICEX-77 public request: the DM's roll for missing is public; every player gets the line", async () => {
    run(sendRequest, {
      id: "req-public",
      label: "DEX save",
      results: "public",
      targets: [mira, thorn],
    });
    const [a0, b0] = [p1.frames.length, p2.frames.length];
    run(rollForMissing, { requestId: "req-public" });
    for (const [c, from] of [
      [p1, a0],
      [p2, b0],
    ] as const) {
      await until(() => eventsOf(c, RollRequestClosed.type, from).length === 1);
      expect(changeTypes(eventsOf(c, RollRequestClosed.type, from))).toEqual([
        "game-log-entry",
        "game-log-entry",
      ]);
    }
    expectClean(p1, "p1 public");
    expectClean(p2, "p2 public");
  });

  test("FR-CAMP-47 FR-CAMP-48 CampaignPaused / AlertSoundSet / CampaignResumed: campaign upsert to every connection", async () => {
    const froms = [dm, p1, p2].map((c) => c.frames.length);
    run(campaignState, { op: "pause" });
    run(campaignState, { op: "sound" });
    for (const [i, c] of [dm, p1, p2].entries()) {
      await until(() => eventsOf(c, AlertSoundSet.type, froms[i]).length === 1);
      expect(eventsOf(c, CampaignPaused.type, froms[i])).toHaveLength(1);
      const camp = Object.values(c.store.records.campaign ?? {})[0] as CampaignRecord;
      expect(camp.pause?.message).toBe("Pizza break");
      expect(camp.alertSounds).toEqual({ request: SOUND_ID });
    }
    run(campaignState, { op: "resume" });
    for (const [i, c] of [dm, p1, p2].entries()) {
      await until(() => eventsOf(c, CampaignResumed.type, froms[i]).length === 1);
      const camp = Object.values(c.store.records.campaign ?? {})[0] as CampaignRecord;
      expect(camp.pause).toBeUndefined();
      expect(camp.alertSounds).toEqual({ request: SOUND_ID });
    }
  });

  test("FR-ASSET-57 a new sound: audio-asset upsert to the DM only; DM sync.load lists it, a player's → forbidden", async () => {
    const [d0, a0, b0] = [dm.frames.length, p1.frames.length, p2.frames.length];
    run(addSound, {});
    await until(() => eventsOf(dm, AssetIngested.type, d0).length === 1);
    expect(changeTypes(eventsOf(dm, AssetIngested.type, d0))).toEqual([AUDIO_ASSET_TYPE]);
    await p1.expectNoFrame(150);
    expect([p1.frames.length, p2.frames.length]).toEqual([a0, b0]);
    const ok = await reply(dm, dm.load(AUDIO_ASSET_TYPE));
    expect(ok.type).toBe("ack");
    expect(Object.keys(dm.store.records[AUDIO_ASSET_TYPE] ?? {})).toEqual([SOUND_ID]);
    const no = await reply(p1, p1.load(AUDIO_ASSET_TYPE));
    expect(no.type === "reject" ? no.code : no.type).toBe("forbidden");
  });

  test("FR-DICEX-92 reconnect: fresh snapshots clean per player and converged; the DM keeps both requests", async () => {
    for (const c of [p1, p2]) c.close();
    p1 = await h.live(cred("Player 1"));
    p2 = await h.live(cred("Player 2"));
    const dm2 = await h.live(DM);
    for (const c of [p1, p2]) {
      const snap = [...c.frames].reverse().find((f) => f.type === "snapshot");
      if (snap?.type !== "snapshot") throw new Error("no snapshot");
      expect(Object.keys(snap.records)).not.toContain(ROLL_REQUEST_TYPE);
      expect(Object.keys(snap.records)).not.toContain(AUDIO_ASSET_TYPE);
    }
    expect(Object.keys(p1.store.records[ROLL_MACRO_TYPE] ?? {})).toEqual(["m-p1"]);
    expect(Object.keys(p2.store.records[ROLL_MACRO_TYPE] ?? {})).toEqual([]);
    expectClean(p1, "p1 reconnect", [P2_MACRO]);
    expectClean(p2, "p2 reconnect");
    expect(Object.keys(dm2.store.records[ROLL_REQUEST_TYPE] ?? {}).sort()).toEqual([
      "req-hidden",
      "req-public",
    ]);
    // The live DM loaded the sound library; the fresh one loads it too (lazy, FR-SYNC-37).
    expect((await reply(dm2, dm2.load(AUDIO_ASSET_TYPE))).type).toBe("ack");
    for (const [live, label] of [
      [dm, "dm"],
      [p1, "p1"],
      [p2, "p2"],
    ] as const) {
      const fresh = label === "dm" ? dm2 : live;
      const { live: l, fresh: f } = convergence(h.s, live, fresh);
      expect([label, l]).toEqual([label, f]);
    }
    dm2.close();
  });
});

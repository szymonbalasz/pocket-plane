// TT0 (table-tools core) in process, on the sync-probe seed (two campaigns, Player 1 / 2): record
// types and their windows, the `roll-request` kind def, the internal `audience` input of
// `gameLog.append`, `assets.require`'s kind, the `audio-asset` type, and the campaign row's
// `pause` / `alertSounds` on the wire. The commands that write these rows are TT1–TT4.
import { describe, expect, test } from "bun:test";
import { AUDIO_ASSET_TYPE } from "@shared/assets-pipeline/audio";
import type { CampaignRecord } from "@shared/campaign-management/schemas";
import { ROLL_MACRO_TYPE } from "@shared/dice-extras/macros";
import {
  CLOSED_REQUESTS_WINDOW,
  ROLL_REQUEST_KIND,
  ROLL_REQUEST_TYPE,
  type RollRequestRecord,
} from "@shared/dice-extras/requests";
import { isAnswerEntry, rerollableRoll } from "@shared/dice-roll-log/reroll";
import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import type { GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { asset, campaign, notification, rollMacro, rollRequest } from "../../db/schema";
import type { Actor } from "../../events/types";
import { requireAsset } from "../assets-pipeline/commands";
import { assetUpsert, toAudioAssetRecord } from "../assets-pipeline/records";
import { evaluate, rollPayloadItem } from "../dice-roll-log/evaluate";
import { append, type EntryAudience } from "../dice-roll-log/game-log";
import { notificationKindOf, notify } from "../notifications/helpers";
import { dicexSetup } from "./testing";

const AT = "2026-10-21T20:00:00.000Z";
const IMAGE_ID = "imgimgimgimgimgimgimg1";
const SOUND_ID = "sndsndsndsndsndsndsnd1";

const assetRow = (id: string, campaignId: string, kind: "image" | "audio", seq: number) => ({
  id,
  campaignId,
  seq,
  name: kind === "audio" ? "Chime" : "Map",
  hash: `hash-${id}`,
  mime: kind === "audio" ? "audio/wav" : "image/webp",
  bytes: 17_684,
  width: kind === "audio" ? 0 : 100,
  height: kind === "audio" ? 0 : 100,
  displayWidth: kind === "audio" ? 0 : 100,
  displayHeight: kind === "audio" ? 0 : 100,
  createdAt: AT,
  tags: [],
  kind,
  durationMs: kind === "audio" ? 400 : null,
});

const requestRow = (id: string, campaignId: string, seq: number, open: boolean) => ({
  id,
  campaignId,
  seq,
  roll: { kind: "skill" as const, key: "perception" as const, expression: null },
  label: "Perception",
  dc: 15,
  dcShown: false,
  mode: "normal" as const,
  results: "hidden" as const,
  state: open ? ("open" as const) : ("closed" as const),
  targets: [
    {
      characterId: "pc-1",
      playerId: "p",
      name: "Mira",
      notificationId: "n-1",
      state: open ? ("open" as const) : ("missed" as const),
      entryId: null,
      total: null,
      natural: null,
      success: null,
      at: open ? null : AT,
    },
  ],
  createdAt: AT,
  closedAt: open ? null : AT,
});

/** A roll-request answer line as `dicex.answerRequest` will write it (FR-DICE-79, -80). */
const answerLine = defineCommand({
  name: "test.ttAnswerLine",
  roles: ["dm", "player"],
  input: z.strictObject({
    audience: z.union([
      z.strictObject({ public: z.literal(true) }),
      z.strictObject({ public: z.literal(false), audiencePlayerId: z.string() }),
    ]),
  }),
  execute({ audience }, env: CommandEnv) {
    const r = evaluate(env, {
      expression: "1d20+3",
      mode: "normal",
      category: "skill-check",
      label: "Perception",
      actor: { kind: "dm", id: null, name: "Mira" },
      source: "dice",
    });
    const change = append(env, {
      kind: ROLL_KIND,
      category: "skill-check",
      actorName: "Mira",
      payload: [{ ...rollPayloadItem(r), answer: true }],
      rollIds: [r.id],
      audience: audience as EntryAudience,
    });
    return change.after as GameLogEntryRecord;
  },
});

describe("TT0 table-tools core (in process)", () => {
  test("FR-DICEX-73 roll-request window: open pinned + newest 10 closed; DM only (no player key)", () => {
    const { s, h, viewer, snapshot } = dicexSetup();
    const cid = h.campaignId;
    // 3 open (oldest seqs, still pinned) + 14 closed.
    for (let i = 0; i < 17; i++) {
      s.db
        .insert(rollRequest)
        .values(requestRow(`req-${i}`, cid, i + 1, i < 3))
        .run();
    }
    // Another campaign's request never shows.
    s.db
      .insert(rollRequest)
      .values(requestRow("other", h.secondCampaignId, 99, true))
      .run();
    const dm = snapshot(viewer("dm"))[ROLL_REQUEST_TYPE] as RollRequestRecord[];
    expect(dm.map((r) => r.id)).toEqual([
      "req-0",
      "req-1",
      "req-2",
      ...Array.from({ length: CLOSED_REQUESTS_WINDOW }, (_, i) => `req-${i + 7}`),
    ]);
    expect(dm[0]?.targets[0]?.name).toBe("Mira");
    for (const id of [h.p1.id, h.p2.id]) {
      expect(Object.keys(snapshot(viewer("player", id)))).not.toContain(ROLL_REQUEST_TYPE);
    }
    // The provider reads the window only (SQL), not the history.
    const def = s.records.get(ROLL_REQUEST_TYPE);
    const src = { db: s.db, presence: { list: () => [] } };
    expect(def?.snapshot(src, viewer("dm"))).toHaveLength(3 + CLOSED_REQUESTS_WINDOW);
  });

  test("FR-DICEX-67 roll-macro visibility: DM every row; a player only rows with playerId = them (DM-only rows never)", () => {
    const { s, h, viewer, snapshot } = dicexSetup();
    const row = (id: string, playerId: string | null, createdBy: string | null, order = 0) => ({
      id,
      campaignId: h.campaignId,
      playerId,
      creatureId: null,
      name: id,
      expression: "1d4",
      category: "other" as const,
      order,
      createdBy,
      updatedAt: AT,
    });
    s.db
      .insert(rollMacro)
      .values(row("p1-luck", h.p1.id, h.p1.id))
      .run();
    s.db
      .insert(rollMacro)
      .values(row("dm-for-p2", h.p2.id, null))
      .run();
    s.db
      .insert(rollMacro)
      .values(row("dm-only", null, null))
      .run();
    const ids = (v: ReturnType<typeof viewer>) =>
      ((snapshot(v)[ROLL_MACRO_TYPE] ?? []) as { id: string }[]).map((m) => m.id).sort();
    expect(ids(viewer("dm"))).toEqual(["dm-for-p2", "dm-only", "p1-luck"]);
    expect(ids(viewer("player", h.p1.id))).toEqual(["p1-luck"]);
    expect(ids(viewer("player", h.p2.id))).toEqual(["dm-for-p2"]);
    // The DM's row carries createdBy null: read-only for the player (review A #14).
    const p2 = snapshot(viewer("player", h.p2.id))[ROLL_MACRO_TYPE] as { createdBy: unknown }[];
    expect(p2[0]?.createdBy).toBeNull();
    // updatedAt is server-only.
    expect(Object.keys(p2[0] ?? {})).not.toContain("updatedAt");
  });

  test("FR-NOTE-58 roll-request kind: registered (card), payload ≤ 1 KB, DC only when shown; note.resolve → forbidden", () => {
    const { s, h, run, err, dm, player } = dicexSetup();
    const def = notificationKindOf(ROLL_REQUEST_KIND);
    expect(def?.ownerSpec).toBe("dice-extras");
    expect(def?.genericResolve).toBe(false);
    expect(def?.endRule).toBeUndefined();
    const prompt = defineCommand({
      name: "test.ttPrompt",
      input: z.strictObject({ payload: z.unknown() }),
      execute: ({ payload }, env) =>
        notify(env, {
          kind: ROLL_REQUEST_KIND,
          audience: "player",
          audiencePlayerId: h.p1.id,
          text: "DM: Perception",
          payload,
          action: { label: "Roll", role: "player", playerId: h.p1.id },
        }),
    });
    s.commands.register(prompt);
    const payload = {
      requestId: "req-1",
      characterId: "pc-1",
      characterName: "Mira",
      roll: { kind: "skill", key: "perception", expression: null },
      label: "Perception",
      dc: null,
      mode: "normal",
    };
    const id = run<string>(prompt.name, { payload }, dm);
    const row = s.db.select().from(notification).where(eq(notification.id, id)).get();
    expect([row?.state, row?.actionPlayerId, row?.audiencePlayerId]).toEqual([
      "pending",
      h.p1.id,
      h.p1.id,
    ]);
    // A payload with `success` or `results` is a bug (FR-NOTE-64): the command fails, nothing written.
    expect(err(() => run(prompt.name, { payload: { ...payload, success: true } }, dm)).code).toBe(
      "internal",
    );
    // FR-NOTE-62: never closed by `note.resolve`, even by its action owner.
    const e = err(() =>
      run("note.resolve", { id, resolution: { outcome: "rolled" } }, player(h.p1.id)),
    );
    expect(e.code).toBe("forbidden");
  });

  test("FR-DICE-79 FR-DICE-83 answer audience: hidden = DM + the target's player, whoever rolls; public for all", () => {
    const { s, h, run, dm, player, viewer, snapshot } = dicexSetup();
    s.commands.register(answerLine);
    const p1: Actor = player(h.p1.id);
    const hiddenByDm = run<GameLogEntryRecord>(
      answerLine.name,
      { audience: { public: false, audiencePlayerId: h.p1.id } },
      dm,
    );
    const hiddenByP1 = run<GameLogEntryRecord>(
      answerLine.name,
      { audience: { public: false, audiencePlayerId: h.p1.id } },
      p1,
    );
    const publicByP1 = run<GameLogEntryRecord>(answerLine.name, { audience: { public: true } }, p1);
    expect([hiddenByDm.public, hiddenByDm.audiencePlayerId]).toEqual([false, h.p1.id]);
    // A player roll is always public (#73) — except a hidden answer (ADR-0061 amends it).
    expect([hiddenByP1.public, hiddenByP1.audiencePlayerId]).toEqual([false, h.p1.id]);
    expect([publicByP1.public, publicByP1.audiencePlayerId]).toEqual([true, null]);
    const seen = (v: ReturnType<typeof viewer>) =>
      ((snapshot(v)["game-log-entry"] ?? []) as { id: string }[]).map((e) => e.id);
    expect(seen(viewer("dm"))).toEqual(
      expect.arrayContaining([hiddenByDm.id, hiddenByP1.id, publicByP1.id]),
    );
    expect(seen(viewer("player", h.p1.id))).toEqual(
      expect.arrayContaining([hiddenByDm.id, hiddenByP1.id, publicByP1.id]),
    );
    const p2 = seen(viewer("player", h.p2.id));
    expect(p2).toContain(publicByP1.id);
    expect(p2).not.toContain(hiddenByDm.id);
    expect(p2).not.toContain(hiddenByP1.id);
  });

  test("FR-DICE-80 answer marker: data only, the entry is never rerollable", () => {
    const { s, run, dm } = dicexSetup();
    s.commands.register(answerLine);
    const e = run<GameLogEntryRecord>(answerLine.name, { audience: { public: true } }, dm);
    expect((e.payload as { answer?: true }[])[0]?.answer).toBe(true);
    expect(isAnswerEntry(e)).toBe(true);
    expect(rerollableRoll(e)).toBeNull();
    // The same line without the marker is rerollable (d20 skill check).
    const items = e.payload as { answer?: true }[];
    const plain = { ...e, payload: items.map(({ answer: _a, ...i }) => i) };
    expect(isAnswerEntry(plain)).toBe(false);
    expect(rerollableRoll(plain)).not.toBeNull();
  });

  test("FR-ASSET-59 assets.require kind: default image; a sound as an image (or an image as a sound) → invalid", () => {
    const { s, h, err } = dicexSetup();
    s.db
      .insert(asset)
      .values(assetRow(IMAGE_ID, h.campaignId, "image", 1))
      .run();
    s.db
      .insert(asset)
      .values(assetRow(SOUND_ID, h.campaignId, "audio", 2))
      .run();
    const env = (tx: Parameters<typeof requireAsset>[0]["tx"]) => ({
      tx,
      actor: { role: "dm" as const, playerId: null, campaignId: h.campaignId },
    });
    const req = (id: string, kind?: "image" | "audio") =>
      s.db.transaction((tx) => requireAsset(env(tx), id, kind ? { kind } : {}));
    expect(req(IMAGE_ID).id).toBe(IMAGE_ID);
    expect(req(IMAGE_ID, "image").id).toBe(IMAGE_ID);
    expect(req(SOUND_ID, "audio").id).toBe(SOUND_ID);
    expect([err(() => req(SOUND_ID)).code, err(() => req(SOUND_ID)).message]).toEqual([
      "invalid",
      "Not an image",
    ]);
    expect(err(() => req(IMAGE_ID, "audio")).code).toBe("invalid");
    expect(err(() => req("nopenopenopenopenopeno", "audio")).code).toBe("not_found");
  });

  test("FR-ASSET-57 audio-asset: lazy DM-only type; never in `asset`; the upsert goes to audio-asset", () => {
    const { s, h, viewer, snapshot } = dicexSetup();
    s.db
      .insert(asset)
      .values(assetRow(IMAGE_ID, h.campaignId, "image", 1))
      .run();
    s.db
      .insert(asset)
      .values(assetRow(SOUND_ID, h.campaignId, "audio", 2))
      .run();
    const def = s.records.get(AUDIO_ASSET_TYPE);
    expect([def?.lazy, def?.audience, def?.scope]).toEqual(["all", "dm", "campaign"]);
    for (const v of [viewer("dm"), viewer("player", h.p1.id)]) {
      const snap = snapshot(v);
      expect(Object.keys(snap)).not.toContain(AUDIO_ASSET_TYPE);
      expect(((snap.asset ?? []) as { id: string }[]).map((a) => a.id)).not.toContain(SOUND_ID);
    }
    expect(((snapshot(viewer("dm")).asset ?? []) as { id: string }[]).map((a) => a.id)).toEqual([
      IMAGE_ID,
    ]);
    const src = { db: s.db, presence: { list: () => [] } };
    expect(s.records.load(src, viewer("dm"), AUDIO_ASSET_TYPE)).toEqual({
      [AUDIO_ASSET_TYPE]: [
        {
          id: SOUND_ID,
          campaignId: h.campaignId,
          seq: 2,
          name: "Chime",
          mime: "audio/wav",
          bytes: 17_684,
          durationMs: 400,
          createdAt: AT,
        },
      ],
    });
    const row = s.db.select().from(asset).where(eq(asset.id, SOUND_ID)).get();
    if (!row) throw new Error("no row");
    expect(assetUpsert(row)).toEqual([
      { type: AUDIO_ASSET_TYPE, id: SOUND_ID, before: null, after: toAudioAssetRecord(row) },
    ]);
  });

  test("FR-ASSET-54 a sound has no image files: the image route answers the common 404", async () => {
    const { s, h } = dicexSetup();
    s.db
      .insert(asset)
      .values(assetRow(SOUND_ID, h.campaignId, "audio", 1))
      .run();
    const { createApp } = await import("../../app");
    const app = createApp(s);
    for (const file of ["thumb", "display"]) {
      const res = await app.request(`/api/assets/${SOUND_ID}/${file}`);
      expect(res.status).toBe(404);
    }
  });

  test("FR-CAMP-46 FR-CAMP-48 campaign wire: pause only while paused, alertSounds only when picked; every viewer", () => {
    const { s, h, viewer, snapshot } = dicexSetup();
    const camp = (v: ReturnType<typeof viewer>) =>
      (snapshot(v).campaign as CampaignRecord[])[0] as CampaignRecord;
    const viewers = [viewer("dm"), viewer("player", h.p1.id), viewer("player", h.p2.id)];
    for (const v of viewers) {
      expect(Object.keys(camp(v)).sort()).toEqual(["dmColor", "id", "name"]);
    }
    const pause = { message: "Pizza break", imageAssetId: IMAGE_ID, backAt: AT, startedAt: AT };
    s.db
      .update(campaign)
      .set({ pause, alertSounds: { request: SOUND_ID, pause: "none" } })
      .where(eq(campaign.id, h.campaignId))
      .run();
    for (const v of viewers) {
      expect(camp(v).pause).toEqual(pause);
      expect(camp(v).alertSounds).toEqual({ request: SOUND_ID, pause: "none" });
    }
    s.db
      .update(campaign)
      .set({ pause: null, alertSounds: {} })
      .where(eq(campaign.id, h.campaignId))
      .run();
    for (const v of viewers) {
      expect(Object.keys(camp(v)).sort()).toEqual(["dmColor", "id", "name"]);
    }
  });

  test("FR-CAMP-46 an upsert from another campaign command keeps pause and picks", () => {
    const { s, h, run, dm, events } = dicexSetup();
    const pause = { message: null, imageAssetId: null, backAt: null, startedAt: AT };
    s.db
      .update(campaign)
      .set({ pause, alertSounds: { turn: "none" } })
      .where(eq(campaign.id, h.campaignId))
      .run();
    run("camp.setColor", { playerId: null, color: "#f5c542" }, dm);
    const change = events.at(-1)?.event.changes.find((c) => c.type === "campaign");
    expect(change?.after).toMatchObject({ pause, alertSounds: { turn: "none" } });
  });
});

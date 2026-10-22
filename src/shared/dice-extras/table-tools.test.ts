// TT0 unit: the sprint-8 table-tools zod (macros, requests, prompt kind, audio, campaign table
// state). Pure.
import { describe, expect, test } from "bun:test";
import { AUDIO_MAX_MS, AudioAssetRecord } from "../assets-pipeline/audio";
import { AlertSounds, CampaignPause, noAlertSounds } from "../campaign-management/table-state";
import { jsonBytes } from "../notifications/schemas";
import { MACRO_NAME_MAX, MoveMacroInput, RollMacroRecord, SaveMacroInput } from "./macros";
import {
  AnswerRequestInput,
  defaultRequestLabel,
  promptText,
  REQUEST_CATEGORY,
  RequestInput,
  RequestRoll,
  RollRequestPromptPayload,
  RollRequestPromptResolution,
  RollRequestRecord,
  requestSuccess,
} from "./requests";

const msg = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.error?.issues.map((i) => i.message) ?? [];

describe("TT0 table-tools zod", () => {
  test("FR-DICEX-64 macro schema: name trimmed 1–40, notation canonical, category, roll-as", () => {
    const ok = SaveMacroInput.parse({
      name: "  Sneak Attack ",
      expression: "3D6 + 2",
      category: "damage",
      creatureId: "pc-1",
    });
    expect([ok.name, ok.expression]).toEqual(["Sneak Attack", "3d6+2"]);
    expect(msg(SaveMacroInput.safeParse({ ...ok, name: "   " }))).toEqual(["Name is required"]);
    expect(SaveMacroInput.safeParse({ ...ok, name: "x".repeat(MACRO_NAME_MAX + 1) }).success).toBe(
      false,
    );
    expect(SaveMacroInput.safeParse({ ...ok, name: "a\u0007b" }).success).toBe(false);
    expect(SaveMacroInput.safeParse({ ...ok, expression: "3d6 + banana" }).success).toBe(false);
    expect(SaveMacroInput.safeParse({ ...ok, category: "nope" }).success).toBe(false);
    // Players can't name a playerId: the owner comes from the sender (FR-DICEX-66).
    expect(SaveMacroInput.safeParse({ ...ok, playerId: "p2" }).success).toBe(false);
    expect(MoveMacroInput.safeParse({ id: "m", index: 24 }).success).toBe(false);
    const rec = {
      id: "m",
      campaignId: "c",
      playerId: null,
      creatureId: null,
      name: "Bless",
      expression: "1d4",
      category: "other",
      order: 0,
      createdBy: null,
    };
    expect(RollMacroRecord.parse(rec)).toEqual(rec as never);
    expect(RollMacroRecord.safeParse({ ...rec, updatedAt: "x" }).success).toBe(false);
  });

  test("FR-DICEX-73 FR-DICEX-76 request: roll kinds, 1–12 targets, DC 1–40, categories and labels", () => {
    expect(
      RequestRoll.safeParse({ kind: "skill", key: "perception", expression: null }).success,
    ).toBe(true);
    expect(RequestRoll.safeParse({ kind: "skill", key: "dex", expression: null }).success).toBe(
      false,
    );
    expect(RequestRoll.safeParse({ kind: "save", key: "dex", expression: null }).success).toBe(
      true,
    );
    expect(RequestRoll.safeParse({ kind: "custom", key: null, expression: "1d100" }).success).toBe(
      true,
    );
    expect(RequestRoll.safeParse({ kind: "custom", key: null, expression: "1d0" }).success).toBe(
      false,
    );
    expect(REQUEST_CATEGORY).toEqual({
      skill: "skill-check",
      save: "saving-throw",
      check: "ability-check",
      custom: "other",
    });
    expect(
      [
        { kind: "skill", key: "perception", expression: null },
        { kind: "save", key: "dex", expression: null },
        { kind: "check", key: "str", expression: null },
        { kind: "custom", key: null, expression: "1d100" },
      ].map((r) => defaultRequestLabel(RequestRoll.parse(r))),
    ).toEqual(["Perception", "DEX save", "STR check", "1d100"]);
    const input = {
      roll: { kind: "skill", key: "perception", expression: null },
      characterIds: ["a", "b"],
      dc: 15,
      dcShown: false,
      mode: "normal",
      results: "hidden",
    };
    expect(RequestInput.safeParse(input).success).toBe(true);
    expect(RequestInput.safeParse({ ...input, characterIds: [] }).success).toBe(false);
    expect(RequestInput.safeParse({ ...input, characterIds: ["a", "a"] }).success).toBe(false);
    expect(
      RequestInput.safeParse({
        ...input,
        characterIds: Array.from({ length: 13 }, (_, i) => `${i}`),
      }).success,
    ).toBe(false);
    expect(RequestInput.safeParse({ ...input, dc: 41 }).success).toBe(false);
    expect(RequestInput.safeParse({ ...input, dc: 0 }).success).toBe(false);
    // The audience is the server's (FR-DICE-83): no `public` / `audiencePlayerId` on any intent.
    expect(RequestInput.safeParse({ ...input, public: true }).success).toBe(false);
    const answer = { requestId: "r", characterId: "a", mode: "advantage" };
    expect(AnswerRequestInput.safeParse(answer).success).toBe(true);
    expect(AnswerRequestInput.safeParse({ ...answer, public: false }).success).toBe(false);
    expect(AnswerRequestInput.safeParse({ ...answer, expression: "1d20+10" }).success).toBe(false);
    expect(
      AnswerRequestInput.safeParse({
        ...answer,
        manualParts: [{ key: "e:bless", entry: { diceTotal: 3 } }],
      }).success,
    ).toBe(false);
    expect([requestSuccess(15, 15), requestSuccess(15, 14), requestSuccess(null, 30)]).toEqual([
      true,
      false,
      null,
    ]);
  });

  test("FR-DICEX-73 request record: 1–12 targets, states, DM-only fields", () => {
    const target = {
      characterId: "pc",
      playerId: "p",
      name: "Mira",
      notificationId: "n",
      state: "open",
      entryId: null,
      total: null,
      natural: null,
      success: null,
      at: null,
    };
    const rec = {
      id: "r",
      campaignId: "c",
      seq: 1,
      roll: { kind: "save", key: "dex", expression: null },
      label: "DEX save",
      dc: null,
      dcShown: false,
      mode: "normal",
      results: "public",
      state: "open",
      targets: [target],
      createdAt: "t",
      closedAt: null,
    };
    expect(RollRequestRecord.safeParse(rec).success).toBe(true);
    expect(RollRequestRecord.safeParse({ ...rec, targets: [] }).success).toBe(false);
    expect(RollRequestRecord.safeParse({ ...rec, targets: Array(13).fill(target) }).success).toBe(
      false,
    );
    expect(
      RollRequestRecord.safeParse({ ...rec, targets: [{ ...target, state: "late" }] }).success,
    ).toBe(false);
  });

  test("FR-NOTE-58 FR-NOTE-64 prompt payload: ≤ 1 KB at max strings, no success / results; text", () => {
    const payload = {
      requestId: "r".repeat(36),
      characterId: "c".repeat(36),
      characterName: "N".repeat(60),
      roll: { kind: "custom", key: null, expression: Array(6).fill("5d1000kh5").join("+") },
      label: "L".repeat(60),
      dc: 40,
      mode: "disadvantage",
    };
    expect(jsonBytes(RollRequestPromptPayload.parse(payload))).toBeLessThanOrEqual(1024);
    expect(RollRequestPromptPayload.safeParse({ ...payload, success: true }).success).toBe(false);
    expect(RollRequestPromptPayload.safeParse({ ...payload, results: "hidden" }).success).toBe(
      false,
    );
    expect(RollRequestPromptResolution.safeParse({ outcome: "rolled", total: 17 }).success).toBe(
      true,
    );
    expect(RollRequestPromptResolution.safeParse({ outcome: "lost" }).success).toBe(false);
    expect([promptText("Perception", "Mira", null), promptText("DEX save", "Mira", 15)]).toEqual([
      "DM: Perception · Mira",
      "DM: DEX save · Mira · DC 15",
    ]);
  });

  test("FR-CAMP-46 FR-CAMP-48 FR-ASSET-57 pause card, sound picks, audio record", () => {
    const pause = { message: "Pizza break", imageAssetId: null, backAt: null, startedAt: "t" };
    expect(CampaignPause.safeParse(pause).success).toBe(true);
    expect(CampaignPause.safeParse({ ...pause, message: "x".repeat(201) }).success).toBe(false);
    expect(CampaignPause.safeParse({ ...pause, imageAssetId: "short" }).success).toBe(false);
    expect(AlertSounds.safeParse({ turn: "none", request: "a".repeat(22) }).success).toBe(true);
    expect(AlertSounds.safeParse({ turn: "default" }).success).toBe(false);
    expect(AlertSounds.safeParse({ kill: "none" }).success).toBe(false);
    expect([noAlertSounds({}), noAlertSounds({ resume: "none" })]).toEqual([true, false]);
    const sound = {
      id: "s",
      campaignId: "c",
      seq: 1,
      name: "Chime",
      mime: "audio/wav",
      bytes: 17_684,
      durationMs: 400,
      createdAt: "t",
    };
    expect(AudioAssetRecord.safeParse(sound).success).toBe(true);
    expect(AudioAssetRecord.safeParse({ ...sound, mime: "audio/flac" }).success).toBe(false);
    expect(AudioAssetRecord.safeParse({ ...sound, durationMs: AUDIO_MAX_MS + 1 }).success).toBe(
      false,
    );
    expect(AudioAssetRecord.safeParse({ ...sound, hash: "h" }).success).toBe(false);
  });
});

// NOTE §13 unit level: helpers, kind registry, state machine, intents, visibility fn.
import { describe, expect, test } from "bun:test";
import { defineEvent } from "@shared/events";
import {
  cleanText,
  type NotificationRecord,
  notificationVisibleTo,
} from "@shared/notifications/schemas";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type CommandDef, defineCommand } from "../../commands/commands";
import { CommandError } from "../../commands/errors";
import { notification, syncProbe } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { Actor, DispatchedEvent } from "../../events/types";
import { createTestServices } from "../../testing/services";
import { activateCampaign, addPlayer, createCampaign } from "../campaign-management/commands";
import { probeSet } from "../live-sync/probe";
import { noteDismiss, noteResolve, noteTestSend } from "./commands";
import { createNotificationHelpers, type NotifyInput } from "./helpers";
import { buildKindMap, defineNotificationKind } from "./kind";
import { notificationKinds } from "./kinds";
import { testKind } from "./test-kind";

const Applied = defineEvent({
  type: "TestApplied",
  payload: z.object({ id: z.string() }).strict(),
  logged: true,
  undoable: false,
});

// Test-only kinds: permissive payload (size limit), a resolution schema, a non-generic kind.
const bigKind = defineNotificationKind({
  kind: "big",
  ownerSpec: "test",
  payload: z.object({ blob: z.string() }),
  resolution: z.object({ note: z.string() }),
});
const cardKind = defineNotificationKind({
  kind: "card",
  ownerSpec: "test",
  payload: z.object({}).strict(),
  resolution: z.object({ applied: z.number().int() }).strict(),
});
// Per-kind cap above the 256 B default (FR-NOTE-03, #155: damage-card declares 2 KB).
const wideKind = defineNotificationKind({
  kind: "wide",
  ownerSpec: "test",
  payload: z.object({}).strict(),
  resolution: z.object({ note: z.string() }).strict(),
  resolutionMaxBytes: 2048,
});
const h = createNotificationHelpers([testKind, bigKind, cardKind, wideKind]);

function setup(opts: { testMode?: boolean } = {}) {
  const s = createTestServices({ testMode: opts.testMode ?? true });
  const dm0: Actor = { role: "dm", playerId: null, campaignId: null };
  const run = s.commands.run.bind(s.commands);
  const c1 = run(createCampaign, { name: "One" }, { actor: dm0 });
  const p1 = run(addPlayer, { name: "Player 1" }, { actor: dm0 });
  const p2 = run(addPlayer, { name: "Player 2" }, { actor: dm0 });
  const c2 = run(createCampaign, { name: "Two" }, { actor: dm0 });
  const dm: Actor = { role: "dm", playerId: null, campaignId: c1.id };
  const dmOther: Actor = { role: "dm", playerId: null, campaignId: c2.id };
  const asP1: Actor = { role: "player", playerId: p1.id, campaignId: c1.id };
  const asP2: Actor = { role: "player", playerId: p2.id, campaignId: c1.id };
  const seen: DispatchedEvent[] = [];
  s.bus.subscribe("test-collect", (e) => seen.push(e));
  s.commands.registerEvent(Applied);

  // Test commands driving the helpers with test kinds.
  const send = defineCommand({
    name: "t.notify",
    input: z.object({ req: z.unknown(), fail: z.boolean().default(false) }),
    roles: ["dm", "player"],
    execute({ req, fail }, env) {
      const id = h.notify(env, req as NotifyInput);
      if (fail) throw new Error("caller failed after notify");
      return { id };
    },
  });
  const probe =
    opts.testMode === false
      ? { id: "" }
      : run(probeSet, { text: "p", hidden: false }, { actor: dm });
  // Owner command: changes a probe, emits its own event, then resolves (ADR-0027, FR-NOTE-08).
  const apply = defineCommand({
    name: "t.apply",
    input: z.object({ id: z.string(), resolution: z.unknown().optional() }),
    roles: ["dm", "player"],
    execute({ id, resolution }, env) {
      const row = env.tx.select().from(syncProbe).where(eq(syncProbe.id, probe.id)).get();
      env.tx
        .update(syncProbe)
        .set({ text: `${row?.text}!` })
        .where(eq(syncProbe.id, probe.id))
        .run();
      env.emit({
        type: "TestApplied",
        campaignId: env.actor.campaignId,
        payload: { id },
        changes: [],
      });
      h.resolveNotification(env, id, resolution);
    },
  });
  const undo = defineCommand({
    name: "t.undo",
    input: z.object({ id: z.string() }),
    execute({ id }, env) {
      env.emit({
        type: "TestApplied",
        campaignId: env.actor.campaignId,
        payload: { id },
        changes: [],
      });
      h.reopenNotification(env, id);
    },
  });
  for (const c of [send, apply, undo]) s.commands.register(c as unknown as CommandDef);

  const row = (id: string) =>
    s.db.select().from(notification).where(eq(notification.id, id)).get() as
      | (NotificationRecord & { payload: unknown })
      | undefined;
  const notifyAs = (actor: Actor, req: NotifyInput, fail = false) =>
    (run("t.notify", { req, fail }, { actor }) as { id: string }).id;
  const probeText = () =>
    s.db.select().from(syncProbe).where(eq(syncProbe.id, probe.id)).get()?.text;
  return { s, run, dm, dmOther, asP1, asP2, p1, p2, c1, c2, seen, row, notifyAs, probeText };
}

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof CommandError ? e.code : `error: ${(e as Error).message}`;
  }
  return "ok";
};

describe("notify (FR-NOTE-02/03/04/05)", () => {
  test("FR-NOTE-01/02 notify inserts the row with seq, emits NotificationCreated, logs it", () => {
    const t = setup();
    const before = readEventLog(t.s.db).length;
    const a = t.notifyAs(t.dm, {
      kind: "test",
      audience: "all",
      text: "  Hello\u0007 ",
      payload: {},
    });
    const b = t.notifyAs(t.dm, { kind: "test", audience: "dm", text: "Two", payload: {} });
    expect(t.row(a)).toMatchObject({
      seq: 1,
      kind: "test",
      audience: "all",
      text: "Hello",
      state: "info",
      actionRole: null,
      campaignId: t.c1.id,
    });
    expect(t.row(b)?.seq).toBe(2);
    const ev = t.seen.filter((e) => e.event.type === "NotificationCreated");
    expect(ev.map((e) => e.event.payload)).toEqual([
      {
        notificationId: a,
        kind: "test",
        audience: "all",
        audiencePlayerId: null,
        hasAction: false,
      },
      { notificationId: b, kind: "test", audience: "dm", audiencePlayerId: null, hasAction: false },
    ]);
    expect(ev[0]?.event.changes[0]).toMatchObject({ type: "notification", id: a, before: null });
    expect(readEventLog(t.s.db).length - before).toBe(2);
  });

  test("FR-NOTE-02 caller rolls back → no row, no event, no log entry", () => {
    const t = setup();
    const logBefore = readEventLog(t.s.db).length;
    const seenBefore = t.seen.length;
    const code = codeOf(() =>
      t.notifyAs(t.dm, { kind: "test", audience: "all", text: "x", payload: {} }, true),
    );
    expect(code).toBe("internal");
    expect(t.s.db.select().from(notification).all()).toEqual([]);
    expect(t.seen.length).toBe(seenBefore);
    expect(readEventLog(t.s.db).length).toBe(logBefore);
  });

  test("FR-NOTE-03 unknown kind, bad payload, payload > 1 KB, bad text → internal, nothing written", () => {
    const t = setup();
    const base = { audience: "dm" as const, text: "ok", payload: {} };
    expect(codeOf(() => t.notifyAs(t.dm, { ...base, kind: "nope" }))).toBe("internal");
    expect(codeOf(() => t.notifyAs(t.dm, { ...base, kind: "test", payload: { x: 1 } }))).toBe(
      "internal",
    );
    const blob = "x".repeat(1014); // {"blob":"…"} = 1025 B
    expect(codeOf(() => t.notifyAs(t.dm, { ...base, kind: "big", payload: { blob } }))).toBe(
      "internal",
    );
    expect(
      codeOf(() => t.notifyAs(t.dm, { ...base, kind: "big", payload: { blob: "x".repeat(900) } })),
    ).toBe("ok");
    for (const text of ["", " \u0000\n ", "y".repeat(281)]) {
      expect(codeOf(() => t.notifyAs(t.dm, { ...base, kind: "test", text }))).toBe("internal");
    }
    expect(t.s.db.select().from(notification).all()).toHaveLength(1);
  });

  test("FR-NOTE-03 kind registry: bad pattern or duplicate fails at load; MVP registry holds `test`", () => {
    const k = (kind: string) =>
      defineNotificationKind({ kind, ownerSpec: "x", payload: z.object({}) });
    expect(() => buildKindMap([k("Bad")])).toThrow(/must match/);
    expect(() => buildKindMap([k("a".repeat(33))])).toThrow(/must match/);
    expect(() => buildKindMap([k("ok-1"), k("ok-1")])).toThrow(/twice/);
    expect([...buildKindMap(notificationKinds).keys()]).toContain("test");
    expect(buildKindMap(notificationKinds).get("test")?.genericResolve).toBe(true);
  });

  test("FR-NOTE-04 audience player must be of the actor's campaign; audience immutable", () => {
    const t = setup();
    const dm0 = { ...t.dm, campaignId: null };
    t.run(activateCampaign, { id: t.c2.id }, { actor: dm0 });
    const other = t.run(addPlayer, { name: "Other" }, { actor: dm0 });
    t.run(activateCampaign, { id: t.c1.id }, { actor: dm0 });
    const base = { kind: "test", text: "x", payload: {} };
    expect(
      codeOf(() => t.notifyAs(t.dm, { ...base, audience: "player", audiencePlayerId: other.id })),
    ).toBe("internal");
    expect(codeOf(() => t.notifyAs(t.dm, { ...base, audience: "player" }))).toBe("internal");
    const id = t.notifyAs(t.dm, { ...base, audience: "player", audiencePlayerId: t.p1.id });
    expect(t.row(id)).toMatchObject({ audience: "player", audiencePlayerId: t.p1.id });
  });

  test("FR-NOTE-05 action: label 1–24, player owner in audience; action → pending, else info", () => {
    const t = setup();
    const base = { kind: "test", text: "x", payload: {} };
    const p1Pending = t.notifyAs(t.dm, {
      ...base,
      audience: "player",
      audiencePlayerId: t.p1.id,
      action: { label: "Done", role: "player", playerId: t.p1.id },
    });
    expect(t.row(p1Pending)).toMatchObject({
      state: "pending",
      actionLabel: "Done",
      actionRole: "player",
      actionPlayerId: t.p1.id,
    });
    const allOwner = t.notifyAs(t.dm, {
      ...base,
      audience: "all",
      action: { label: "Go", role: "player", playerId: t.p2.id },
    });
    expect(t.row(allOwner)?.state).toBe("pending");
    expect(
      codeOf(() =>
        t.notifyAs(t.dm, {
          ...base,
          audience: "player",
          audiencePlayerId: t.p1.id,
          action: { label: "Done", role: "player", playerId: t.p2.id },
        }),
      ),
    ).toBe("internal");
    expect(
      codeOf(() =>
        t.notifyAs(t.dm, {
          ...base,
          audience: "dm",
          action: { label: "Done", role: "player", playerId: t.p1.id },
        }),
      ),
    ).toBe("internal");
    expect(
      codeOf(() =>
        t.notifyAs(t.dm, {
          ...base,
          audience: "dm",
          action: { label: "z".repeat(25), role: "dm" },
        }),
      ),
    ).toBe("internal");
  });
});

describe("visibility (FR-NOTE-06)", () => {
  test("FR-NOTE-06 visibility fn per audience × role", () => {
    const dm = { role: "dm" as const, playerId: null };
    const p1 = { role: "player" as const, playerId: "p1" };
    const p2 = { role: "player" as const, playerId: "p2" };
    const rows = {
      all: { audience: "all" as const, audiencePlayerId: null },
      dm: { audience: "dm" as const, audiencePlayerId: null },
      p1: { audience: "player" as const, audiencePlayerId: "p1" },
    };
    const table = Object.fromEntries(
      Object.entries(rows).map(([k, r]) => [
        k,
        [dm, p1, p2].map((v) => notificationVisibleTo(r, v)),
      ]),
    );
    expect(table).toEqual({
      all: [true, true, true],
      dm: [true, false, false],
      p1: [true, true, false],
    });
  });
});

describe("state machine and resolve (FR-NOTE-07/08/09/10/11)", () => {
  test("FR-NOTE-07/08 resolve sets closed fields; second resolve → conflict, probe changed once", () => {
    const t = setup();
    const id = t.notifyAs(t.dm, {
      kind: "card",
      audience: "dm",
      text: "apply?",
      payload: {},
      action: { label: "Apply", role: "dm" },
    });
    t.run("t.apply", { id, resolution: { applied: 4 } }, { actor: t.dm });
    expect(
      codeOf(() => t.run("t.apply", { id, resolution: { applied: 4 } }, { actor: t.dm })),
    ).toBe("conflict");
    expect(t.probeText()).toBe("p!");
    expect(t.row(id)).toMatchObject({
      state: "resolved",
      resolution: { applied: 4 },
      closedByRole: "dm",
      closedByPlayerId: null,
    });
    expect(t.row(id)?.closedAt).toBeString();
    // Owner event first, helper event after (protocol §22).
    const types = t.seen.map((e) => e.event.type);
    expect(types.slice(-2)).toEqual(["TestApplied", "NotificationResolved"]);
  });

  test("FR-NOTE-08 not_found (other campaign), forbidden (not owner), invalid (resolution) roll back the whole command", () => {
    const t = setup();
    const card = t.notifyAs(t.dm, {
      kind: "card",
      audience: "player",
      audiencePlayerId: t.p1.id,
      text: "card",
      payload: {},
      action: { label: "Apply", role: "dm" },
    });
    expect(codeOf(() => t.run("t.apply", { id: card }, { actor: t.dmOther }))).toBe("not_found");
    expect(codeOf(() => t.run("t.apply", { id: card }, { actor: t.asP1 }))).toBe("forbidden");
    expect(
      codeOf(() => t.run("t.apply", { id: card, resolution: { applied: "x" } }, { actor: t.dm })),
    ).toBe("invalid");
    expect(t.probeText()).toBe("p");
    expect(t.row(card)?.state).toBe("pending");
  });

  test("FR-NOTE-03 resolution > 256 B serialized → internal; kind without resolution → invalid", () => {
    const t = setup();
    const big = t.notifyAs(t.dm, {
      kind: "big",
      audience: "dm",
      text: "b",
      payload: { blob: "" },
      action: { label: "Ok", role: "dm" },
    });
    expect(
      codeOf(() =>
        t.run("t.apply", { id: big, resolution: { note: "n".repeat(300) } }, { actor: t.dm }),
      ),
    ).toBe("internal");
    const tst = t.notifyAs(t.dm, {
      kind: "test",
      audience: "dm",
      text: "t",
      payload: {},
      action: { label: "Ok", role: "dm" },
    });
    expect(codeOf(() => t.run("t.apply", { id: tst, resolution: { a: 1 } }, { actor: t.dm }))).toBe(
      "invalid",
    );
    expect(t.probeText()).toBe("p");
  });

  test("FR-NOTE-03 per-kind resolutionMaxBytes: over 256 B allowed up to the kind's cap", () => {
    const t = setup();
    const req: NotifyInput = {
      kind: "wide",
      audience: "dm",
      text: "w",
      payload: {},
      action: { label: "Ok", role: "dm" },
    };
    const ok = t.notifyAs(t.dm, req);
    t.run("t.apply", { id: ok, resolution: { note: "n".repeat(1500) } }, { actor: t.dm });
    expect(t.row(ok)?.state).toBe("resolved");
    const tooBig = t.notifyAs(t.dm, req);
    expect(
      codeOf(() =>
        t.run("t.apply", { id: tooBig, resolution: { note: "n".repeat(2100) } }, { actor: t.dm }),
      ),
    ).toBe("internal");
    expect(t.row(tooBig)?.state).toBe("pending");
    const bad = (resolutionMaxBytes: number) => buildKindMap([{ ...wideKind, resolutionMaxBytes }]);
    expect(() => bad(0)).toThrow(/resolutionMaxBytes/);
    expect(() => bad(1.5)).toThrow(/resolutionMaxBytes/);
  });

  test("FR-NOTE-08 player action owner may resolve; DM may resolve any pending", () => {
    const t = setup();
    const req = {
      kind: "test",
      audience: "player" as const,
      audiencePlayerId: t.p1.id,
      text: "Roll",
      payload: {},
      action: { label: "Done", role: "player" as const, playerId: t.p1.id },
    };
    const a = t.notifyAs(t.dm, req);
    const b = t.notifyAs(t.dm, req);
    t.run("t.apply", { id: a }, { actor: t.asP1 });
    t.run("t.apply", { id: b }, { actor: t.dm });
    expect(t.row(a)).toMatchObject({
      state: "resolved",
      closedByRole: "player",
      closedByPlayerId: t.p1.id,
    });
    expect(t.row(b)).toMatchObject({ state: "resolved", closedByRole: "dm" });
  });

  test("FR-NOTE-10 reopen: resolved → pending, clears closed fields and resolution, after the owner's event", () => {
    const t = setup();
    const id = t.notifyAs(t.dm, {
      kind: "card",
      audience: "dm",
      text: "c",
      payload: {},
      action: { label: "Apply", role: "dm" },
    });
    expect(codeOf(() => t.run("t.undo", { id }, { actor: t.dm }))).toBe("conflict");
    t.run("t.apply", { id, resolution: { applied: 2 } }, { actor: t.dm });
    t.run("t.undo", { id }, { actor: t.dm });
    expect(t.row(id)).toMatchObject({
      state: "pending",
      resolution: null,
      closedAt: null,
      closedByRole: null,
      closedByPlayerId: null,
    });
    expect(t.seen.map((e) => e.event.type).slice(-2)).toEqual([
      "TestApplied",
      "NotificationReopened",
    ]);
    // Reopened → resolvable again (no Redo, re-apply).
    t.run("t.apply", { id, resolution: { applied: 3 } }, { actor: t.dm });
    expect(t.row(id)?.resolution).toEqual({ applied: 3 });
  });

  test("FR-NOTE-07/11 note.dismiss: DM only, pending only; info and dismissed are final", () => {
    const t = setup();
    const info = t.notifyAs(t.dm, { kind: "test", audience: "all", text: "i", payload: {} });
    const pend = t.notifyAs(t.dm, {
      kind: "test",
      audience: "all",
      text: "p",
      payload: {},
      action: { label: "Ok", role: "dm" },
    });
    expect(codeOf(() => t.run(noteDismiss, { id: pend }, { actor: t.asP1 }))).toBe("forbidden");
    expect(codeOf(() => t.run(noteDismiss, { id: info }, { actor: t.dm }))).toBe("conflict");
    expect(codeOf(() => t.run(noteDismiss, { id: pend }, { actor: t.dmOther }))).toBe("not_found");
    t.run(noteDismiss, { id: pend }, { actor: t.dm });
    expect(t.row(pend)).toMatchObject({ state: "dismissed", closedByRole: "dm" });
    expect(codeOf(() => t.run(noteDismiss, { id: pend }, { actor: t.dm }))).toBe("conflict");
    expect(codeOf(() => t.run(noteResolve, { id: pend }, { actor: t.dm }))).toBe("conflict");
    expect(codeOf(() => t.run("t.apply", { id: info }, { actor: t.dm }))).toBe("conflict");
    expect(codeOf(() => t.run("t.undo", { id: pend }, { actor: t.dm }))).toBe("conflict");
    expect(t.seen.at(-1)?.event).toMatchObject({
      type: "NotificationDismissed",
      payload: { notificationId: pend, kind: "test" },
    });
  });

  test("FR-NOTE-09 note.resolve: generic kinds only (forbidden), invisible → not_found, then FR-NOTE-08", () => {
    const t = setup();
    const card = t.notifyAs(t.dm, {
      kind: "card",
      audience: "all",
      text: "c",
      payload: {},
      action: { label: "Apply", role: "dm" },
    });
    expect(codeOf(() => t.run(noteResolve, { id: card }, { actor: t.dm }))).toBe("forbidden");
    expect(codeOf(() => t.run(noteResolve, { id: card }, { actor: t.asP1 }))).toBe("forbidden");
    const p1 = t.notifyAs(t.dm, {
      kind: "test",
      audience: "player",
      audiencePlayerId: t.p1.id,
      text: "Roll",
      payload: {},
      action: { label: "Done", role: "player", playerId: t.p1.id },
    });
    expect(codeOf(() => t.run(noteResolve, { id: p1 }, { actor: t.asP2 }))).toBe("not_found");
    expect(codeOf(() => t.run(noteResolve, { id: "missing" }, { actor: t.asP1 }))).toBe(
      "not_found",
    );
    const dmOwned = t.notifyAs(t.dm, {
      kind: "test",
      audience: "all",
      text: "dm owns",
      payload: {},
      action: { label: "Ok", role: "dm" },
    });
    expect(codeOf(() => t.run(noteResolve, { id: dmOwned }, { actor: t.asP1 }))).toBe("forbidden");
    t.run(noteResolve, { id: p1 }, { actor: t.asP1 });
    expect(t.row(p1)?.state).toBe("resolved");
    expect(codeOf(() => t.run(noteResolve, { id: p1 }, { actor: t.asP1 }))).toBe("conflict");
    expect(t.seen.at(-1)?.event.type).toBe("NotificationResolved");
  });
});

describe("note.testSend (FR-NOTE-22) and text (FR-NOTE-21)", () => {
  test("FR-NOTE-21 text is trimmed, control characters removed", () => {
    expect(cleanText("  a\u0000b\nc\t ")).toBe("abc");
  });

  test("FR-NOTE-22 player: {text, actionLabel?} only → audience self, owner DM; other fields → invalid", () => {
    const t = setup();
    const { id } = t.run(noteTestSend, { text: "Apply 4 damage?" }, { actor: t.asP1 });
    expect(t.row(id)).toMatchObject({
      kind: "test",
      audience: "player",
      audiencePlayerId: t.p1.id,
      actionRole: "dm",
      actionLabel: "Resolve",
      actionPlayerId: null,
      state: "pending",
    });
    expect(
      codeOf(() => t.run(noteTestSend, { text: "x", audience: "all" }, { actor: t.asP1 })),
    ).toBe("invalid");
    expect(
      codeOf(() => t.run(noteTestSend, { text: "x", actionRole: "player" }, { actor: t.asP1 })),
    ).toBe("invalid");
    expect(
      codeOf(() => t.run(noteTestSend, { text: "x", bogus: 1 } as never, { actor: t.asP1 })),
    ).toBe("invalid");
  });

  test("FR-NOTE-22 DM: any audience and action; bad combos → invalid / not_found", () => {
    const t = setup();
    const info = t.run(noteTestSend, { text: "Torches", audience: "all" }, { actor: t.dm });
    expect(t.row(info.id)).toMatchObject({ audience: "all", state: "info" });
    const dflt = t.run(noteTestSend, { text: "Secret" }, { actor: t.dm });
    expect(t.row(dflt.id)).toMatchObject({ audience: "dm", state: "info" });
    const pend = t.run(
      noteTestSend,
      {
        text: "Roll DEX save",
        audience: "player",
        audiencePlayerId: t.p1.id,
        actionLabel: "Done",
        actionRole: "player",
        actionPlayerId: t.p1.id,
      },
      { actor: t.dm },
    );
    expect(t.row(pend.id)).toMatchObject({ state: "pending", actionPlayerId: t.p1.id });
    const cases: [Record<string, unknown>, string][] = [
      [{ audience: "player" }, "invalid"],
      [{ audience: "player", audiencePlayerId: "nope" }, "not_found"],
      [{ audience: "all", audiencePlayerId: t.p1.id }, "invalid"],
      [{ audience: "all", actionRole: "dm" }, "invalid"],
      [{ audience: "all", actionLabel: "X", actionRole: "player" }, "invalid"],
      [
        { audience: "dm", actionLabel: "X", actionRole: "player", actionPlayerId: t.p1.id },
        "invalid",
      ],
      [
        {
          audience: "player",
          audiencePlayerId: t.p2.id,
          actionLabel: "X",
          actionRole: "player",
          actionPlayerId: t.p1.id,
        },
        "invalid",
      ],
      [{ audience: "all", actionLabel: "X", actionPlayerId: t.p1.id }, "invalid"],
      [{ text: "" }, "invalid"],
    ];
    for (const [extra, code] of cases) {
      const got = codeOf(() =>
        t.run(noteTestSend, { text: "x", ...extra } as never, { actor: t.dm }),
      );
      expect({ extra, got }).toEqual({ extra, got: code });
    }
  });

  test("FR-NOTE-22 absent outside test mode", () => {
    const t = setup({ testMode: false });
    expect(t.s.commands.has("note.testSend")).toBe(false);
    expect(t.s.intents.has("note.testSend")).toBe(false);
    expect(t.s.intents.has("note.resolve")).toBe(true);
    expect(t.s.intents.has("note.dismiss")).toBe(true);
  });
});

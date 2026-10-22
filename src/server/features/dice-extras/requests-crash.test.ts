// TT2 crash (#163 seam, DICEX §11 sprint 8): `dicex.request` and `dicex.answerRequest` are one
// transaction each (row + prompts / roll + entry + target + prompt + event log). before-commit →
// nothing written (digest equal after a restart); after-commit → all of it, never half.
import { afterEach, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { DICEX_REQUEST_INTENTS, type RollRequestRecord } from "@shared/dice-extras/requests";
import { and, eq } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { closeDb, type Db } from "../../db/client";
import { stateDigest } from "../../db/digest";
import {
  campaign,
  entity,
  eventLog,
  gameLogEntry,
  notification,
  rollRequest,
} from "../../db/schema";
import { silentLogger } from "../../log";
import { createServices } from "../../services";
import { createTestServices, DM_ACTOR } from "../../testing/services";
import { toRequestRecord } from "./table-rows";

afterEach(() => armCrashHook(null));

class Killed extends Error {}
const kill = () => {
  throw new Killed();
};

async function boot(openDb: () => Db) {
  const db = openDb();
  const s = createServices({ config: createTestServices().config, db, log: silentLogger });
  for (const h of s.startHooks) await h.fn(s);
  return { s, db, close: () => closeDb(db) };
}
type Boot = Awaited<ReturnType<typeof boot>>;

const cid = (b: Boot) => b.db.select().from(campaign).where(eq(campaign.active, true)).get()?.id;
const pc = (b: Boot, name: string) =>
  b.db
    .select()
    .from(entity)
    .where(and(eq(entity.name, name), eq(entity.campaignId, cid(b) as string)))
    .get() as typeof entity.$inferSelect;
const requests = (b: Boot) =>
  b.db.select().from(rollRequest).all().map(toRequestRecord) as RollRequestRecord[];
const count = (b: Boot, t: typeof gameLogEntry | typeof notification | typeof eventLog) =>
  b.db.select().from(t).all().length;

/** Runs `step` armed at `before-commit`, then `after-commit`, rebooting between. */
async function crashBoth(
  name: string,
  step: (b: Boot) => unknown,
  check: (b: Boot, committed: boolean) => void,
) {
  const loaded = await loadBundle("table-tools", { testMode: true });
  try {
    let b = await boot(loaded.openDb);
    const before = stateDigest(b.db.$client).sha256;
    armCrashHook({ point: "before-commit", target: name }, kill);
    expect(() => step(b)).toThrow();
    armCrashHook(null);
    b.close();
    b = await boot(loaded.openDb);
    expect(stateDigest(b.db.$client).sha256).toBe(before);
    check(b, false);
    armCrashHook({ point: "after-commit", target: name }, kill);
    expect(() => step(b)).toThrow(Killed);
    armCrashHook(null);
    b.close();
    b = await boot(loaded.openDb);
    expect(stateDigest(b.db.$client).sha256).not.toBe(before);
    check(b, true);
    b.close();
  } finally {
    try {
      loaded.cleanup();
    } catch {
      // Windows may hold the temp dir a moment longer; the OS cleans it up.
    }
  }
}

test("FR-DICEX-74 crash dicex.request: row + prompts + event together, never half", async () => {
  let base = { prompts: 0, events: 0 };
  await crashBoth(
    DICEX_REQUEST_INTENTS.request,
    (b) => {
      base = { prompts: count(b, notification), events: count(b, eventLog) };
      return b.s.commands.run(
        DICEX_REQUEST_INTENTS.request,
        {
          roll: { kind: "save", key: "dex", expression: null },
          characterIds: [pc(b, "Mira").id, pc(b, "Thorn").id],
          dcShown: false,
          mode: "normal",
          results: "public",
        },
        { actor: { ...DM_ACTOR, campaignId: cid(b) as string } },
      );
    },
    (b, committed) => {
      expect(requests(b)).toHaveLength(committed ? 2 : 1);
      expect(count(b, notification) - base.prompts).toBe(committed ? 2 : 0);
      if (committed) expect(count(b, eventLog) - base.events).toBe(3);
    },
  );
}, 120_000);

test("FR-DICEX-78 crash dicex.answerRequest: roll + entry + target + prompt together, never half", async () => {
  let entries = 0;
  await crashBoth(
    DICEX_REQUEST_INTENTS.answerRequest,
    (b) => {
      entries = count(b, gameLogEntry);
      const mira = pc(b, "Mira");
      return b.s.commands.run(
        DICEX_REQUEST_INTENTS.answerRequest,
        {
          requestId: requests(b)[0]?.id,
          characterId: mira.id,
          mode: "normal",
          manual: { diceTotal: 12 },
        },
        {
          actor: {
            role: "player",
            playerId: mira.ownerPlayerId as string,
            campaignId: cid(b) as string,
          },
        },
      );
    },
    (b, committed) => {
      const t = requests(b)[0]?.targets.find((x) => x.name === "Mira");
      const prompt = b.db
        .select()
        .from(notification)
        .where(eq(notification.id, t?.notificationId as string))
        .get();
      expect([t?.state, prompt?.state]).toEqual(
        committed ? ["rolled", "resolved"] : ["open", "pending"],
      );
      expect(count(b, gameLogEntry) - entries).toBe(committed ? 1 : 0);
      if (committed) expect(t?.entryId).not.toBeNull();
    },
  );
}, 120_000);

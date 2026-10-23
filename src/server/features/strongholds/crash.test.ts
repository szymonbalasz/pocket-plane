// REM / HOLD crash (#163 seam, FR-REM-31, FR-HOLD-39): each command is one transaction with its
// event-log row. before-commit → nothing written (digest equal after a restart); after-commit →
// all of it, never half, and the restarted state equals the committed one.
import { afterEach, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { GREYSTONE } from "@fixtures/units/strongholds/hold-greystone";
import { STEAM_ROOMS_TEXT } from "@fixtures/units/strongholds/hold-greystone-reminders";
import { TOWER } from "@fixtures/units/strongholds/hold-tower-secret";
import { and, eq } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { closeDb, type Db } from "../../db/client";
import { stateDigest } from "../../db/digest";
import { campaign, entity, partyItem, reminder, stronghold } from "../../db/schema";
import { silentLogger } from "../../log";
import { createServices } from "../../services";
import { createTestServices, DM_ACTOR } from "../../testing/services";
import { partyPot } from "../party-loot/rows";
import { coinConservation } from "./testing";

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

const cid = (b: Boot) =>
  b.db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
const holdByName = (b: Boot, name: string) =>
  b.db.select().from(stronghold).where(eq(stronghold.name, name)).get();
const dm = (b: Boot) => ({ actor: { ...DM_ACTOR, campaignId: cid(b) } });

/** Runs `step` armed at `before-commit`, then `after-commit`, rebooting between. */
async function crashBoth(
  name: string,
  step: (b: Boot) => unknown,
  check: (b: Boot, committed: boolean) => void,
) {
  const loaded = await loadBundle("reminders-strongholds", { testMode: true });
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
    const committed = stateDigest(b.db.$client).sha256;
    expect(committed).not.toBe(before);
    b.close();
    b = await boot(loaded.openDb);
    expect(stateDigest(b.db.$client).sha256).toBe(committed);
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

test("FR-REM-31 crash: a facility removal and its reminders' deletes are one transaction", async () => {
  await crashBoth(
    "hold.removeFacility",
    (b) => {
      const g = holdByName(b, GREYSTONE.name);
      const steam = g?.facilities.find((f) => f.name === "Steam Rooms");
      return b.s.commands.run(
        "hold.removeFacility",
        { strongholdId: g?.id, facilityId: steam?.id },
        dm(b),
      );
    },
    (b, committed) => {
      const g = holdByName(b, GREYSTONE.name);
      const hasSteam = g?.facilities.some((f) => f.name === "Steam Rooms");
      const rem = b.db.select().from(reminder).where(eq(reminder.text, STEAM_ROOMS_TEXT)).get();
      expect([hasSteam, rem !== undefined]).toEqual(committed ? [false, false] : [true, true]);
    },
  );
}, 120_000);

test("FR-REM-31 crash: rem.save commits with its event-log row or not at all", async () => {
  await crashBoth(
    "rem.save",
    (b) =>
      b.s.commands.run("rem.save", { target: { kind: "party" }, text: "CRASH-REMINDER" }, dm(b)),
    (b, committed) => {
      const rows = b.db.select().from(reminder).where(eq(reminder.text, "CRASH-REMINDER")).all();
      expect(rows).toHaveLength(committed ? 1 : 0);
    },
  );
}, 120_000);

test("FR-HOLD-39 crash: hold.delete (reminders, Stores moves, row) commits whole or not at all", async () => {
  let potGp = 0;
  await crashBoth(
    "hold.delete",
    (b) => {
      potGp = partyPot(b.db, cid(b)).gp;
      return b.s.commands.run(
        "hold.delete",
        { strongholdId: holdByName(b, TOWER.name)?.id },
        dm(b),
      );
    },
    (b, committed) => {
      const tower = holdByName(b, TOWER.name);
      const item = b.db
        .select()
        .from(partyItem)
        .where(and(eq(partyItem.campaignId, cid(b)), eq(partyItem.name, TOWER.item)))
        .get();
      expect(tower === undefined).toBe(committed);
      // The item is in the Stores or in the party, never lost or doubled.
      expect(item?.qty).toBe(1);
      expect(item?.strongholdId ?? null).toBe(committed ? null : (tower?.id as string));
      expect(partyPot(b.db, cid(b)).gp).toBe(committed ? potGp + 5 : potGp);
      const [held, outside] = coinConservation(b.db, cid(b));
      expect(held).toEqual(outside);
      // Entities untouched (sanity: the delete writes no character data).
      expect(b.db.select().from(entity).all().length).toBeGreaterThan(0);
    },
  );
}, 120_000);

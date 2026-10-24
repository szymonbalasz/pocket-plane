// Sprint 11 F3 (BL-110, FR-CBT-50) over a real socket on `f3-combat-dice` (`fu-s7` + Goblin 2,
// Mira's charmed `after-owner` companion, and Brakka's `in-owner-turn` Drake Companion at 0):
// the DM client's own skip helper over the DM's live store, Next by Next, as the Initiative and
// the palette send it. Repro (sim-14 glitch 5): Goblin 2 was already named; the drake (no rank)
// was skipped silently. No server, event or frame change: the cue is DM-client-only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import {
  COMBATANT_TYPE,
  type CombatantView,
  ENCOUNTER_TYPE,
  type EncounterRecord,
} from "@shared/combat-tracker/schemas";
import { skipText, stepSkip } from "@ui/features/combat-extras/skip";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";

const DM = { role: "dm" as const, secret: TEST_SECRET };

async function ack(c: TestClient, name: string, payload: unknown): Promise<unknown> {
  const id = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 3000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === id) {
      if (f.type === "reject") throw new Error(`${name} rejected: ${JSON.stringify(f)}`);
      return f.result;
    }
  }
}
const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};

describe("BL-110 skip cue on f3-combat-dice over WS", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;

  beforeAll(async () => {
    const loaded = await loadBundle("f3-combat-dice", { dmSecret: TEST_SECRET, testMode: true });
    expect(loaded.manifest.status).toBe("complete");
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    h = await startTestServer({ db, fake: false });
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

  test("FR-CBT-50 BL-110 Next names the down in-turn Drake on Brakka's turn and Goblin 2 (after Mira) past Mira; after a DM reconnect too", async () => {
    let dm = await h.connect(DM);
    await dm.next("snapshot");
    const enc = () =>
      (Object.values(dm.store.records[ENCOUNTER_TYPE] ?? {}) as EncounterRecord[]).find(
        (e) => e.status === "started",
      ) as EncounterRecord;
    const rows = () =>
      (Object.values(dm.store.records[COMBATANT_TYPE] ?? {}) as CombatantView[]).filter(
        (c) => c.encounterId === enc().id && c.active !== false,
      );
    const named = (name: string) => rows().find((c) => c.name === name) as CombatantView;
    expect(named("Goblin 2")).toMatchObject({ hpCurrent: 0, turnMode: "after-owner" });
    expect(named("Drake Companion")).toMatchObject({
      hpCurrent: 0,
      turnMode: "in-owner-turn",
      position: null,
    });
    const turnName = () => rows().find((c) => c.id === enc().turnCombatantId)?.name;
    expect(turnName()).toBe("Wolf");

    /** One DM Next: the toast text the client shows once it's acked, and where the turn went. */
    const next = async () => {
      const e = enc();
      const { skipped, dead } = stepSkip(dm.store, rows(), e, "next");
      await ack(dm, "cbt.nextTurn", {
        encounterId: e.id,
        expectedRound: e.round,
        expectedTurnId: e.turnCombatantId,
      });
      await barrier(dm);
      return [turnName(), skipped ? skipText(skipped, dead) : null];
    };
    expect(await next()).toEqual(["Brakka", "Skipped Drake Companion (down)"]);
    expect(await next()).toEqual(["Mira", null]);
    // A reload (sim-14 used the palette after a DM reload): the snapshot gives the same cue.
    dm.close();
    dm = await h.connect(DM);
    await dm.next("snapshot");
    expect(await next()).toEqual(["Owlbear", "Skipped Goblin 2 (down)"]);
    dm.close();
  }, 120_000);
});

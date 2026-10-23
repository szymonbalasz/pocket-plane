// FR-STATS-68 (sprint 9, FX1; BL-84, sim-12 h) over real sockets on `stats-b`: the DM's direct
// damage kills the hidden Wolf (`hp` line), then Thorn's card (player-2's roll, the DM's Apply)
// kills the hidden Elite (overkill 15). The frames each client got go through the real feed
// (`onStatsFrame` → `showFeedToast` → `showCallout`) into a registered toast memory, and the
// callout is drawn as the runtime draws it. Repro finding: both lines reach the DM as **new**
// log lines carrying `fell` (the card's line is written at Apply, not an upsert of the roll's), so
// server, frame and parse were fine; the second callout replaced the first in one unkeyed node
// (FR-NOTE-73 fixes it). Players get no line for either, so no callout.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import {
  type AttackResult,
  CBT_INTENTS,
  parseFullCard,
  partRollIdsOf,
} from "@shared/combat-tracker/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { Credential, EventFrame, ServerFrame } from "@shared/protocol/frames";
import { CalloutToast } from "@ui/features/notifications/ToastRuntime";
import { createToastMemory, registerToastMemory } from "@ui/features/notifications/toasts";
import { createFeed } from "@ui/features/stats/feed";
import { onStatsFrame, showFeedToast } from "@ui/features/stats/runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { closeDb, type Db } from "../../db/client";
import { combatant, player } from "../../db/schema";
import {
  startTestServer,
  TEST_SECRET,
  type TestClient,
  type TestServer,
} from "../../testing/harness";

let h: TestServer;
let db: Db;
let cleanup: () => void;
let tokens: Record<string, string>;
let combatants: Record<string, string>;

beforeAll(async () => {
  const loaded = await loadBundle("stats-b", { testMode: true, dmSecret: TEST_SECRET });
  cleanup = loaded.cleanup;
  db = loaded.openDb();
  tokens = Object.fromEntries(
    db
      .select()
      .from(player)
      .all()
      .map((r) => [r.name, r.linkToken]),
  );
  // The ambush's combatants (later rows win).
  combatants = Object.fromEntries(
    db
      .select()
      .from(combatant)
      .all()
      .map((c) => [c.name, c.id]),
  );
  h = await startTestServer({ db, testMode: true, fake: false });
}, 60_000);

afterAll(async () => {
  await h.stop();
  closeDb(db);
  try {
    cleanup();
  } catch {
    // Windows may hold the WAL briefly; a leftover temp dir is harmless.
  }
});

const DM: Credential = { role: "dm", secret: TEST_SECRET };
const player2 = (): Credential => ({ role: "player", token: tokens["Player 2"] as string });

async function reply(c: TestClient, name: string, payload: unknown) {
  const intentId = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 3000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}
async function result(c: TestClient, name: string, payload: unknown): Promise<unknown> {
  const f = await reply(c, name, payload);
  if (f.type !== "ack") throw new Error(JSON.stringify(f));
  return f.result;
}
const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
const events = (frames: readonly ServerFrame[]) =>
  frames.filter((f): f is EventFrame => f.type === "event");

/** One page's feed into a registered toast memory (batch timers run by hand). */
function page(role: "dm" | "player") {
  const due: (() => void)[] = [];
  const memory = createToastMemory(0);
  const off = registerToastMemory(memory);
  const feed = createFeed({
    show: showFeedToast,
    timers: { setTimeout: (fn) => due.push(fn), clearTimeout: () => {} },
  });
  const seen = new Set<string>();
  /** The callout as drawn after this frame: its node's seq and its feed lines. */
  const push = (frame: EventFrame) => {
    onStatsFrame(frame, {
      role,
      prefs: { feed: true, openSummary: false },
      feed,
      openAwards: () => {},
      openFight: () => {},
      wait: () => {},
      initiative: undefined,
      gate: { paused: () => false, deferUntilResume: () => {} },
      seen,
    });
    for (const fn of due.splice(0)) fn();
    const c = memory.getState().toasts.callout;
    if (!c) return null;
    const html = renderToStaticMarkup(<CalloutToast c={c} onClose={() => {}} />);
    return {
      seq: Number(/data-callout-seq="(\d+)"/.exec(html)?.[1]),
      lines: [...html.matchAll(/data-testid="stats-feed-line">([^<]*)</g)].map((m) => m[1]),
    };
  };
  return { push, off };
}

describe("FR-STATS-68 hidden kill reaches the DM's feed (real frames, stats-b)", () => {
  test("FR-STATS-68 hidden kill reaches the DM's feed: the DM's direct hp line (Wolf) and the card Apply (Elite, overkill 15) each show '(hidden)', the second as a new callout node; players none", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live({ role: "player", token: tokens["Player 1"] as string });
    const p2 = await h.live(player2());
    const from = { dm: dm.frames.length, p1: p1.frames.length, p2: p2.frames.length };
    // The DM's direct damage kills the hidden Wolf (8 HP).
    await result(dm, CBT_INTENTS.applyHp, {
      combatantId: combatants.Wolf,
      kind: "damage",
      amount: 12,
      public: false,
    });
    const afterWolf = dm.frames.length;
    // Thorn's card (player-2): to-hit 15 + 5, damage 3 + 3; the DM applies 30 to the hidden
    // Elite (15 HP): overkill 15.
    const { cardId } = (await result(p2, CBT_INTENTS.attack, {
      attackerId: combatants.Thorn,
      manual: [{ diceTotal: 15 }, { diceTotal: 3 }],
    })) as AttackResult;
    await barrier(dm);
    const card = dm.store.records.notification?.[cardId] as NotificationRecord;
    const pay = parseFullCard(card.payload);
    await result(dm, CBT_INTENTS.applyCard, {
      cardId,
      toHitTotal: pay.toHit.total,
      damageTotal: 30,
      damageRollId: pay.damage.rollId,
      partRollIds: partRollIdsOf(pay),
      targets: [{ targetId: combatants["Elite Goblin Warrior"], hit: true, multiplier: "normal" }],
    });
    for (const c of [dm, p1, p2]) await barrier(c);

    const shown = page("dm");
    try {
      const wolf = events(dm.frames.slice(from.dm, afterWolf))
        .map(shown.push)
        .find((x) => x !== null);
      expect(wolf?.lines).toEqual(["Wolf falls (hidden)"]);
      const drawn = events(dm.frames.slice(afterWolf)).map(shown.push);
      const elite = drawn.at(-1);
      expect(elite?.lines).toEqual([
        "Overkill! Thorn finished Elite Goblin Warrior, overkill 15 (hidden)",
      ]);
      // A new node (FR-NOTE-73): the feed showed exactly one more callout.
      expect(elite?.seq).toBe((wolf?.seq ?? 0) + 1);
    } finally {
      shown.off();
    }

    for (const [c, start] of [
      [p1, from.p1],
      [p2, from.p2],
    ] as const) {
      const theirs = page("player");
      try {
        expect(events(c.frames.slice(start)).map(theirs.push)).toEqual(
          events(c.frames.slice(start)).map(() => null),
        );
      } finally {
        theirs.off();
      }
    }
    for (const c of [dm, p1, p2]) c.close();
  });
});

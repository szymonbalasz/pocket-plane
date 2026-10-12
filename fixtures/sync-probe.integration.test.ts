// Integration on the real `sync-probe` / `campaign-switch` bundles (SYNC §13, CAMP §13).
import { afterAll, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import { player } from "@server/db/schema";
import { startTestServer, TEST_SECRET } from "@server/testing/harness";
import type { ProbeRecord } from "@shared/live-sync/schemas";
import { recordsOf } from "@shared/protocol/store";
import { loadBundle } from "./index";

const cleanups: (() => void | Promise<void>)[] = [];
afterAll(async () => {
  for (const c of cleanups.reverse()) await c();
});

async function boot(bundle: string) {
  const r = await loadBundle(bundle, { testMode: true });
  cleanups.push(r.cleanup);
  const db = r.openDb();
  cleanups.push(() => closeDb(db));
  const h = await startTestServer({ db, testMode: true });
  cleanups.push(() => h.stop());
  const tokens = Object.fromEntries(
    db
      .select()
      .from(player)
      .all()
      .map((p) => [p.name, p.linkToken]),
  );
  return { h, tokens };
}

test("sync-probe bundle: DM sees 3 probes; Player 1 sees public + mine; Player 2 sees public; no SECRET-PROBE leak", async () => {
  const { h, tokens } = await boot("sync-probe");
  const dm = await h.live({ role: "dm", secret: TEST_SECRET });
  const b = await h.live({ role: "player", token: tokens["Player 1"] as string });
  const c = await h.live({ role: "player", token: tokens["Player 2"] as string });
  const texts = (x: typeof dm) =>
    recordsOf<ProbeRecord>(x.store, "probe")
      .map((p) => p.text)
      .sort();
  expect(texts(dm)).toEqual(["SECRET-PROBE", "mine", "public"]);
  expect(texts(b)).toEqual(["mine", "public"]);
  expect(texts(c)).toEqual(["public"]);
  for (const x of [b, c]) expect(x.raw()).not.toContain("SECRET-PROBE");
  const second = await h.connect({ role: "player", token: tokens["Second Player"] as string });
  expect((await second.closed).code).toBe(4409);
});

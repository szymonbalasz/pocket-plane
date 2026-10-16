// Test support for dice-extras: the sync-probe seed (Fixture Campaign with two players, Second
// Campaign with one), events captured, a command runner and the per-viewer snapshot.

import { CommandError } from "../../commands/errors";
import type { Actor, DispatchedEvent } from "../../events/types";
import { seedSyncProbe } from "../../testing/seed";
import { createTestServices, DM_ACTOR } from "../../testing/services";
import type { Viewer } from "../../ws/records";

export function dicexSetup() {
  const s = createTestServices();
  const h = seedSyncProbe(s);
  const events: DispatchedEvent[] = [];
  s.bus.subscribe("test-capture", (e) => events.push(e));
  const dm: Actor = { ...DM_ACTOR, campaignId: h.campaignId };
  const dmSecond: Actor = { ...DM_ACTOR, campaignId: h.secondCampaignId };
  const player = (id: string, campaignId = h.campaignId): Actor => ({
    role: "player",
    playerId: id,
    campaignId,
  });
  const run = <R = unknown>(name: string, input: unknown, actor: Actor = dm) =>
    s.commands.run(name, input, { actor }) as R;
  const err = (fn: () => unknown): CommandError => {
    try {
      fn();
    } catch (e) {
      if (e instanceof CommandError) return e;
      throw e;
    }
    throw new Error("expected a CommandError");
  };
  const viewer = (role: "dm" | "player", playerId: string | null = null, cid = h.campaignId) =>
    ({ connId: "test", campaignId: cid, role, playerId }) satisfies Viewer;
  const snapshot = (v: Viewer) => s.records.snapshot({ db: s.db, presence: { list: () => [] } }, v);
  return { s, h, events, dm, dmSecond, player, run, err, viewer, snapshot };
}

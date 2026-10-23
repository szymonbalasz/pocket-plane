// Test support for session-recap: stats' started ambush (Mira = Player 1, Thorn = Player 2; Goblin,
// Goblin 2 visible; Wolf, Elite hidden) with helpers to query and share a recap and to write loot.
import {
  type DmRecap,
  type DmRecapResult,
  type PlayerRecap,
  RECAP_QUERY_INTENT,
  RECAP_SHARE_INTENT,
  type RecapShareInput,
  type RecapShareResult,
} from "@shared/session-recap/schemas";
import type { Actor } from "../../events/types";
import { LOOT_ADD, LOOT_MOVE } from "../party-loot/commands";
import { statsSetup } from "../stats/testing";
import { recapMemory } from "./index";

export function recapSetup() {
  const t = statsSetup();
  /** One `recap.query` as `actor` (default the DM), past the rate window. */
  const recap = <R extends DmRecap | PlayerRecap = DmRecap>(actor: Actor = t.h.dm, n?: number) => {
    t.clock.advance(1000);
    return t.run<DmRecapResult>(RECAP_QUERY_INTENT, n === undefined ? {} : { n }, actor)
      .recap as R | null;
  };
  const share = (input: RecapShareInput, actor: Actor = t.h.dm) =>
    t.run<RecapShareResult>(RECAP_SHARE_INTENT, input, actor);
  const loot = (input: Record<string, unknown>) => t.run<{ entryId: string }>(LOOT_ADD, input);
  const move = (input: Record<string, unknown>) => t.run<{ entryId: string }>(LOOT_MOVE, input);
  const gate = () => recapMemory(t.s);
  return { ...t, recap, share, loot, move, gate };
}

export type RecapSetup = ReturnType<typeof recapSetup>;

// FR-DICEX-89: a new prompt of this player plays alert key `request` (FR-SHELL-130; no flash),
// once per frame however many prompts it carries. Live event frames only (`NotificationCreated`),
// never a snapshot: prompts restored after a reload stay silent (FR-DICEX-91). Run by the dice
// runtime (`DiceExtrasRuntime`), mounted in both clients; the DM's prompts are never theirs.
import { ROLL_REQUEST_KIND } from "@shared/dice-extras/request-names";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { WireChange, You } from "@shared/protocol/frames";
import { type RecordStore, recordsOf } from "@shared/protocol/store";
import { useEventFrame } from "../../sync/store";
import { useAlertSound } from "../play-shell/AlertLayer";

/** Does this frame create a pending prompt whose action is `you`'s? */
export function promptArrived(
  f: { cause: { name: string }; changes: readonly WireChange[] },
  you: Pick<You, "role" | "playerId"> | null,
): boolean {
  if (f.cause.name !== "NotificationCreated" || you?.role !== "player") return false;
  return f.changes.some((c) => {
    const n = c.data as
      | { kind?: string; state?: string; actionPlayerId?: string | null }
      | undefined;
    return (
      c.type === "notification" &&
      c.op === "upsert" &&
      n?.kind === ROLL_REQUEST_KIND &&
      n.state === "pending" &&
      n.actionPlayerId === you.playerId
    );
  });
}

/**
 * This player's open prompts (pending `roll-request` rows they own). For the pause catch-up
 * (FR-DICEX-90, seams S10: restored at resume with one `request` sound) and any surface that
 * needs them; the DM owns none.
 */
export function pendingPrompts(store: RecordStore): NotificationRecord[] {
  const you = store.you;
  if (you?.role !== "player") return [];
  return recordsOf<NotificationRecord>(store, "notification").filter(
    (n) =>
      n.kind === ROLL_REQUEST_KIND && n.state === "pending" && n.actionPlayerId === you.playerId,
  );
}

export function useRequestSound(): void {
  const play = useAlertSound();
  useEventFrame((f, store) => {
    if (promptArrived(f, store.you)) play("request");
  });
}

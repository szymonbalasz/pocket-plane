// FR-DICE-60, -61 (OQ-DICE-39 A′, OQ-DICE-40 A): a `roll` line's actor name in the roller's
// player colour, read from the entry's `rollerRole` / `rollerPlayerId` (never its payload);
// every other kind, the system actor and a roller without a `player` record stay neutral (the
// default text colour: no role accent in text). The log and the roll popup share the rule.
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryView } from "@shared/dice-roll-log/schemas";
import { useCallback } from "react";
import { useSync } from "../../sync/store";
import { type ColorPerson, colorHex, colorKeyOf } from "../campaign-management/colors";

export type ColorKeyOf = (person: ColorPerson) => string | null;

/**
 * `colorKeyOf` bound to the live store: re-renders on a `player` / `campaign` change (a colour
 * change recolours every name and stripe, OQ-CAMP-21), not on other events.
 */
export function useColorKeyOf(): ColorKeyOf {
  const player = useSync((s) => s.store.records.player);
  const campaign = useSync((s) => s.store.records.campaign);
  const you = useSync((s) => s.store.you);
  return useCallback(
    (person: ColorPerson) =>
      colorKeyOf({ you, records: { player: player ?? {}, campaign: campaign ?? {} } }, person),
    [player, campaign, you],
  );
}

type RollerFields = Pick<GameLogEntryView, "kind" | "rollerRole" | "rollerPlayerId">;

/** FR-DICE-60: the roller's key on a `roll` entry; null (neutral) for every other kind. */
export const rollerColorKey = (keyOf: ColorKeyOf, e: RollerFields): string | null =>
  e.kind === "roll" ? keyOf({ role: e.rollerRole, playerId: e.rollerPlayerId }) : null;

/** `data-roller`: the roller's player id, or `dm`. */
export const rollerAttr = (e: RollerFields): string =>
  e.rollerRole === "player" ? (e.rollerPlayerId ?? "") : "dm";

/** OQ-DICE-40 A: the roll popup row's name, coloured as its log line (FR-DICEX-40). */
export function RollerName({ entryId, name }: { entryId: string; name: string }) {
  const e = useSync((s) => s.store.records[GAME_LOG_ENTRY_TYPE]?.[entryId]) as
    | GameLogEntryView
    | undefined;
  const keyOf = useColorKeyOf();
  const key = e ? rollerColorKey(keyOf, e) : null;
  return (
    <strong
      data-testid="dicex-popup-actor"
      data-color={key ?? undefined}
      className="shrink-0 font-semibold"
      style={key ? { color: colorHex(key) } : undefined}
    >
      {name}
    </strong>
  );
}

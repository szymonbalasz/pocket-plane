// DM `dice.details` window (FR-DICE-106, -108): the shared details body + the DM's facts in its
// footer: who can see the line, skipped-trigger notes, the card that used the roll. DM bundle only.
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import { type GameLogEntryView, RollEntryDmPayload } from "@shared/dice-roll-log/schemas";
import { RollDetails } from "@ui/features/dice-roll-log/RollDetails";
import { diceDetailsWindowBase } from "@ui/features/dice-roll-log/window";
import { defineWindow } from "@ui/features/play-shell/registry";
import { useRecords } from "@ui/sync/store";

/** FR-DICE-108: who can see the line: "Public", "DM only", "DM + <player>". */
export function audienceText(
  e: Pick<GameLogEntryView, "public" | "audiencePlayerId">,
  players: readonly Pick<PlayerRecord, "id" | "name">[],
): string {
  if (e.public) return "Public";
  if (!e.audiencePlayerId) return "DM only";
  const name = players.find((p) => p.id === e.audiencePlayerId)?.name;
  return `DM + ${name ?? "a player"}`;
}

export function DmDetailsExtras({ e }: { e: GameLogEntryView }) {
  const players = useRecords<PlayerRecord>("player");
  const dm = RollEntryDmPayload.safeParse(e.dmPayload ?? null).data;
  return (
    <>
      <span aria-hidden>·</span>
      <span data-testid="dice-details-audience">{audienceText(e, players)}</span>
      {dm?.usedByCardId && (
        <span data-testid="dice-details-used" className="basis-full">
          Used by a damage card
        </span>
      )}
      {dm?.notes?.map((n) => (
        <span key={n} data-testid="dice-details-dm-note" className="basis-full">
          {n}
        </span>
      ))}
    </>
  );
}

function DmDetailsBody() {
  return <RollDetails Extras={DmDetailsExtras} />;
}

export const dmDiceDetailsWindow = defineWindow({
  ...diceDetailsWindowBase,
  clients: ["dm"],
  component: DmDetailsBody,
});

// DM `dice.details` window (FR-DICE-106, -108): the shared details body + the DM's facts: who can
// see the line, skipped-trigger notes, the card that used the roll. In the DM bundle only.
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
    <div data-testid="dice-details-dm" className="flex flex-col gap-1 border-t pt-2 text-xs">
      <p>
        <span className="text-muted-foreground">Who can see this: </span>
        <span data-testid="dice-details-audience">{audienceText(e, players)}</span>
      </p>
      {dm?.usedByCardId && (
        <p data-testid="dice-details-used" className="text-muted-foreground">
          Used by a damage card
        </p>
      )}
      {dm?.notes?.map((n) => (
        <p key={n} data-testid="dice-details-dm-note" className="text-muted-foreground">
          {n}
        </p>
      ))}
    </div>
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

// The roll-request prompt views (FR-NOTE-59, -61; FR-DICEX-83), kind `roll-request`. Player:
// "DM: ‹label›" (+ "· DC n" iff shown); while pending and theirs, **Roll** is a roll button over
// the expression the server will build (`characterRolls`), so Shift / Ctrl, physical dice and
// Alt → tray (expression locked: a `control` request) work, sending `dicex.answerRequest`; and
// **Decline**. Resolved rows read "Rolled 17" / "Declined" / "Closed". DM: "‹PC› · ‹label›", no
// toast (player-owned action), no token cue, no action. A small lazy chunk preloaded at idle
// (`PromptViews.tsx` holds the view defs, DICEX §12 initial budget).
import { CREATURE_SHEET_TYPE, type CreatureSheetRecord } from "@shared/character-sheet/sheet";
import { DICEX_REQUEST_INTENTS, REQUEST_CATEGORY } from "@shared/dice-extras/request-names";
import { type CharacterStatBlock, ENTITY_TYPE } from "@shared/entities/schemas";
import { isActionOwner, type NotificationRecord } from "@shared/notifications/schemas";
import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { useSync } from "../../sync/store";
import { toastIntentError } from "../combat-tracker/store";
import { RollButton, useRollControl } from "../dice-roll-log/roll-control";
import {
  answerIntent,
  promptExpression,
  promptOutcome,
  promptPayload,
  promptSubject,
} from "./prompt-logic";

type Payload = NonNullable<ReturnType<typeof promptPayload>>;

function Outcome({ n }: { n: NotificationRecord }) {
  const outcome = promptOutcome(n);
  return outcome ? (
    <span data-testid="dicex-prompt-outcome" className="text-xs text-muted-foreground">
      {outcome}
    </span>
  ) : null;
}

/** Roll + Decline of a pending prompt the viewer owns. */
function PromptActions({ n, p }: { n: NotificationRecord; p: Payload }) {
  const live = useSync((s) => s.state === "live");
  const connection = useSync((s) => s.connection);
  const stats = useSync(
    (s) =>
      (
        s.store.records[ENTITY_TYPE]?.[p.characterId] as
          | { statBlock?: CharacterStatBlock }
          | undefined
      )?.statBlock ?? null,
  );
  const sheets = useSync((s) => s.store.records[CREATURE_SHEET_TYPE]);
  const sheet =
    (Object.values(sheets ?? {}) as CreatureSheetRecord[]).find(
      (x) => x.entityId === p.characterId,
    ) ?? null;
  const [busy, setBusy] = useState(false);
  const send = (name: string, payload: unknown) => {
    setBusy(true);
    connection
      .sendIntent(name, payload)
      .catch(toastIntentError)
      .finally(() => setBusy(false));
  };
  const subject = useMemo(() => promptSubject(p.roll, p.characterId), [p.roll, p.characterId]);
  const control = useRollControl({
    expressions: [promptExpression(p.roll, stats, sheet)],
    category: REQUEST_CATEGORY[p.roll.kind],
    label: `${p.characterName} — ${p.label}`,
    mode: p.mode,
    ...(subject ? { subject } : {}),
    onRoll: (r) => send(DICEX_REQUEST_INTENTS.answerRequest, answerIntent(p, r)),
  });
  const off = !live || busy;
  return (
    <span className="flex items-center justify-end gap-1.5">
      <Button
        type="button"
        data-testid="dicex-prompt-decline"
        data-record-id={n.id}
        size="sm"
        variant="ghost"
        className="h-7"
        disabled={off}
        onClick={() =>
          send(DICEX_REQUEST_INTENTS.declineRequest, {
            requestId: p.requestId,
            characterId: p.characterId,
          })
        }
      >
        Decline
      </Button>
      <RollButton
        control={control}
        hint="Shift: advantage · Ctrl: disadvantage"
        data-testid="dicex-prompt-roll"
        data-record-id={n.id}
        size="sm"
        className="h-7"
        disabled={off}
      >
        Roll
      </RollButton>
    </span>
  );
}

export function PlayerPrompt({ notification: n }: { notification: NotificationRecord }) {
  const you = useSync((s) => s.store.you);
  const p = promptPayload(n);
  const mine =
    n.state === "pending" &&
    !!you &&
    isActionOwner(n, { role: you.role === "dm" ? "dm" : "player", playerId: you.playerId });
  return (
    <span
      data-testid="dicex-prompt"
      data-record-id={n.id}
      data-state={n.state}
      className="flex flex-col gap-1.5"
    >
      <span>{n.text}</span>
      {p && mine && <PromptActions n={n} p={p} />}
      <Outcome n={n} />
    </span>
  );
}

export function DmPrompt({ notification: n }: { notification: NotificationRecord }) {
  const p = promptPayload(n);
  return (
    <span
      data-testid="dicex-prompt"
      data-record-id={n.id}
      data-state={n.state}
      className="flex flex-col"
    >
      <span>{p ? `${p.characterName} · ${p.label}` : n.text}</span>
      <Outcome n={n} />
    </span>
  );
}

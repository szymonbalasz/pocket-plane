// The roll-request prompt views (FR-NOTE-59, -61; FR-DICEX-83), kind `roll-request`. Player:
// "DM: ‹label› · ‹PC›" (+ "· DC n" iff shown); while pending and theirs, **Roll** is a roll button over
// the expression the server will build (`characterRolls`), so Shift / Ctrl, physical dice and
// Alt → tray (expression locked: a `control` request) work, sending `dicex.answerRequest`; and
// **Decline**. Resolved rows read "Rolled 17" / "Declined" / "Closed". DM: "‹PC› · ‹label›", no
// toast (player-owned action), no token cue, no action. A small lazy chunk preloaded at idle
// (`PromptViews.tsx` holds the view defs, DICEX §12 initial budget). Sprint 11 (BL-112): an answer
// staged in the tray puts the tray back as it was before the stage once the prompt is spent.
// Kit parity K9 (K6 gap 9): the player's card reads as the kit toast: Roll + Decline right of the
// text (wrapping below only when narrow), so the card's time line sits under the text; Decline
// is a small stone button.
import { CREATURE_SHEET_TYPE, type CreatureSheetRecord } from "@shared/character-sheet/sheet";
import { DICEX_REQUEST_INTENTS, REQUEST_CATEGORY } from "@shared/dice-extras/request-names";
import { type CharacterStatBlock, ENTITY_TYPE } from "@shared/entities/schemas";
import { isActionOwner, type NotificationRecord } from "@shared/notifications/schemas";
import { useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { useSync } from "../../sync/store";
import { toastIntentError } from "../combat-tracker/store";
import { RollButton, type RollRequest, useRollControl } from "../dice-roll-log/roll-control";
import { TOAST_STACK_Z } from "../notifications/ToastRuntime";
import { useOpenWindow } from "../play-shell/ShellContext";
import {
  answerIntent,
  promptExpression,
  promptOutcome,
  promptPayload,
  promptSubject,
} from "./prompt-logic";
import { diceExtras } from "./store";
import { DICEX_REQUESTS_KIND } from "./window-kind";

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
  /**
   * BL-112: an acked answer or decline spends the prompt; if the tray holds its answer (Alt →
   * tray), the tray goes back as it was before that stage (FR-DICEX-83).
   */
  const send = (name: string, payload: unknown) => {
    setBusy(true);
    connection
      .sendIntent(name, payload)
      .then(() => {
        if (diceExtras.holds(onRoll)) diceExtras.restoreTray();
      })
      .catch(toastIntentError)
      .finally(() => setBusy(false));
  };
  // One `onRoll` for the prompt's life, so the tray's staged copy is known as this answer.
  const answer = useRef((_r: RollRequest) => {});
  answer.current = (r) => send(DICEX_REQUEST_INTENTS.answerRequest, answerIntent(p, r));
  const [onRoll] = useState(() => (r: RollRequest) => answer.current(r));
  const subject = useMemo(() => promptSubject(p.roll, p.characterId), [p.roll, p.characterId]);
  const control = useRollControl({
    expressions: [promptExpression(p.roll, stats, sheet)],
    category: REQUEST_CATEGORY[p.roll.kind],
    label: `${p.characterName} — ${p.label}`,
    mode: p.mode,
    ...(subject ? { subject } : {}),
    onRoll,
  });
  const off = !live || busy;
  return (
    <span className="ml-auto flex shrink-0 items-center justify-end gap-1.5">
      <Button
        type="button"
        data-testid="dicex-prompt-decline"
        data-record-id={n.id}
        size="sm"
        variant="outline"
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
        // H1 re-test: the prompt is a card toast (`TOAST_STACK_Z`), so its physical-dice form
        // opens above the stack, never under its own card (still below the overlay layer).
        formZ={TOAST_STACK_Z + 1}
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
      className="flex flex-wrap items-center gap-x-2 gap-y-1.5"
    >
      <span className="min-w-0 flex-[1_1_5rem]">{n.text}</span>
      {p && mine && <PromptActions n={n} p={p} />}
      <span className="basis-full empty:hidden">
        <Outcome n={n} />
      </span>
    </span>
  );
}

export function DmPrompt({ notification: n }: { notification: NotificationRecord }) {
  const p = promptPayload(n);
  const open = useOpenWindow();
  return (
    <span
      data-testid="dicex-prompt"
      data-record-id={n.id}
      data-state={n.state}
      className="flex flex-col items-start gap-1"
    >
      <span>{p ? `${p.characterName} · ${p.label}` : n.text}</span>
      <Outcome n={n} />
      {n.state === "pending" && (
        <Button
          type="button"
          data-testid="dicex-prompt-open-requests"
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-xs"
          onClick={() => open(DICEX_REQUESTS_KIND)}
        >
          Open requests
        </Button>
      )}
    </span>
  );
}

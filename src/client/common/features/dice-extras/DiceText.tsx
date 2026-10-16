// `DiceText` (FR-DICEX-29; seams S7): free text with every dice notation as an inline link that
// stages the expression in the dice tray (`free`). Text is rendered as text, never HTML. The only
// notation parser is `findNotation`; other specs' free text imports this component.
import { splitNotation } from "@shared/dice-extras/notation";
import { applyMode, parseExpression } from "@shared/dice-roll-log/grammar";
import type { RollActorRef, RollCategory, RollMode } from "@shared/dice-roll-log/schemas";
import { LABEL_MAX } from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE, type EntityRecord } from "@shared/entities/schemas";
import type { You } from "@shared/protocol/frames";
import { type MouseEvent, useMemo } from "react";
import { Tooltip } from "../../components/ui/overlays";
import { cn } from "../../lib/utils";
import { useRecords, useSync } from "../../sync/store";
import { modeFromKeys } from "../dice-roll-log/logic";
import { stageTray, type TrayRequest } from "./store";

export interface DiceTextContext {
  /** What the dice are for, e.g. the row's name ("Notation test"); ≤ 60 chars. */
  label?: string;
  /** Default `other`. */
  category?: RollCategory;
  /** The creature the text belongs to: the actor, if this viewer may roll as it (FR-DICE-10). */
  creature?: { entityId: string } | null;
}

type ActorEntity = Pick<EntityRecord, "id" | "kind" | "ownerPlayerId">;

/** FR-DICE-10: the DM may roll as any creature; a player only as a character they own. */
export function actorFor(
  creature: DiceTextContext["creature"],
  you: Pick<You, "role" | "playerId"> | null,
  entities: readonly ActorEntity[],
): RollActorRef | undefined {
  if (!creature || !you) return undefined;
  if (you.role === "dm") return { entityId: creature.entityId };
  const e = entities.find((x) => x.id === creature.entityId);
  return e && e.kind === "character" && e.ownerPlayerId === you.playerId
    ? { entityId: creature.entityId }
    : undefined;
}

/**
 * FR-DICEX-29: the tray request a notation click stages. Shift / Ctrl preselect adv / dis only
 * when the expression has a `1d20` (FR-DICE-04).
 */
export function notationRequest(
  expression: string,
  context: DiceTextContext,
  keys: { shiftKey?: boolean; ctrlKey?: boolean },
  actor: RollActorRef | undefined,
): TrayRequest {
  let mode: RollMode = modeFromKeys(keys, "normal");
  const terms = parseExpression(expression);
  if (mode !== "normal" && !(terms.ok && applyMode(terms.value, mode).ok)) mode = "normal";
  const label = context.label?.trim().slice(0, LABEL_MAX);
  return {
    kind: "free",
    expression,
    mode,
    category: context.category ?? "other",
    ...(label ? { label } : {}),
    ...(actor ? { actor } : {}),
  };
}

/** Notation link hint (Tooltip, FR-SHELL-30: no native titles). */
const HINT = "Adjust and roll in the dice tray · Shift: advantage · Ctrl: disadvantage";

export function DiceText({
  text,
  context = {},
  className,
}: {
  text: string;
  context?: DiceTextContext;
  className?: string;
}) {
  const parts = useMemo(() => splitNotation(text), [text]);
  const you = useSync((s) => s.store.you);
  const entities = useRecords<EntityRecord>(ENTITY_TYPE);
  const stage = (expression: string, e: MouseEvent) => {
    const actor = actorFor(context.creature, you, entities);
    stageTray(notationRequest(expression, context, e, actor));
  };
  return (
    <span className={cn("whitespace-pre-wrap", className)}>
      {parts.map((p, i) =>
        p.expression === undefined ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional per text
          <span key={i}>{p.text}</span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional per text
          <Tooltip key={i} content={HINT}>
            <button
              type="button"
              data-testid="dicex-notation"
              data-value={p.expression}
              className="inline rounded-sm px-0.5 font-medium text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={(e) => stage(p.expression as string, e)}
            >
              {p.text}
            </button>
          </Tooltip>
        ),
      )}
    </span>
  );
}

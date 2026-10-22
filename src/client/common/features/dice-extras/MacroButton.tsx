// One macro row (FR-DICEX-68, -69, -72; FR-CHARX-88): the name is a roll button (`RollButton` +
// `useRollControl`) sending a plain `dice.roll`, so Shift / Ctrl, physical dice, Alt → tray, the
// throw and the popup work as for any roll; the expression; ✎ when the viewer may edit it.
// Disabled with the reason while not live, for a gone creature or one the viewer can't roll as.
// In the initial chunk with the prompt (DICEX §12); the list, editor and Requests window are lazy.
import type { RollMacroRecord } from "@shared/dice-extras/macros";
import { PencilIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useSync } from "../../sync/store";
import { toastIntentError } from "../combat-tracker/store";
import { RollButton, useRollControl } from "../dice-roll-log/roll-control";
import {
  canEditMacro,
  type MacroCreature,
  type MacroViewer,
  macroBlock,
  macroRollIntent,
} from "./macro-logic";

export function MacroRow({
  m,
  viewer,
  creatures,
  onEdit,
}: {
  m: RollMacroRecord;
  viewer: MacroViewer;
  creatures: readonly MacroCreature[];
  onEdit?: (m: RollMacroRecord) => void;
}) {
  const live = useSync((s) => s.state === "live");
  const connection = useSync((s) => s.connection);
  const actor = m.creatureId ? creatures.find((c) => c.id === m.creatureId) : undefined;
  const block = macroBlock(m, viewer, creatures, live);
  const control = useRollControl({
    expressions: [m.expression],
    category: m.category,
    label: actor ? `${actor.name} — ${m.name}` : m.name,
    onRoll: (r) => {
      connection.sendIntent("dice.roll", macroRollIntent(m, r)).catch(toastIntentError);
    },
  });
  return (
    <li
      data-testid="dicex-macro"
      data-record-id={m.id}
      data-creature-id={m.creatureId ?? ""}
      className="flex min-w-0 items-center gap-1.5"
    >
      <RollButton
        control={control}
        hint={block ?? undefined}
        data-testid="dicex-macro-roll"
        data-record-id={m.id}
        size="sm"
        variant="outline"
        className="h-7 min-w-0 max-w-40 justify-start truncate px-2"
        disabled={block !== null}
        data-reason={block ?? undefined}
        title={block ?? undefined}
      >
        {m.name}
      </RollButton>
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
        {m.expression}
      </span>
      {viewer.role === "dm" && m.playerId === null && actor?.kind === "character" && (
        <span
          data-testid="dicex-macro-dm-only-badge"
          className="shrink-0 rounded border px-1 text-[10px] text-muted-foreground"
        >
          DM only
        </span>
      )}
      {onEdit && canEditMacro(m, viewer) && (
        <Button
          type="button"
          data-testid="dicex-macro-edit"
          data-record-id={m.id}
          aria-label={`Edit ${m.name}`}
          size="icon"
          variant="ghost"
          className="size-7 shrink-0"
          onClick={() => onEdit(m)}
        >
          <PencilIcon className="size-3.5" />
        </Button>
      )}
    </li>
  );
}

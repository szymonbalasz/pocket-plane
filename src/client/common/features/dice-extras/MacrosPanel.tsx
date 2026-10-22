// The macro list and editor (FR-DICEX-69–72), shared by the tray's Macros popover and the sheet's
// Macros tab: groups ("‹actor›", other creatures, "General"), each row a roll button with ✎, and
// "+ New macro"; the editor (name, expression with a live check, category, "DM only" for the DM
// on an owned PC, Save, Delete asking once, ↑ / ↓). In the lazy `TableTools` chunk (DICEX §12).
import {
  DICEX_MACRO_INTENTS,
  ROLL_MACRO_TYPE,
  type RollMacroRecord,
} from "@shared/dice-extras/macros";
import { CATEGORY_LABEL, ROLL_CATEGORIES, type RollCategory } from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/controls";
import { Input, Label } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { useRecords, useSync } from "../../sync/store";
import { toastIntentError } from "../combat-tracker/store";
import { MacroRow } from "./MacroButton";
import {
  dmOnlyOffered,
  draftError,
  draftOf,
  type MacroCreature,
  type MacroDraft,
  type MacroViewer,
  macroGroups,
  saveInput,
} from "./macro-logic";

const SELECT =
  "h-7 min-w-0 rounded-md border border-input bg-background px-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/** The viewer, the macros they see, the creatures and players (names) from the store. */
export function useMacroData() {
  const you = useSync((s) => s.store.you);
  const macros = useRecords<RollMacroRecord>(ROLL_MACRO_TYPE);
  const creatures = useRecords<MacroCreature>(ENTITY_TYPE);
  const players = useRecords<{ id: string; name: string }>("player");
  const viewer: MacroViewer = {
    role: you?.role === "dm" ? "dm" : "player",
    playerId: you?.playerId ?? null,
  };
  return { viewer, macros, creatures, players };
}

export function MacroEditor({ draft: initial, onDone }: { draft: MacroDraft; onDone: () => void }) {
  const { viewer, macros, creatures } = useMacroData();
  const live = useSync((s) => s.state === "live");
  const connection = useSync((s) => s.connection);
  const [d, setD] = useState(initial);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const creature = creatures.find((c) => c.id === d.creatureId);
  const offered = dmOnlyOffered(viewer, creature);
  const error = draftError(d);
  const row = d.id ? macros.find((m) => m.id === d.id) : undefined;
  const list = row
    ? macros.filter((m) => m.playerId === row.playerId && m.creatureId === row.creatureId)
    : [];
  const send = async (name: string, payload: unknown, done = true) => {
    setBusy(true);
    try {
      await connection.sendIntent(name, payload);
      if (done) onDone();
    } catch (err) {
      toastIntentError(err);
    } finally {
      setBusy(false);
    }
  };
  const off = !live || busy;
  return (
    <form
      data-testid="dicex-macro-form"
      data-record-id={d.id ?? ""}
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!error && !off) void send(DICEX_MACRO_INTENTS.saveMacro, saveInput(d, offered));
      }}
    >
      <p className="text-xs text-muted-foreground">
        {d.id ? "Edit macro" : "New macro"} ·{" "}
        {creature?.name ?? (viewer.role === "dm" ? "DM" : "Me")}
      </p>
      <Label className="flex flex-col gap-1 text-xs">
        Name
        <Input
          data-testid="dicex-macro-name"
          className="h-7 text-sm"
          maxLength={40}
          value={d.name}
          onChange={(e) => setD({ ...d, name: e.target.value })}
        />
      </Label>
      <Label className="flex flex-col gap-1 text-xs">
        Dice
        <Input
          data-testid="dicex-macro-expression"
          className="h-7 font-mono text-sm"
          placeholder="1d20+4"
          aria-invalid={draftError({ name: "x", expression: d.expression }) !== null}
          value={d.expression}
          onChange={(e) => setD({ ...d, expression: e.target.value })}
        />
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          data-testid="dicex-macro-category"
          aria-label="Category"
          className={SELECT}
          value={d.category}
          onChange={(e) => setD({ ...d, category: e.target.value as RollCategory })}
        >
          {ROLL_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        {offered && (
          <Label className="flex items-center gap-1.5 text-xs">
            <Checkbox
              data-testid="dicex-macro-dm-only"
              checked={d.dmOnly}
              onCheckedChange={(v) => setD({ ...d, dmOnly: v === true })}
            />
            DM only
          </Label>
        )}
      </div>
      {error && (d.name !== "" || d.expression !== "") && (
        <p data-testid="dicex-macro-error" role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-1">
        {row && (
          <>
            <Button
              type="button"
              data-testid="dicex-macro-up"
              aria-label="Move up"
              size="icon"
              variant="ghost"
              className="size-7"
              disabled={off || row.order === 0}
              onClick={() =>
                void send(
                  DICEX_MACRO_INTENTS.moveMacro,
                  { id: row.id, index: row.order - 1 },
                  false,
                )
              }
            >
              <ArrowUpIcon className="size-4" />
            </Button>
            <Button
              type="button"
              data-testid="dicex-macro-down"
              aria-label="Move down"
              size="icon"
              variant="ghost"
              className="size-7"
              disabled={off || row.order >= list.length - 1}
              onClick={() =>
                void send(
                  DICEX_MACRO_INTENTS.moveMacro,
                  { id: row.id, index: row.order + 1 },
                  false,
                )
              }
            >
              <ArrowDownIcon className="size-4" />
            </Button>
            {confirm ? (
              <Button
                type="button"
                data-testid="dicex-macro-delete-confirm"
                size="sm"
                variant="destructive"
                className="h-7"
                disabled={off}
                onClick={() => void send(DICEX_MACRO_INTENTS.deleteMacro, { id: row.id })}
              >
                Delete?
              </Button>
            ) : (
              <Button
                type="button"
                data-testid="dicex-macro-delete"
                size="sm"
                variant="ghost"
                className="h-7"
                disabled={off}
                onClick={() => setConfirm(true)}
              >
                Delete
              </Button>
            )}
          </>
        )}
        <span className="flex-1" />
        <Button type="button" size="sm" variant="ghost" className="h-7" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          data-testid="dicex-macro-save"
          size="sm"
          className="h-7"
          disabled={off || error !== null}
        >
          Save
        </Button>
      </div>
    </form>
  );
}

/**
 * The list (FR-DICEX-69): `actorId` first; `only` limits it to one creature (the sheet tab).
 * `preset` opens the editor at once (Save as macro).
 */
export function MacrosPanel({
  actorId = null,
  only,
  preset = null,
  className,
}: {
  actorId?: string | null;
  only?: string;
  preset?: MacroDraft | null;
  className?: string;
}) {
  const { viewer, macros, creatures, players } = useMacroData();
  const live = useSync((s) => s.state === "live");
  const [editing, setEditing] = useState<MacroDraft | null>(preset);
  const groups = useMemo(() => {
    const all = macroGroups(macros, viewer, creatures, players, actorId);
    return only === undefined ? all : all.filter((g) => g.creatureId === only);
  }, [macros, viewer, creatures, players, actorId, only]);
  if (editing) {
    return (
      <div className={className}>
        <MacroEditor key={editing.id ?? "new"} draft={editing} onDone={() => setEditing(null)} />
      </div>
    );
  }
  const own = (id: string | null) => {
    const c = id ? creatures.find((x) => x.id === id) : undefined;
    return (
      viewer.role === "dm" ||
      id === null ||
      (c?.kind === "character" && c.ownerPlayerId === viewer.playerId)
    );
  };
  const newIn = only !== undefined ? only : (actorId ?? null);
  return (
    <div data-testid="dicex-macros" className={cn("flex flex-col gap-2", className)}>
      {groups.length === 0 && <p className="text-xs text-muted-foreground">No macros yet.</p>}
      {groups.map((g) => (
        <section
          key={g.key}
          data-testid="dicex-macro-group"
          data-record-id={g.key}
          className="flex flex-col gap-1"
        >
          {only === undefined && (
            <h3 className="text-xs font-medium text-muted-foreground">{g.title}</h3>
          )}
          <ul className="flex flex-col gap-1">
            {g.macros.map((m) => (
              <MacroRow
                key={m.id}
                m={m}
                viewer={viewer}
                creatures={creatures}
                onEdit={(r) => setEditing(draftOf(r))}
              />
            ))}
          </ul>
        </section>
      ))}
      <Button
        type="button"
        data-testid="dicex-macro-new"
        size="sm"
        variant="outline"
        className="h-7 self-start"
        disabled={!live || !own(newIn)}
        onClick={() => setEditing(draftOf({ creatureId: newIn }))}
      >
        <PlusIcon className="size-3.5" />
        {only !== undefined ? "Macro" : "New macro"}
      </Button>
    </div>
  );
}

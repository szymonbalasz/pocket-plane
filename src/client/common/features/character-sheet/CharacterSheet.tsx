// Window `char.sheet` body, both clients (CHAR §7, CHARX §7). Picker (own characters, the
// player's Party group, the DM's last NPC sheet, "New character…"), then the full sheet, a
// summary card (another player's PC) or the empty state. Every change goes out as an intent.
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import { CREATURE_SHEET_TYPE, type CreatureSheetRecord } from "@shared/character-sheet/sheet";
import {
  type DefinitionRecord,
  ENTITY_TYPE,
  EntityRecord,
  ImportedEntityRecord,
} from "@shared/entities/schemas";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/primitives";
import { useRecords, useSync } from "../../sync/store";
import { useDefinitions } from "../compendium/definitions";
import { RollButton } from "../dice-roll-log/roll-control";
import { CreateCharacterDialog } from "./CreateCharacter";
import { SELECT } from "./fields";
import { rollRoutes } from "./roll-routes";
import { rollHint, type SheetRollProps, useSheetRollControl } from "./rolls";
import { rollActionView, routeFor, routeRef } from "./routing";
import { SheetView } from "./SheetView";
import { SummaryCard } from "./SummaryCard";
import {
  bindSheetMemory,
  clearEditRequest,
  type Eligibility,
  selectSheet,
  sheetMemoryKey,
  sheetSelection,
} from "./selection";
import { useSheet } from "./sheet-context";
import { type CreatureLike, pickerModel, type SummaryInput, shownSheetId } from "./view-model";

const NEW = "__new";

// ---------- roll buttons (FR-CHARX-23, FR-CHAR-25: hints are the shared Tooltip, drawn by
// `RollButton` with the Alt hint, FR-DICEX-51) ----------
// The tabs import these from here; they render only inside a sheet (module cycle is
// render-time only).

/**
 * One sheet roll (checks, saves, skills, attacks by row, spells): `char.roll`, unless a roll
 * route claims its kind with the row's ref (FR-CHARX-24, -43: each of a row's three buttons
 * asks on its own). A hidden claim renders nothing (FR-CHAR-24).
 */
export function SheetRoll({
  kind,
  rollRef,
  title,
  hint,
  breakdown,
  overrides,
  children,
  ...button
}: SheetRollProps) {
  const ctx = useSheet();
  const store = useSync((s) => s.store);
  const claim = routeFor(rollRoutes, store, ctx.creature.id, kind, routeRef(rollRef));
  const { control, disabled } = useSheetRollControl({
    kind,
    rollRef,
    title,
    overrides,
    claim,
  });
  if (rollActionView(claim, kind) !== "button") return null;
  return (
    <RollButton
      control={control}
      hint={rollHint(ctx.stats, breakdown, hint)}
      type="button"
      size="sm"
      variant="secondary"
      {...button}
      disabled={disabled || button.disabled}
    >
      {children}
    </RollButton>
  );
}

/**
 * Initiative, asking the roll routes first (FR-CHAR-16): a claim answering `hidden` renders no
 * button and shows "Initiative set" (FR-CHAR-24). Attacks: `SheetRoll` per row (FR-CHARX-44).
 */
export function RoutedRoll({
  kind,
  title,
  breakdown,
  overrides,
  children,
  ...button
}: Omit<SheetRollProps, "kind" | "rollRef"> & { kind: "initiative" }) {
  const ctx = useSheet();
  const store = useSync((s) => s.store);
  const claim = routeFor(rollRoutes, store, ctx.creature.id, kind);
  const { control, disabled } = useSheetRollControl({ kind, title, overrides, claim });
  const view = rollActionView(claim, kind);
  if (view === "locked") {
    return (
      <span data-testid="char-sheet-init-locked" className="text-xs text-muted-foreground">
        Initiative set
      </span>
    );
  }
  if (view === "none") return null;
  return (
    <RollButton
      control={control}
      hint={rollHint(ctx.stats, breakdown, undefined)}
      type="button"
      size="sm"
      variant="secondary"
      {...button}
      disabled={disabled || button.disabled}
    >
      {children}
    </RollButton>
  );
}

/** A full definition record (DM, owner) or null (redacted / invalid). */
function fullRecord(r: unknown): DefinitionRecord | null {
  const e = EntityRecord.safeParse(r);
  if (e.success) return e.data;
  const i = ImportedEntityRecord.safeParse(r);
  return i.success ? i.data : null;
}

export function CharacterSheet() {
  const you = useSync((s) => s.store.you);
  const live = useSync((s) => s.state === "live");
  const entities = useRecords<CreatureLike>(ENTITY_TYPE);
  const sheetRecords = useRecords<CreatureSheetRecord>(CREATURE_SHEET_TYPE);
  const players = useRecords<PlayerRecord>("player");
  const sel = useStore(sheetSelection);
  const [creating, setCreating] = useState(false);
  const sheets = useMemo(
    () => Object.fromEntries(sheetRecords.map((s) => [s.entityId, s])),
    [sheetRecords],
  );
  const viewer = { role: you?.role ?? "player", playerId: you?.playerId ?? null } as const;
  // FR-CMP-16: an imported NPC sheet (DM) reads its definition through `useDefinitions` (lazy).
  const npcDefs = useDefinitions(viewer.role === "dm" && sel.npcId ? [sel.npcId] : []);
  const npcImported = sel.npcId ? npcDefs.byId.get(sel.npcId) : undefined;
  const imported: CreatureLike[] = npcImported?.campaignId === null ? [npcImported] : [];
  const npc =
    viewer.role === "dm" && sel.npcId
      ? ([...entities, ...imported].find((e) => e.id === sel.npcId && e.kind === "monster") ?? null)
      : null;
  const picker = pickerModel(entities, sheets, viewer, players, npc);
  const shownId = shownSheetId(picker.options, sel.selectedId);
  const selected = picker.options.find((o) => o.id === shownId) ?? null;
  // FR-CHARX-47: after the first snapshot (and per campaign), restore the remembered choice if
  // still eligible (incl. the DM's last NPC); else FR-CHAR-04's default.
  const memoryKey = you && live ? sheetMemoryKey(you.campaignId, you.role, you.playerId) : null;
  const eligibleRef = useRef<Eligibility>(() => null);
  eligibleRef.current = (id) => {
    if (pickerModel(entities, sheets, viewer, players, null).options.some((o) => o.id === id)) {
      return "option";
    }
    // Not a campaign row → maybe an imported definition (lazy, not loaded yet): the DM keeps it
    // as the NPC; `useDefinitions` resolves it, an id that doesn't load leaves no NPC option.
    const row = entities.find((e) => e.id === id);
    const monster = row ? row.kind === "monster" : true;
    return viewer.role === "dm" && monster ? "npc" : null;
  };
  useEffect(() => {
    if (memoryKey) bindSheetMemory(memoryKey, (id) => eligibleRef.current(id));
  }, [memoryKey]);
  // FR-CHARX-30: the creation request is consumed once its character is shown.
  const startEditing = sel.editId !== null && sel.editId === selected?.id;
  useEffect(() => {
    if (startEditing) clearEditRequest();
  }, [startEditing]);

  if (!you) {
    return (
      <div className="flex flex-col gap-3 p-1">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  const isDm = you.role === "dm";
  const dialog = (
    <CreateCharacterDialog
      open={creating}
      onOpenChange={setCreating}
      client={isDm ? "dm" : "player"}
      players={players}
    />
  );
  const group = (g: "own" | "party" | "npc") => picker.options.filter((o) => o.group === g);
  const pickerEl =
    picker.options.length > 1 || picker.canCreate ? (
      <select
        data-testid="char-sheet-picker"
        aria-label="Character"
        className={`${SELECT} h-8 max-w-36`}
        value={selected?.id ?? ""}
        onChange={(e) => {
          if (e.target.value === NEW) setCreating(true);
          else selectSheet(e.target.value);
        }}
      >
        {!selected && <option value="">—</option>}
        {group("own").map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
        {group("party").length > 0 && (
          <optgroup label="Party">
            {group("party").map((o) => (
              <option key={o.id} value={o.id} data-testid="charx-picker-party">
                {o.label}
              </option>
            ))}
          </optgroup>
        )}
        {group("npc").map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
        {picker.canCreate && (
          <option value={NEW} data-testid="charx-picker-new">
            New character…
          </option>
        )}
      </select>
    ) : null;

  if (!selected) {
    return (
      <div className="flex flex-col items-start gap-2 p-2">
        <p data-testid="char-sheet-empty" className="text-sm text-muted-foreground">
          {isDm ? "No characters in this campaign" : "No character yet — ask your DM"}
        </p>
        {picker.canCreate && (
          <Button
            size="sm"
            data-testid="charx-create"
            disabled={!live}
            onClick={() => setCreating(true)}
          >
            Create character
          </Button>
        )}
        {dialog}
      </div>
    );
  }
  const raw = [...entities, ...imported].find((e) => e.id === selected.id);
  const ownerName = (id: string | null) => players.find((p) => p.id === id)?.name ?? null;
  if (selected.group === "party") {
    return (
      <>
        <SummaryCard e={raw as unknown as SummaryInput} players={players} picker={pickerEl} />
        {dialog}
      </>
    );
  }
  const record = fullRecord(raw);
  if (!record) {
    return (
      <p data-testid="char-sheet-empty" className="p-2 text-sm text-muted-foreground">
        This sheet can't be shown
      </p>
    );
  }
  return (
    <>
      <SheetView
        key={record.id}
        creature={record}
        row={sheets[record.id]}
        client={isDm ? "dm" : "player"}
        playerId={you.playerId}
        ownerName={ownerName(record.ownerPlayerId)}
        picker={pickerEl}
        startEditing={startEditing}
      />
      {dialog}
    </>
  );
}

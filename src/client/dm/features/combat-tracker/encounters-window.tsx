// DM `cbt.encounters` (CBT §7): list + New; editor (name, creature picker, entries, party,
// difficulty card); Start on the viewed scene (binding preview) / End (confirm). Planned
// encounters save themselves (debounced whole replace); started / ended are read-only.
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import { CREATURE_SHEET_TYPE, type CreatureSheetRecord } from "@shared/character-sheet/sheet";
import { difficultyMethods, formatCr, totalCr } from "@shared/combat-tracker/difficulty";
import { type BindSlot, planBindings } from "@shared/combat-tracker/rules";
import {
  ENCOUNTER_ENTRY_TYPE,
  ENCOUNTER_TYPE,
  type EncounterEntryRecord,
  EncounterName,
  type EncounterRecord,
  QUANTITY_MAX,
} from "@shared/combat-tracker/schemas";
import { entityNameKey } from "@shared/entities/schemas";
import type { SceneFolderRecord, SceneRecord, TokenRecord } from "@shared/scenes-map/schemas";
import { ApiError } from "@ui/api";
import { Button } from "@ui/components/ui/button";
import { Checkbox, Popover, PopoverAnchor, PopoverContent } from "@ui/components/ui/controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ui/components/ui/overlays";
import { Badge, Card, Input, Label, Skeleton } from "@ui/components/ui/primitives";
import { useCbtIntent } from "@ui/features/combat-tracker/store";
import { ENCOUNTERS_KIND } from "@ui/features/combat-tracker/window";
import { defineWindow } from "@ui/features/play-shell/registry";
import { cn } from "@ui/lib/utils";
import { useRecords, useSync } from "@ui/sync/store";
import { ArrowLeftIcon, MinusIcon, PlusIcon, SwordsIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { creatureRows } from "../entities/list";
import { useDmMap, viewedScene } from "../scenes-map/view-state";
import { useDefinitions } from "./data";
import { EndConfirmDescription, useStartEnd } from "./end-confirm";
import { useOpenEncounter } from "./open-encounter";
import { partyMembers, toggleParty } from "./party";
import { combatRest } from "./rest";

interface Draft {
  name: string;
  partyCharacterIds: string[] | null;
  entries: { definitionId: string; quantity: number }[];
}

const STATUS_ORDER = { started: 0, planned: 1, ended: 2 } as const;

function restError(err: unknown) {
  toast.error(err instanceof ApiError ? err.message : "Something went wrong");
}

function useCharacters() {
  const defs = useDefinitions();
  return useMemo(
    () =>
      [...defs.values()]
        .filter((d) => d.kind === "character")
        .sort((a, b) => (entityNameKey(a.name) < entityNameKey(b.name) ? -1 : 1)),
    [defs],
  );
}

/** Character ids whose sheet is a draft (FR-CHARX-11): not in the whole party. */
function useDraftIds(): ReadonlySet<string> {
  const sheets = useRecords<CreatureSheetRecord>(CREATURE_SHEET_TYPE);
  return useMemo(
    () => new Set(sheets.filter((s) => s.status === "draft").map((s) => s.entityId)),
    [sheets],
  );
}

function draftOf(e: EncounterRecord, entries: EncounterEntryRecord[]): Draft {
  return {
    name: e.name,
    partyCharacterIds: e.partyCharacterIds,
    entries: entries
      .filter((x) => x.encounterId === e.id)
      .sort((a, b) => a.seq - b.seq)
      .map((x) => ({ definitionId: x.definitionId, quantity: x.quantity })),
  };
}

// ---------- difficulty card (FR-CBT-03) ----------

function DifficultyCard({ draft }: { draft: Draft }) {
  const defs = useDefinitions();
  const characters = useCharacters();
  const drafts = useDraftIds();
  const party = partyMembers(characters, draft.partyCharacterIds, drafts);
  const levels = party.map((c) => (c.kind === "character" ? c.statBlock.level : 1));
  const crs = draft.entries.flatMap((e) => {
    const d = defs.get(e.definitionId);
    return d?.kind === "monster" ? Array<string>(e.quantity).fill(d.statBlock.cr) : [];
  });
  const method = difficultyMethods[0];
  if (!method) return null;
  const r = method.rate(levels, crs);
  return (
    <Card className="flex flex-col gap-1 p-3 text-xs">
      <div className="flex items-center gap-2">
        <Badge data-testid="cbt-enc-rating" data-value={r.rating}>
          {r.rating}
        </Badge>
        <span className="text-muted-foreground">{method.label}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 tabular-nums">
        <span>
          Base <b data-testid="cbt-enc-xp-base">{r.baseXp}</b> XP
        </span>
        <span>
          Adjusted <b data-testid="cbt-enc-xp-adjusted">{r.adjustedXp}</b> XP (×{r.multiplier})
        </span>
        <span>
          Total CR <b data-testid="cbt-enc-total-cr">{formatCr(totalCr(crs))}</b>
        </span>
      </div>
      {r.thresholds && (
        <div className="text-muted-foreground tabular-nums">
          Easy {r.thresholds.easy} · Medium {r.thresholds.medium} · Hard {r.thresholds.hard} ·
          Deadly {r.thresholds.deadly}
        </div>
      )}
    </Card>
  );
}

// ---------- creature picker (FR-CBT-04) ----------

function Picker({ onPick, disabled }: { onPick(id: string): void; disabled: boolean }) {
  const entities = useRecords<unknown>("entity");
  const imported = useRecords<unknown>("imported-entity");
  const players = useRecords<PlayerRecord>("player");
  const rows = useMemo(
    () => creatureRows(entities, imported, players, "monster"),
    [entities, imported, players],
  );
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const shown = rows.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          data-testid="cbt-enc-picker"
          role="combobox"
          aria-expanded={open}
          placeholder="Add creature…"
          disabled={disabled}
          value={q}
          // Open on click / typing, not on focus: focus returns here after a pick.
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && shown[0]) {
              onPick(shown[0].id);
              setQ("");
              setOpen(false);
            }
            if (e.key === "Escape") setOpen(false);
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="max-h-64 w-[var(--radix-popover-trigger-width)] min-w-64 overflow-auto p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {shown.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">No creature matches</p>
        ) : (
          <ul>
            {shown.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  data-testid="cbt-enc-picker-option"
                  data-value={r.id}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    onPick(r.id);
                    setQ("");
                    setOpen(false);
                  }}
                >
                  <span className="flex-1 truncate">{r.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    CR {r.cr} · {r.xp} XP
                  </span>
                  <Badge variant="outline">{r.badge}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ---------- start dialog (FR-CBT-07, FR-CBT-08) ----------

function StartDialog({
  encounter,
  draft,
  open,
  onOpenChange,
}: {
  encounter: EncounterRecord;
  draft: Draft;
  open: boolean;
  onOpenChange(o: boolean): void;
}) {
  const scenes = useRecords<SceneRecord>("scene");
  const folders = useRecords<SceneFolderRecord>("scene-folder");
  const tokens = useRecords<TokenRecord>("token");
  const requested = useDmMap((s) => s.viewedSceneId);
  const scene = viewedScene(scenes, folders, requested);
  const defs = useDefinitions();
  const characters = useCharacters();
  const drafts = useDraftIds();
  const { disabled } = useCbtIntent();
  const startEnd = useStartEnd();
  const bindings = useMemo(() => {
    if (!scene) return [];
    const party = partyMembers(characters, draft.partyCharacterIds, drafts);
    const slots: BindSlot[] = [
      ...party.map((c) => ({
        kind: "pc" as const,
        entityId: c.id,
        name: c.name,
        portraitAssetId: c.portraitAssetId,
      })),
      ...draft.entries.flatMap((e) => {
        const d = defs.get(e.definitionId);
        if (!d) return [];
        return Array.from({ length: e.quantity }, () => ({
          kind: "monster" as const,
          entityId: d.id,
          name: d.name,
          portraitAssetId: d.portraitAssetId,
        }));
      }),
    ];
    return planBindings(
      slots,
      tokens.filter((t) => t.sceneId === scene.id),
    );
  }, [scene, tokens, draft, defs, characters, drafts]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="cbt-enc-start-dialog">
        <DialogHeader>
          <DialogTitle>Start “{encounter.name}”</DialogTitle>
          <DialogDescription>
            {scene
              ? `On “${scene.name}”. Tokens are bound in placement order.`
              : "No scene to start on"}
          </DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-72 flex-col gap-1 overflow-auto text-sm">
          {bindings.map((b, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: one row per combatant slot
              key={i}
              data-testid="cbt-enc-binding"
              data-record-id={b.tokenId ?? ""}
              data-bound={b.tokenId !== null}
              className="flex items-center gap-2"
            >
              <span className="flex-1 truncate">{b.name}</span>
              {b.hidden && <Badge variant="outline">hidden</Badge>}
              {b.tokenId === null && <Badge variant="secondary">no token</Badge>}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            data-testid="cbt-enc-start-confirm"
            disabled={disabled || startEnd.disabled || !scene}
            onClick={async () => {
              if (!scene) return;
              // FR-CBT-60: once acked, Initiative opens in front, Encounters minimises, map refits.
              const r = await startEnd.start(encounter.id, scene.id);
              if (r !== undefined) onOpenChange(false);
            }}
          >
            Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- editor ----------

function Editor({ encounter, back }: { encounter: EncounterRecord; back(): void }) {
  const allEntries = useRecords<EncounterEntryRecord>(ENCOUNTER_ENTRY_TYPE);
  const defs = useDefinitions();
  const characters = useCharacters();
  const drafts = useDraftIds();
  const live = useSync((s) => s.state === "live");
  const { disabled } = useCbtIntent();
  const server = useMemo(() => draftOf(encounter, allEntries), [encounter, allEntries]);
  const [draft, setDraft] = useState<Draft>(server);
  const [nameError, setNameError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const startEnd = useStartEnd();
  const dirty = useRef(false);
  const planned = encounter.status === "planned";
  const readOnly = !planned || !live;

  // Adopt server state when we have no local edits pending.
  useEffect(() => {
    if (!dirty.current) setDraft(server);
  }, [server]);

  // Debounced whole-replace save of local edits (planned only).
  useEffect(() => {
    if (!dirty.current || !planned) return;
    const name = EncounterName.safeParse(draft.name);
    if (!name.success) {
      setNameError(name.error.issues[0]?.message ?? "Invalid name");
      return;
    }
    setNameError(null);
    const h = setTimeout(() => {
      dirty.current = false;
      combatRest.updateEncounter(encounter.id, { ...draft, name: name.data }).catch(restError);
    }, 400);
    return () => clearTimeout(h);
  }, [draft, planned, encounter.id]);

  const edit = (f: (d: Draft) => Draft) => {
    dirty.current = true;
    setDraft((d) => f(d));
  };
  const setQty = (id: string, q: number) =>
    edit((d) => ({
      ...d,
      entries: d.entries
        .map((e) => (e.definitionId === id ? { ...e, quantity: q } : e))
        .filter((e) => e.quantity > 0),
    }));
  const partyIds = partyMembers(characters, draft.partyCharacterIds, drafts).map((c) => c.id);

  return (
    <div
      className="flex min-h-0 flex-col gap-3"
      data-testid="cbt-enc-editor"
      data-record-id={encounter.id}
    >
      <div className="flex items-center gap-2">
        <Button size="icon" variant="ghost" className="size-8" aria-label="Back" onClick={back}>
          <ArrowLeftIcon className="size-4" />
        </Button>
        <Input
          data-testid="cbt-enc-name"
          aria-label="Encounter name"
          aria-invalid={nameError !== null}
          disabled={readOnly}
          value={draft.name}
          onChange={(e) => edit((d) => ({ ...d, name: e.target.value }))}
        />
        <Badge variant="outline" data-testid="cbt-enc-status" data-value={encounter.status}>
          {encounter.status}
        </Badge>
      </div>
      {nameError && <p className="text-xs text-destructive">{nameError}</p>}
      {planned && (
        <Picker
          disabled={readOnly}
          onPick={(id) =>
            edit((d) =>
              d.entries.some((e) => e.definitionId === id)
                ? {
                    ...d,
                    entries: d.entries.map((e) =>
                      e.definitionId === id
                        ? { ...e, quantity: Math.min(QUANTITY_MAX, e.quantity + 1) }
                        : e,
                    ),
                  }
                : { ...d, entries: [...d.entries, { definitionId: id, quantity: 1 }] },
            )
          }
        />
      )}
      <ul className="flex flex-col gap-1">
        {draft.entries.map((e) => {
          const d = defs.get(e.definitionId);
          return (
            <li
              key={e.definitionId}
              data-testid="cbt-enc-entry"
              data-record-id={e.definitionId}
              data-value={e.quantity}
              className="flex items-center gap-2 text-sm"
            >
              <span className="flex-1 truncate">{d?.name ?? "(unknown)"}</span>
              <span className="text-xs text-muted-foreground">
                CR {d?.kind === "monster" ? d.statBlock.cr : "?"}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                data-testid="cbt-enc-entry-dec"
                data-record-id={e.definitionId}
                aria-label="One fewer"
                disabled={readOnly}
                onClick={() => setQty(e.definitionId, e.quantity - 1)}
              >
                <MinusIcon className="size-3.5" />
              </Button>
              <span className="w-5 text-center tabular-nums">{e.quantity}</span>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                data-testid="cbt-enc-entry-inc"
                data-record-id={e.definitionId}
                aria-label="One more"
                disabled={readOnly || e.quantity >= QUANTITY_MAX}
                onClick={() => setQty(e.definitionId, e.quantity + 1)}
              >
                <PlusIcon className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                data-testid="cbt-enc-entry-remove"
                data-record-id={e.definitionId}
                aria-label="Remove"
                disabled={readOnly}
                onClick={() => setQty(e.definitionId, 0)}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </li>
          );
        })}
      </ul>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-xs font-medium text-muted-foreground">Party</legend>
        {characters.map((c) => {
          const id = `cbt-party-${c.id}`;
          return (
            <div key={c.id} className="flex items-center gap-2">
              <Checkbox
                id={id}
                data-testid="cbt-enc-party"
                data-record-id={c.id}
                disabled={readOnly}
                checked={partyIds.includes(c.id)}
                onCheckedChange={(v) =>
                  edit((d) => ({
                    ...d,
                    partyCharacterIds: toggleParty(
                      characters,
                      d.partyCharacterIds,
                      drafts,
                      c.id,
                      v === true,
                    ),
                  }))
                }
              />
              <Label htmlFor={id} className="font-normal">
                {c.name}{" "}
                <span className="text-xs text-muted-foreground">
                  (level {c.kind === "character" ? c.statBlock.level : "?"})
                  {drafts.has(c.id) && " · Draft"}
                </span>
              </Label>
            </div>
          );
        })}
      </fieldset>
      <DifficultyCard draft={draft} />
      <div className="flex items-center gap-2">
        {planned && (
          <>
            <Button data-testid="cbt-enc-start" disabled={!live} onClick={() => setStarting(true)}>
              <SwordsIcon className="size-4" /> Start
            </Button>
            <Button
              variant="ghost"
              data-testid="cbt-enc-delete"
              disabled={!live}
              onClick={() => combatRest.deleteEncounter(encounter.id).then(back, restError)}
            >
              Delete
            </Button>
          </>
        )}
        {encounter.status === "started" && (
          <Button
            variant="destructive"
            data-testid="cbt-enc-end"
            disabled={disabled}
            onClick={() => setEnding(true)}
          >
            End encounter
          </Button>
        )}
      </div>
      {planned && (
        <StartDialog
          encounter={encounter}
          draft={draft}
          open={starting}
          onOpenChange={setStarting}
        />
      )}
      <Dialog open={ending} onOpenChange={setEnding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End “{encounter.name}”?</DialogTitle>
            <EndConfirmDescription encounterId={encounter.id} testId="cbt-enc-end-pending" />
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEnding(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              data-testid="cbt-enc-end-confirm"
              disabled={disabled || startEnd.disabled}
              onClick={async () => {
                // FR-CBT-60: once acked, this tab's Initiative minimises.
                const r = await startEnd.end(encounter.id);
                if (r !== undefined) setEnding(false);
              }}
            >
              End
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- list ----------

function EncountersBody() {
  const encounters = useRecords<EncounterRecord>(ENCOUNTER_TYPE);
  const everLive = useSync((s) => s.everLive);
  const live = useSync((s) => s.state === "live");
  // Survives reloads and close / reopen (browser-local, per campaign).
  const [selected, setSelected] = useOpenEncounter();
  const sorted = useMemo(
    () =>
      [...encounters].sort(
        (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.seq - a.seq,
      ),
    [encounters],
  );
  const current = sorted.find((e) => e.id === selected);
  if (!everLive) return <Skeleton className="h-24" />;
  if (current) return <Editor encounter={current} back={() => setSelected(null)} />;
  return (
    <section data-testid="cbt-enc-list" aria-label="Encounters" className="flex flex-col gap-2">
      <Button
        data-testid="cbt-enc-new"
        size="sm"
        className="self-start"
        disabled={!live}
        onClick={() =>
          combatRest
            .createEncounter({ name: "New encounter", partyCharacterIds: null, entries: [] })
            .then((r) => r && setSelected(r.encounter.id), restError)
        }
      >
        <PlusIcon className="size-4" /> New encounter
      </Button>
      {sorted.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No encounters yet</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {sorted.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                data-testid="cbt-enc-row"
                data-record-id={e.id}
                data-status={e.status}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                  e.status === "ended" && "text-muted-foreground",
                )}
                onClick={() => setSelected(e.id)}
              >
                <span className="flex-1 truncate">{e.name}</span>
                <Badge variant={e.status === "started" ? "default" : "outline"}>
                  {e.status === "planned"
                    ? "Planned"
                    : e.status === "started"
                      ? "Started"
                      : "Ended"}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export const encountersWindow = defineWindow({
  kind: ENCOUNTERS_KIND,
  title: "Encounters",
  clients: ["dm"],
  // Left edge, top (map-first, #162; protocol §24): above `dice.log` at 1600×900; shares the
  // spot with `map.scenes` / `ent.creatures`, the second one opened goes to the next free slot.
  defaultSize: { w: 440, h: 512 },
  minSize: { w: 360, h: 320 },
  defaultPosition: { anchor: "top-left", dx: 56 },
  launcher: { icon: SwordsIcon, label: "Encounters", order: 55 },
  component: EncountersBody,
});

// DM `cbt.encounters` (CBT §7): list + New; editor (name, creature lookup, entries with HP mode,
// add options, party, difficulty card); Start on the viewed scene (binding preview, "Not on this
// map" PCs, `at`) / End (confirm). Planned encounters save themselves (debounced whole replace);
// started / ended are read-only. Sprint 2: FR-CBT-62–66. Sprint 5 (#252): an entry's "Friendly"
// Switch; the card rates enemy entries only and lists the friendly ones (FR-CBT-102). Sprint 6
// (FR-CBT-109): Start lists each joining PC's pets under it (ticked iff on the map).
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import { CREATURE_SHEET_TYPE, type CreatureSheetRecord } from "@shared/character-sheet/sheet";
import { difficultyMethods, formatCr, rateEncounter } from "@shared/combat-tracker/difficulty";
import {
  ENCOUNTER_ENTRY_TYPE,
  ENCOUNTER_TYPE,
  type EncounterEntryRecord,
  EncounterName,
  type EncounterRecord,
  QUANTITY_MAX,
} from "@shared/combat-tracker/schemas";
import { entityNameKey, type MonsterRecord } from "@shared/entities/schemas";
import type { SceneFolderRecord, SceneRecord, TokenRecord } from "@shared/scenes-map/schemas";
import { ApiError } from "@ui/api";
import { Button } from "@ui/components/ui/button";
import { Checkbox, Switch } from "@ui/components/ui/controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Tooltip,
} from "@ui/components/ui/overlays";
import { Badge, Card, Input, Label, Skeleton } from "@ui/components/ui/primitives";
import type { LookupRow } from "@ui/features/combat-tracker/lookup";
import { CreatureLookup } from "@ui/features/combat-tracker/parts";
import { useCbtIntent } from "@ui/features/combat-tracker/store";
import { ENCOUNTERS_KIND } from "@ui/features/combat-tracker/window";
import { useCreatureLookup } from "@ui/features/compendium/lookup";
import { lazyApi } from "@ui/features/compendium/search";
import { useFreeArea } from "@ui/features/play-shell/free-area";
import { defineWindow } from "@ui/features/play-shell/registry";
import { useSceneLoaded } from "@ui/features/scenes-map/scene-window";
import { cn } from "@ui/lib/utils";
import { useRecords, useSync } from "@ui/sync/store";
import {
  ArrowLeftIcon,
  HandshakeIcon,
  MinusIcon,
  PlusIcon,
  SwordsIcon,
  Trash2Icon,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { creatureRows } from "../entities/list";
import { useDmMap, viewedScene } from "../scenes-map/view-state";
import { useDefinitions } from "./data";
import {
  addPick,
  adoptServerDraft,
  type Draft,
  draftOf,
  entryKey,
  setEntrySide,
} from "./encounter-draft";
import { EndConfirmButtons, EndConfirmDescription, useStartEnd } from "./end-confirm";
import { HpSelect, JoinPreviewRow } from "./join-parts";
import {
  defaultJoiningIds,
  type JoinRow,
  type JoinSlot,
  notOnMap,
  type PetOffer,
  petOffers,
  previewJoin,
  startBody,
} from "./join-preview";
import { useOpenEncounter } from "./open-encounter";
import { partyMembers, toggleParty } from "./party";
import { freeAreaCell } from "./place-at";
import { combatRest } from "./rest";
import { START_KEPT_NOTE, startKeptNoteShown } from "./start-end";

/** The DM REST client, imported lazily (the session reads localStorage at import). */
const api = lazyApi(() => import("../campaign-management/session").then((m) => m.api));

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

type Pet = MonsterRecord & { companionOf: string };

/** FR-CBT-109: the campaign's pets (monsters with an owner PC), by name. */
function usePets(): Pet[] {
  const defs = useDefinitions();
  return useMemo(
    () =>
      [...defs.values()]
        .filter((d): d is Pet => d.kind === "monster" && "companionOf" in d && !!d.companionOf)
        .sort((a, b) => (entityNameKey(a.name) < entityNameKey(b.name) ? -1 : 1)),
    [defs],
  );
}

/** FR-CBT-109: a pet's tick in the Start dialog (`cbt-enc-pet`). */
function PetTick({
  offer,
  owner,
  onChange,
}: {
  offer: PetOffer<Pet>;
  owner: string;
  onChange(ticked: boolean): void;
}) {
  return (
    <Checkbox
      data-testid="cbt-enc-pet"
      data-record-id={offer.pet.id}
      data-checked={offer.ticked}
      aria-label={`${offer.pet.name} (${owner}'s pet) joins`}
      checked={offer.ticked}
      onCheckedChange={(v) => onChange(v === true)}
    />
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

// ---------- difficulty card (FR-CBT-03) ----------

/**
 * P3 glitch 7 (FR-CBT-66): the builder rates the PCs Start will add by default: the planned party
 * minus those with no token on the scene Start uses (the viewed one; "Not on this map", unticked
 * by default). No scene viewed (or not loaded yet) → the planned party.
 */
function useStartScenePcIds(): ((partyIds: readonly string[]) => string[]) | null {
  const scenes = useRecords<SceneRecord>("scene");
  const folders = useRecords<SceneFolderRecord>("scene-folder");
  const tokens = useRecords<TokenRecord>("token");
  const requested = useDmMap((s) => s.viewedSceneId);
  const scene = viewedScene(scenes, folders, requested);
  // ADR-0041: as the Start dialog, only a loaded scene's tokens say who is on it.
  const loaded = useSceneLoaded(scene?.id ?? null);
  if (!scene || !loaded) return null;
  const onScene = tokens.filter((t) => t.sceneId === scene.id);
  return (ids) => defaultJoiningIds(ids, onScene);
}

/** `partyIds`: the Start dialog's joining PCs (FR-CBT-66); else those Start would add. */
function DifficultyCard({ draft, partyIds }: { draft: Draft; partyIds?: readonly string[] }) {
  const defs = useDefinitions(draft.entries.map((e) => e.definitionId));
  const characters = useCharacters();
  const drafts = useDraftIds();
  const startPcs = useStartScenePcIds();
  const planned = partyMembers(characters, draft.partyCharacterIds, drafts);
  const joining = partyIds ?? startPcs?.(planned.map((c) => c.id)) ?? planned.map((c) => c.id);
  const party = characters.filter((c) => joining.includes(c.id));
  const notCounted = partyIds ? [] : planned.filter((c) => !joining.includes(c.id));
  const levels = party.map((c) => (c.kind === "character" ? c.statBlock.level : 1));
  // FR-CBT-102 (#252): enemy entries rated, friendly ones listed; the entries, never the sides
  // combatants have now (planning-only).
  const rated = draft.entries.flatMap((e) => {
    const d = defs.get(e.definitionId);
    return d?.kind === "monster"
      ? [{ name: d.name, cr: d.statBlock.cr, quantity: e.quantity, side: e.side }]
      : [];
  });
  const method = difficultyMethods[0];
  if (!method) return null;
  const r = rateEncounter(method, levels, rated);
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
          Total CR <b data-testid="cbt-enc-total-cr">{formatCr(r.totalCr)}</b>
        </span>
      </div>
      {r.friendly && (
        <div data-testid="cbt-enc-friendly" className="text-muted-foreground">
          {r.friendly}
        </div>
      )}
      {notCounted.length > 0 && (
        <div data-testid="cbt-enc-rating-off-map" className="text-muted-foreground">
          Not on this map (not counted): {notCounted.map((c) => c.name).join(", ")}
        </div>
      )}
      {r.thresholds && (
        <div className="text-muted-foreground tabular-nums">
          Easy {r.thresholds.easy} · Medium {r.thresholds.medium} · Hard {r.thresholds.hard} ·
          Deadly {r.thresholds.deadly}
        </div>
      )}
    </Card>
  );
}

// ---------- creature lookup (FR-CBT-63) ----------

/**
 * The builder's suggestions (FR-CBT-63): the campaign's custom monsters from the store, imported
 * ones from the server (FR-CMP-17), merged in FR-ENT-18 order. `q` = the lookup's text. Pets
 * aren't entries: they join at Start with their owner (FR-CBT-109, sprint 6).
 */
function useMonsterLookupRows(q: string): LookupRow[] {
  const entities = useRecords<unknown>("entity");
  const players = useRecords<PlayerRecord>("player");
  const customs = useMemo(
    () =>
      creatureRows(entities, [], players, "monster")
        .filter((r) => r.pet === null)
        .map((r) => ({
          id: r.id,
          name: r.name,
          cr: r.cr,
          xp: r.xp,
          badge: r.badge,
        })),
    [entities, players],
  );
  return useCreatureLookup(api, customs, q);
}

// ---------- start dialog (FR-CBT-07, FR-CBT-08) ----------

/**
 * FR-CBT-109: a pet on the map under its PC in the Start preview: its tick, then (ticked) its
 * binding as for any combatant.
 */
function PetPreviewRow({
  offer,
  owner,
  row,
  onChange,
}: {
  offer: PetOffer<Pet>;
  owner: string;
  row: JoinRow | undefined;
  onChange(ticked: boolean): void;
}) {
  const tick = <PetTick offer={offer} owner={owner} onChange={onChange} />;
  if (row) {
    return <JoinPreviewRow row={row} testId="cbt-enc-binding" lead={tick} className="pl-4" />;
  }
  return (
    <li className="flex items-center gap-2 pl-4 text-muted-foreground">
      {tick}
      {/* FR-CBT-146: the pet-offer row's name wraps between words, never cut. */}
      <span className={cn("min-w-0 flex-1", NAME_WRAP)}>{offer.pet.name}</span>
    </li>
  );
}

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
  // ADR-0041: binding preview and "Not on this map" read the viewed scene's tokens.
  const sceneLoaded = useSceneLoaded(scene?.id ?? null);
  const defs = useDefinitions(draft.entries.map((e) => e.definitionId));
  const characters = useCharacters();
  const drafts = useDraftIds();
  const { disabled } = useCbtIntent();
  const startEnd = useStartEnd();
  const free = useFreeArea();
  const pets = usePets();
  // FR-CBT-66: "Not on this map" PCs are unticked each time the dialog opens; FR-CBT-109: pets
  // back to their default (ticked iff on the map).
  const [joining, setJoining] = useState<ReadonlySet<string>>(new Set());
  const [petPicks, setPetPicks] = useState<ReadonlyMap<string, boolean>>(new Map());
  useEffect(() => {
    if (open) {
      setJoining(new Set());
      setPetPicks(new Map());
    }
  }, [open]);
  const pickPet = (id: string, ticked: boolean) =>
    setPetPicks((cur) => new Map(cur).set(id, ticked));
  const sceneTokens = useMemo(
    () => (scene ? tokens.filter((t) => t.sceneId === scene.id) : []),
    [scene, tokens],
  );
  const party = partyMembers(characters, draft.partyCharacterIds, drafts);
  const offMap = sceneLoaded ? notOnMap(party, sceneTokens) : [];
  const joiningParty = party.filter((c) => !offMap.includes(c) || joining.has(c.id));
  const offers = sceneLoaded
    ? petOffers(
        pets,
        joiningParty.map((c) => c.id),
        sceneTokens,
        petPicks,
      )
    : [];
  const joiningPets = offers.filter((o) => o.ticked).map((o) => o.pet);
  const slots: JoinSlot[] = [
    ...joiningParty.map((c) => ({
      kind: "pc" as const,
      entityId: c.id,
      name: c.name,
      portraitAssetId: c.portraitAssetId,
      hpMode: "average" as const,
      hasFormula: false,
    })),
    ...draft.entries.flatMap((e) => {
      const d = defs.get(e.definitionId);
      if (!d) return [];
      return Array.from({ length: e.quantity }, () => ({
        kind: "monster" as const,
        entityId: d.id,
        name: d.name,
        portraitAssetId: d.portraitAssetId,
        hpMode: e.hpMode,
        hasFormula: Boolean(d.statBlock.hpFormula),
      }));
    }),
    // FR-CBT-109: pets after the entries, as the server binds them.
    ...joiningPets.map((p) => ({
      kind: "monster" as const,
      entityId: p.id,
      name: p.name,
      portraitAssetId: p.portraitAssetId,
      hpMode: "average" as const,
      hasFormula: false,
      pet: true,
    })),
  ];
  const rows =
    scene && sceneLoaded
      ? previewJoin(slots, sceneTokens, {
          createTokens: draft.createTokens,
          hidden: draft.addHidden,
          sceneTokenNames: sceneTokens.map((t) => t.name),
        })
      : [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="cbt-enc-start-dialog">
        <DialogHeader>
          <DialogTitle>Start “{encounter.name}”</DialogTitle>
          <DialogDescription>
            {scene
              ? sceneLoaded
                ? `On “${scene.name}”. Tokens are bound in placement order.`
                : "Loading scene…"
              : "No scene to start on"}
          </DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-72 flex-col gap-1 overflow-auto text-sm">
          {rows.map((r, i) =>
            r.pet ? null : (
              // biome-ignore lint/suspicious/noArrayIndexKey: one row per combatant slot
              <Fragment key={i}>
                <JoinPreviewRow row={r} testId="cbt-enc-binding" />
                {/* FR-CBT-109: the PC's pets on the map under it, each with its tick. */}
                {r.kind === "pc" &&
                  offers
                    .filter((o) => o.pet.companionOf === r.entityId && o.onMap)
                    .map((o) => (
                      <PetPreviewRow
                        key={o.pet.id}
                        offer={o}
                        owner={r.name}
                        row={rows.find((x) => x.pet && x.entityId === o.pet.id)}
                        onChange={(v) => pickPet(o.pet.id, v)}
                      />
                    ))}
              </Fragment>
            ),
          )}
        </ul>
        {startKeptNoteShown(rows) && (
          <p className="text-xs text-muted-foreground" data-testid="cbt-enc-start-kept-note">
            {START_KEPT_NOTE}
          </p>
        )}
        {(offMap.length > 0 || offers.some((o) => !o.onMap)) && (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-xs font-medium text-muted-foreground">
              Not on this map
            </legend>
            {offMap.map((c) => {
              const id = `cbt-offmap-${c.id}`;
              return (
                <div key={c.id} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    data-testid="cbt-enc-not-on-map"
                    data-record-id={c.id}
                    checked={joining.has(c.id)}
                    onCheckedChange={(v) =>
                      setJoining((cur) => {
                        const next = new Set(cur);
                        if (v === true) next.add(c.id);
                        else next.delete(c.id);
                        return next;
                      })
                    }
                  />
                  <Label htmlFor={id} className="font-normal">
                    {c.name} <span className="text-xs text-muted-foreground">(no token)</span>
                  </Label>
                </div>
              );
            })}
            {/* FR-CBT-109: pets with no token here join token-less if ticked. */}
            {offers
              .filter((o) => !o.onMap)
              .map((o) => {
                const owner = joiningParty.find((c) => c.id === o.pet.companionOf)?.name ?? "";
                return (
                  <div key={o.pet.id} className="flex items-center gap-2">
                    <PetTick offer={o} owner={owner} onChange={(v) => pickPet(o.pet.id, v)} />
                    <span>
                      {o.pet.name}{" "}
                      <span className="text-xs text-muted-foreground">
                        ({owner}'s pet, no token)
                      </span>
                    </span>
                  </div>
                );
              })}
          </fieldset>
        )}
        <DifficultyCard draft={draft} partyIds={joiningParty.map((c) => c.id)} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            data-testid="cbt-enc-start-confirm"
            disabled={disabled || startEnd.disabled || !scene || !sceneLoaded}
            onClick={async () => {
              if (!scene || !sceneLoaded) return;
              // FR-CBT-65: created tokens go around the centre of this tab's free area.
              const at = freeAreaCell(free.area, scene);
              const body = startBody(
                encounter.id,
                scene.id,
                offMap,
                joining,
                at,
                joiningPets.map((p) => p.id),
              );
              // FR-CBT-60: once acked, Initiative opens in front, Encounters minimises, map refits.
              const r = await startEnd.start(body);
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

/** FR-CBT-143 / -146: names wrap between words only (never "Drake / Compa / nion"), never cut. */
const NAME_WRAP = "[overflow-wrap:normal] [word-break:normal]";
/**
 * FR-CBT-146: an entry row: the name (≥ 96 px, whole or wrapped between words) and CR, then the
 * controls on the same line when the name has its natural width there, else on a second line.
 */
const ENTRY_ROW = "flex flex-wrap items-center gap-x-2 gap-y-1 text-sm";
const ENTRY_CONTROLS = "ml-auto flex shrink-0 items-center gap-2";

export function EntryName({ name, cr }: { name: string; cr: string }) {
  return (
    <span className="flex max-w-full flex-[1_0_auto] items-baseline gap-2">
      <span data-testid="cbt-enc-entry-name" className={cn("min-w-24 flex-auto", NAME_WRAP)}>
        {name}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">CR {cr}</span>
    </span>
  );
}

export function Editor({ encounter, back }: { encounter: EncounterRecord; back(): void }) {
  // One array per store version (`useRecords` builds a fresh one per render), so `server` only
  // changes when the encounter or its entries do.
  const entriesById = useSync((s) => s.store.records[ENCOUNTER_ENTRY_TYPE]);
  const allEntries = useMemo(
    () => Object.values(entriesById ?? {}) as EncounterEntryRecord[],
    [entriesById],
  );
  const characters = useCharacters();
  const drafts = useDraftIds();
  const live = useSync((s) => s.state === "live");
  const { disabled } = useCbtIntent();
  const server = useMemo(() => draftOf(encounter, allEntries), [encounter, allEntries]);
  const [draft, setDraft] = useState<Draft>(server);
  // The draft's picks (not saved yet) load too (FR-CMP-16).
  const defs = useDefinitions(draft.entries.map((e) => e.definitionId));
  const [nameError, setNameError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const startEnd = useStartEnd();
  const dirty = useRef(false);
  const planned = encounter.status === "planned";
  const readOnly = !planned || !live;

  // Adopt server state when we have no local edits pending.
  useEffect(() => {
    // Same content → same state object: no re-render, no render loop (F1).
    if (!dirty.current) setDraft((d) => adoptServerDraft(d, server));
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
  const setQty = (key: string, q: number) =>
    edit((d) => ({
      ...d,
      entries: d.entries
        .map((e) => (entryKey(e) === key ? { ...e, quantity: q } : e))
        .filter((e) => e.quantity > 0),
    }));
  const partyIds = partyMembers(characters, draft.partyCharacterIds, drafts).map((c) => c.id);
  const [lookupQuery, setLookupQuery] = useState("");
  const lookupRows = useMonsterLookupRows(lookupQuery);

  return (
    // FR-CBT-147: header and action row pinned; the entries, options and party scroll between.
    <div
      className="flex h-full min-h-0 flex-col gap-3"
      data-testid="cbt-enc-editor"
      data-record-id={encounter.id}
    >
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="icon"
          variant="ghost"
          className="size-8 shrink-0"
          aria-label="Back"
          data-testid="cbt-enc-editor-back"
          onClick={back}
        >
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
      {nameError && <p className="shrink-0 text-xs text-destructive">{nameError}</p>}
      <div
        className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1"
        data-testid="cbt-enc-editor-body"
      >
        {planned && (
          <CreatureLookup
            rows={lookupRows}
            disabled={readOnly}
            onQueryChange={setLookupQuery}
            onPick={(id) => edit((d) => ({ ...d, entries: addPick(d.entries, id) }))}
          />
        )}
        <ul className="flex flex-col gap-1">
          {draft.entries.map((e) => {
            const d = defs.get(e.definitionId);
            const key = entryKey(e);
            return (
              <li
                key={key}
                data-testid="cbt-enc-entry"
                data-record-id={e.definitionId}
                data-value={e.quantity}
                data-side={e.side}
                className={ENTRY_ROW}
              >
                <EntryName
                  name={d?.name ?? "(unknown)"}
                  cr={d?.kind === "monster" ? d.statBlock.cr : "?"}
                />
                <span className={ENTRY_CONTROLS}>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    data-testid="cbt-enc-entry-dec"
                    data-record-id={e.definitionId}
                    aria-label="One fewer"
                    disabled={readOnly}
                    onClick={() => setQty(key, e.quantity - 1)}
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
                    onClick={() => setQty(key, e.quantity + 1)}
                  >
                    <PlusIcon className="size-3.5" />
                  </Button>
                  <HpSelect
                    value={e.hpMode}
                    hasFormula={d?.kind === "monster" && Boolean(d.statBlock.hpFormula)}
                    disabled={readOnly}
                    testId="cbt-enc-entry-hp"
                    recordId={e.definitionId}
                    onChange={(hpMode) =>
                      edit((x) => ({
                        ...x,
                        entries: x.entries.map((y) => (entryKey(y) === key ? { ...y, hpMode } : y)),
                      }))
                    }
                  />
                  {/* FR-CBT-98 (#252): a friendly entry's creatures start as allies. */}
                  <Tooltip content="Friendly: on the party's side, not counted in the difficulty">
                    <span className="flex shrink-0 items-center gap-1">
                      <HandshakeIcon className="size-3.5 text-muted-foreground" aria-hidden />
                      <Switch
                        data-testid="cbt-enc-entry-friendly"
                        data-record-id={e.definitionId}
                        data-value={e.side}
                        aria-label="Friendly"
                        disabled={readOnly}
                        checked={e.side === "ally"}
                        onCheckedChange={(on) =>
                          edit((x) => ({
                            ...x,
                            entries: setEntrySide(x.entries, key, on ? "ally" : "enemy"),
                          }))
                        }
                      />
                    </span>
                  </Tooltip>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    data-testid="cbt-enc-entry-remove"
                    data-record-id={e.definitionId}
                    aria-label="Remove"
                    disabled={readOnly}
                    onClick={() => setQty(key, 0)}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <div className="flex items-center gap-2">
            <Checkbox
              id="cbt-enc-create-tokens"
              data-testid="cbt-enc-create-tokens"
              disabled={readOnly}
              checked={draft.createTokens}
              onCheckedChange={(v) => edit((d) => ({ ...d, createTokens: v === true }))}
            />
            <Label htmlFor="cbt-enc-create-tokens" className="font-normal">
              Create tokens
            </Label>
          </div>
          <div className="flex items-center gap-2">
            {/* OQ-CBTX-22: disabled while Create tokens is off. */}
            <Checkbox
              id="cbt-enc-add-hidden"
              data-testid="cbt-enc-add-hidden"
              disabled={readOnly || !draft.createTokens}
              checked={draft.addHidden}
              onCheckedChange={(v) => edit((d) => ({ ...d, addHidden: v === true }))}
            />
            <Label htmlFor="cbt-enc-add-hidden" className="font-normal">
              Add hidden
            </Label>
          </div>
        </div>
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
      </div>
      <div
        className="flex shrink-0 flex-wrap items-center gap-2"
        data-testid="cbt-enc-editor-actions"
      >
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
            <EndConfirmDescription encounterId={encounter.id} area="cbt-enc" />
          </DialogHeader>
          <DialogFooter>
            {/* FR-KIT-72: Keep fighting / End encounter. */}
            <EndConfirmButtons
              testId="cbt-enc-end-confirm"
              disabled={disabled || startEnd.disabled}
              onKeep={() => setEnding(false)}
              onEnd={async () => {
                // FR-CBT-60: once acked, this tab's Initiative minimises.
                const r = await startEnd.end(encounter.id);
                if (r !== undefined) setEnding(false);
              }}
            />
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
                <span className={cn("min-w-0 flex-1", NAME_WRAP)} data-testid="cbt-enc-row-name">
                  {e.name}
                </span>
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
  usefulSize: { w: 440, h: 412 }, // FR-CBT-148: the editor's rows readable (FR-SHELL-79)
  defaultPosition: { anchor: "top-left", dx: 56 },
  launcher: { icon: SwordsIcon, label: "Encounters", order: 55 },
  component: EncountersBody,
});

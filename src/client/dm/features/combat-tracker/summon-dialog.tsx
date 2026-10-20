// DM Summon… (FR-CBT-110, -118; CBT §7, sprint 6): Dialog from the Initiative header
// (`cbt-init-summon`) or a PC row's "Summon for Mira…": creature lookup (FR-CBT-63's autocomplete
// over every monster incl. the compendium, through the shared matcher; pets excluded), count 1–8,
// owner PC Select (preset from the row), turn mode, HP Average / Rolled, Hidden, and "Linked to
// Mira's concentration (…)" shown iff she concentrates. Sends `cbt.summon`; the server decides.
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import { EFFECT_TYPE, type EffectView } from "@shared/combat-extras/schemas";
import {
  CBT_INTENTS,
  COMPANIONS_PER_OWNER_MAX,
  type CombatantView,
  type HpMode,
  type SummonInput,
} from "@shared/combat-tracker/schemas";
import { TURN_MODES, type TurnMode } from "@shared/entities/schemas";
import type { RecordStore } from "@shared/protocol/store";
import type { SceneFolderRecord, SceneRecord } from "@shared/scenes-map/schemas";
import { Button } from "@ui/components/ui/button";
import { Checkbox, ToggleGroup, ToggleGroupItem } from "@ui/components/ui/controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ui/components/ui/overlays";
import { Input, Label } from "@ui/components/ui/primitives";
import { MODE_MENU_LABEL } from "@ui/features/combat-tracker/companions";
import { CreatureLookup } from "@ui/features/combat-tracker/parts";
import {
  toastIntentError,
  useCombatants,
  useLive,
  useStartedEncounter,
} from "@ui/features/combat-tracker/store";
import { useCreatureLookup } from "@ui/features/compendium/lookup";
import { lazyApi } from "@ui/features/compendium/search";
import { useFreeArea } from "@ui/features/play-shell/free-area";
import { IntentRejected } from "@ui/sync/connection";
import { useRecords, useSync } from "@ui/sync/store";
import { useMemo, useState } from "react";
import { create } from "zustand";
import { creatureRows } from "../entities/list";
import { useDmMap, viewedScene } from "../scenes-map/view-state";
import { useDefinitions } from "./data";
import { HpSelect } from "./join-parts";
import { freeAreaCell } from "./place-at";

/** The DM REST client, imported lazily (the session reads localStorage at import). */
const api = lazyApi(() => import("../campaign-management/session").then((m) => m.api));

interface SummonDialogState {
  open: boolean;
  /** Preset owner (a PC row's "Summon for Mira…"); null = the first eligible PC. */
  ownerCharacterId: string | null;
  openFor(ownerCharacterId?: string | null): void;
  close(): void;
}

export const useSummonDialog = create<SummonDialogState>((set) => ({
  open: false,
  ownerCharacterId: null,
  openFor: (ownerCharacterId = null) => set({ open: true, ownerCharacterId }),
  close: () => set({ open: false, ownerCharacterId: null }),
}));

/** A PC of the fight that may own a summon (FR-CBT-105: active, not removed, with a player). */
export interface SummonOwner {
  characterId: string;
  name: string;
  hasPlayer: boolean;
}

/** FR-CBT-110: the fight's active PCs, one per character, in rank order. */
export function summonOwners(
  rows: readonly CombatantView[],
  entities: Readonly<Record<string, unknown>> | undefined,
): SummonOwner[] {
  const seen = new Set<string>();
  const out: SummonOwner[] = [];
  for (const r of rows) {
    if (r.kind !== "pc" || r.removed || r.active === false || !r.entityId) continue;
    if (seen.has(r.entityId)) continue;
    seen.add(r.entityId);
    const ch = entities?.[r.entityId] as { ownerPlayerId?: string | null } | undefined;
    out.push({ characterId: r.entityId, name: r.name, hasPlayer: Boolean(ch?.ownerPlayerId) });
  }
  return out;
}

/** The owner's active concentration ("Conjure Elemental"), else null (the tick is hidden). */
export function concentrationOf(store: RecordStore, characterId: string | null): string | null {
  if (!characterId) return null;
  const e = (Object.values(store.records[EFFECT_TYPE] ?? {}) as EffectView[]).find(
    (x) => !x.endedAt && x.kind === "concentration" && x.targetCharacterId === characterId,
  );
  return e ? (e.label ?? "") : null;
}

export interface SummonForm {
  definitionId: string | null;
  count: number;
  ownerCharacterId: string | null;
  turnMode: TurnMode;
  hpMode: HpMode;
  hidden: boolean;
  linkConcentration: boolean;
}

/** The intent for a filled form; null while a creature or owner is missing. */
export function summonInput(
  encounterId: string,
  f: SummonForm,
  concentrating: boolean,
  at: { col: number; row: number } | null,
): SummonInput | null {
  if (!f.definitionId || !f.ownerCharacterId) return null;
  if (f.count < 1 || f.count > COMPANIONS_PER_OWNER_MAX) return null;
  return {
    encounterId,
    definitionId: f.definitionId,
    count: f.count,
    ownerCharacterId: f.ownerCharacterId,
    turnMode: f.turnMode,
    hpMode: f.hpMode,
    ...(f.hidden ? { hidden: true } : {}),
    ...(concentrating && f.linkConcentration ? { linkConcentration: true } : {}),
    ...(at ? { at } : {}),
  };
}

/** `freeCell`: the DM's free-area centre cell on the viewed scene (FR-CBT-65), read at send. */
export function SummonBody({
  preset,
  freeCell,
}: {
  preset: string | null;
  freeCell(scene: SceneRecord): { col: number; row: number } | null;
}) {
  const close = useSummonDialog((s) => s.close);
  const connection = useSync((s) => s.connection);
  const live = useLive();
  const store = useSync((s) => s.store);
  const enc = useStartedEncounter();
  const rows = useCombatants(enc?.id);
  const entities = useRecords<{ id: string; companionOf?: string | null }>("entity");
  const players = useRecords<PlayerRecord>("player");
  const scenes = useRecords<SceneRecord>("scene");
  const folders = useRecords<SceneFolderRecord>("scene-folder");
  const viewed = viewedScene(
    scenes,
    folders,
    useDmMap((s) => s.viewedSceneId),
  );
  const owners = useMemo(
    () => summonOwners(rows, store.records.entity),
    [rows, store.records.entity],
  );
  // Store monsters minus pets (they join as themselves); imported ones come from the search.
  const storeOptions = useMemo(() => {
    const pets = new Set(entities.filter((e) => e.companionOf).map((e) => e.id));
    return creatureRows(entities, [], players, "monster").filter((r) => !pets.has(r.id));
  }, [entities, players]);
  const [query, setQuery] = useState("");
  const options = useCreatureLookup(api, storeOptions, query);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const defs = useDefinitions(picked ? [picked.id] : []);
  const firstOwner = owners.find((o) => o.hasPlayer)?.characterId ?? null;
  const [form, setForm] = useState<SummonForm>({
    definitionId: null,
    count: 1,
    ownerCharacterId: preset ?? firstOwner,
    turnMode: "after-owner",
    hpMode: "average",
    hidden: false,
    // Integrator ruling (walkthrough): unticked; the DM ticks it (the PC may concentrate on Bless).
    linkConcentration: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const owner = owners.find((o) => o.characterId === form.ownerCharacterId) ?? null;
  const concentration = concentrationOf(store, form.ownerCharacterId);
  const scene = scenes.find((s) => s.id === enc?.sceneId) ?? null;
  const set = (patch: Partial<SummonForm>) => {
    setError(null);
    setForm((f) => ({ ...f, ...patch }));
  };
  const submit = async () => {
    if (!enc) return;
    // FR-CBT-65: `at` only while this tab views the encounter's scene (the owner's token wins).
    const at = scene && viewed?.id === scene.id ? freeCell(scene) : null;
    const input = summonInput(enc.id, form, concentration !== null, at);
    if (!input) return;
    setBusy(true);
    try {
      await connection.sendIntent(CBT_INTENTS.summon, input);
      close();
    } catch (err) {
      if (err instanceof IntentRejected) setError(err.message);
      else toastIntentError(err);
    } finally {
      setBusy(false);
    }
  };
  const ready = enc !== null && summonInput(enc.id, form, false, null) !== null;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{owner ? `Summon for ${owner.name}` : "Summon"}</DialogTitle>
        <DialogDescription>
          Summons join this fight on the party's side and go when they're dismissed or it ends.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3 text-sm">
        {picked ? (
          <div className="flex items-center gap-2">
            <span data-testid="cbt-summon-picked" data-record-id={picked.id} className="flex-1">
              {picked.name}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPicked(null);
                set({ definitionId: null });
              }}
            >
              Change
            </Button>
          </div>
        ) : (
          <CreatureLookup
            rows={options}
            testId="cbt-summon-lookup"
            placeholder="Summon which creature?"
            onQueryChange={setQuery}
            onPick={(id) => {
              const o = options.find((x) => x.id === id);
              if (!o) return;
              setPicked({ id: o.id, name: o.name });
              set({ definitionId: o.id });
            }}
          />
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Label htmlFor="cbt-summon-count" className="font-normal">
            Count
          </Label>
          <Input
            id="cbt-summon-count"
            data-testid="cbt-summon-count"
            type="number"
            min={1}
            max={COMPANIONS_PER_OWNER_MAX}
            value={form.count}
            className="h-7 w-16"
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              set({ count: Math.min(COMPANIONS_PER_OWNER_MAX, Math.max(1, n || 1)) });
            }}
          />
          <Label className="font-normal">Owner</Label>
          <Select
            value={form.ownerCharacterId ?? ""}
            onValueChange={(v) => set({ ownerCharacterId: v })}
          >
            <SelectTrigger
              data-testid="cbt-summon-owner"
              data-value={form.ownerCharacterId ?? ""}
              aria-label="Owner"
              className="h-7 w-36 px-2 text-xs"
            >
              <SelectValue placeholder="Pick a character" />
            </SelectTrigger>
            <SelectContent>
              {owners.map((o) => (
                <SelectItem
                  key={o.characterId}
                  value={o.characterId}
                  data-value={o.characterId}
                  disabled={!o.hasPlayer}
                >
                  {o.hasPlayer ? o.name : `${o.name} (no player)`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ToggleGroup
          type="single"
          aria-label="Turn mode"
          value={form.turnMode}
          onValueChange={(v) => v && set({ turnMode: v as TurnMode })}
          className="flex flex-wrap gap-1"
        >
          {TURN_MODES.map((m) => (
            <ToggleGroupItem
              key={m}
              value={m}
              data-testid="cbt-summon-mode"
              data-value={m}
              className="h-7 px-2 text-xs"
            >
              {MODE_MENU_LABEL[m]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <HpSelect
            value={form.hpMode}
            hasFormula={Boolean(picked && defs.get(picked.id)?.statBlock.hpFormula)}
            disabled={false}
            testId="cbt-summon-hp"
            recordId={picked?.id ?? ""}
            onChange={(hpMode) => set({ hpMode })}
          />
          <div className="flex items-center gap-2">
            <Checkbox
              id="cbt-summon-hidden"
              data-testid="cbt-summon-hidden"
              checked={form.hidden}
              onCheckedChange={(v) => set({ hidden: v === true })}
            />
            <Label htmlFor="cbt-summon-hidden" className="font-normal">
              Hidden
            </Label>
          </div>
          {concentration !== null && owner && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="cbt-summon-concentration"
                data-testid="cbt-summon-concentration"
                checked={form.linkConcentration}
                onCheckedChange={(v) => set({ linkConcentration: v === true })}
              />
              <Label htmlFor="cbt-summon-concentration" className="font-normal">
                Linked to {owner.name}'s concentration{concentration ? ` (${concentration})` : ""}
              </Label>
            </div>
          )}
        </div>
        {error && (
          <p data-testid="cbt-summon-error" role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button
          data-testid="cbt-summon-submit"
          disabled={!live || busy || !ready}
          onClick={() => void submit()}
        >
          Summon{form.count > 1 ? ` ${form.count}` : ""}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Mounted once by the Initiative window's companion (with the attack popup and HP dialog). */
export function SummonDialog() {
  const open = useSummonDialog((s) => s.open);
  const preset = useSummonDialog((s) => s.ownerCharacterId);
  const close = useSummonDialog((s) => s.close);
  const free = useFreeArea();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent data-testid="cbt-summon">
        {open && (
          <SummonBody
            key={preset ?? ""}
            preset={preset}
            freeCell={(scene) => freeAreaCell(free.area, scene)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// Sheet section `mod.effects` (FR-MOD-26, MOD §7): tab "Active effects", both clients,
// characters. Active: every effect on the character (conditions, custom, concentration) with
// rounds left and its modifier parts in words; DM: Modifiers… (custom), End; owner: End own
// concentration. Toggles: the character's presets as switches (owner, DM; also on a locked
// sheet); tier 3: uses left "2 / 3" or "Uses link broken", DM "Force on" at 0 (FR-MOD-12); at 0
// left the Switch asks "Rage anyway?" and sends `overspend` ("−1 / 3" in red, FR-MOD-59).
// Presets: New, Start from ▸ (keeps the built-in as `originKey`), Edit, Delete (owner unless
// locked, DM). Triggers (FR-MOD-49): the character's rule triggers, lazy-loaded when the tab
// opens (owner, DM; `./triggers`). Store reads only.

import { leftText } from "@shared/character-sheet/counters";
import type { FeatureRow } from "@shared/character-sheet/sheet";
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import { effectName } from "@shared/combat-extras/rules";
import type { EffectView } from "@shared/combat-extras/schemas";
import { MOD_INTENTS } from "@shared/effect-modifiers/intents";
import { builtinPresets } from "@shared/effect-modifiers/presets";
import {
  choiceValue,
  type PresetChoice,
  presetChoices,
  presetUses,
  toggleOn,
} from "@shared/effect-modifiers/rules";
import {
  type BuiltinPresetKey,
  type EffectPresetRecord,
  isBuiltinPresetKey,
} from "@shared/effect-modifiers/schemas";
import {
  ChevronRightIcon,
  PencilIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  TrashIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "../../components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Switch,
} from "../../components/ui/menus";
import { useSync } from "../../sync/store";
import { OverspendPopover, OverspentTip } from "../character-sheet/overspend";
import type { SheetSection } from "../character-sheet/sections";
import { EffectIcon, effectValue } from "../combat-extras/icons";
import {
  activeEffects,
  characterOf,
  chipOrder,
  effectsOn,
  roundsLeftText,
} from "../combat-extras/logic";
import { useStartedEncounter } from "../combat-tracker/store";
import { modifiersText } from "./describe";
import { blankPreset, EffectModifiersDialog, PresetDialog, type PresetDraft } from "./dialogs";
import { presetsIn, sheetIn, useModIntent } from "./store";
import { TriggersBlock } from "./triggers";

function Block({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen data-testid={testId} className="group grid gap-1">
      <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium uppercase text-muted-foreground">
        <ChevronRightIcon className="size-3 transition-transform group-data-[state=open]:rotate-90" />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-1 pl-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

const draftFromRow = (p: EffectPresetRecord): PresetDraft => ({
  id: p.id,
  characterId: p.characterId,
  key: null,
  name: p.name,
  modifiers: p.modifiers,
  durationRounds: p.durationRounds,
  concentration: p.concentration,
  note: p.note,
  usesFeatureId: p.usesFeatureId,
});

/** FR-MOD-36: the built-in a "Start from" entry stands for (a campaign preset: its own origin). */
const originOf = (c: PresetChoice): BuiltinPresetKey | null =>
  c.source !== "campaign"
    ? c.key
    : isBuiltinPresetKey(c.preset.originKey)
      ? c.preset.originKey
      : null;

function ActiveRow({
  e,
  round,
  isDm,
  ownConcentration,
  onEdit,
}: {
  e: EffectView;
  round: number | null;
  isDm: boolean;
  ownConcentration: boolean;
  onEdit(): void;
}) {
  const { send, disabled } = useModIntent();
  const Icon = EffectIcon(e);
  const left = roundsLeftText(e, round);
  const parts = modifiersText(e.modifiers);
  return (
    <div
      data-testid="mod-active"
      data-record-id={e.id}
      data-value={effectValue(e)}
      className="flex items-start gap-2 text-sm"
    >
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate">
          {effectName(e)}
          {left && <span className="text-muted-foreground"> · {left}</span>}
        </div>
        {parts && (
          <div data-testid="mod-active-parts" className="text-xs text-muted-foreground">
            {parts}
          </div>
        )}
      </div>
      {isDm && e.kind === "custom" && (
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          data-testid="mod-active-edit"
          aria-label={`Modifiers of ${effectName(e)}`}
          disabled={disabled}
          onClick={onEdit}
        >
          <SlidersHorizontalIcon className="size-3.5" />
        </Button>
      )}
      {(isDm || ownConcentration) && (
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          data-testid="mod-active-end"
          aria-label={`End ${effectName(e)}`}
          disabled={disabled}
          onClick={() => void send(CBTX_INTENTS.endEffect, { effectId: e.id })}
        >
          <TrashIcon className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

function ToggleRow({
  p,
  on,
  may,
  isDm,
  features,
}: {
  p: EffectPresetRecord;
  on: boolean;
  may: boolean;
  isDm: boolean;
  features: readonly FeatureRow[] | undefined;
}) {
  const { send, disabled } = useModIntent();
  const [ask, setAsk] = useState(false);
  const uses = presetUses(p, features);
  const toggle = (v: boolean, o: { force?: true; overspend?: true } = {}) =>
    void send(MOD_INTENTS.toggle, {
      characterId: p.characterId,
      presetId: p.id,
      on: v,
      ...o,
    });
  // FR-MOD-59: no use left → ask "Rage anyway?" first, then send `overspend`.
  const noneLeft = uses?.state === "ok" && uses.left <= 0;
  const switchEl = (
    // Radix owns the Switch's own `data-state` (checked / unchecked): the wrapper carries ours.
    <span
      data-testid="mod-toggle"
      data-record-id={p.id}
      data-state={on ? "on" : "off"}
      className="inline-flex"
    >
      <Switch
        data-testid="mod-toggle-switch"
        data-record-id={p.id}
        aria-label={`${p.name} ${on ? "on" : "off"}`}
        checked={on}
        disabled={!may || disabled}
        onCheckedChange={(v) => (v && noneLeft ? setAsk(true) : toggle(v))}
      />
    </span>
  );
  return (
    <div className="flex items-center gap-2 text-sm">
      {uses?.state === "ok" ? (
        <OverspendPopover
          open={ask}
          onOpenChange={setAsk}
          name={uses.name}
          left={uses.left}
          max={uses.max}
          verb={p.name}
          testId="mod-toggle-overspend"
          disabled={!may || disabled}
          onConfirm={() => toggle(true, { overspend: true })}
        >
          {switchEl}
        </OverspendPopover>
      ) : (
        switchEl
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate">
          {p.name}
          {uses?.state === "ok" && (
            // FR-MOD-68: the count shows the minus once; no overspent Badge beside it.
            <OverspentTip left={uses.left}>
              <span
                data-testid="mod-toggle-uses"
                data-record-id={p.id}
                data-state="ok"
                data-value={`${uses.left}/${uses.max}`}
                className={uses.left < 0 ? "text-hp-down" : "text-muted-foreground"}
              >
                {" "}
                {leftText(uses.left)} / {uses.max}
              </span>
            </OverspentTip>
          )}
        </div>
        {uses?.state === "broken" && (
          <div
            data-testid="mod-toggle-uses"
            data-record-id={p.id}
            data-state="broken"
            className="text-xs text-destructive"
          >
            Uses link broken
          </div>
        )}
        <div className="text-xs text-muted-foreground">{modifiersText(p.modifiers)}</div>
      </div>
      {isDm && !on && noneLeft && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          data-testid="mod-toggle-force"
          data-record-id={p.id}
          disabled={disabled}
          onClick={() => toggle(true, { force: true })}
        >
          Force on
        </Button>
      )}
    </div>
  );
}

export function ActiveEffectsSection({
  creatureId,
}: {
  creatureId: string;
  client: "dm" | "player";
}) {
  const store = useSync((s) => s.store);
  const enc = useStartedEncounter();
  const { send, disabled } = useModIntent();
  const [editing, setEditing] = useState<EffectView | null>(null);
  const [form, setForm] = useState<{ start: PresetDraft; title: string } | null>(null);
  const you = store.you;
  const isDm = you?.role === "dm";
  const owner = characterOf(store, creatureId)?.ownerPlayerId === you?.playerId && !isDm;
  const sheet = sheetIn(store, creatureId);
  const mayToggle = isDm || owner;
  const mayEditPresets = isDm || (owner && !sheet?.locked);
  const round = enc?.round ?? null;
  const effects = chipOrder(effectsOn(activeEffects(store), { characterId: creatureId }));
  const all = presetsIn(store);
  const toggles = all.filter((p) => p.characterId === creatureId);
  // "Start from ▸": the DM's preset list (customised + built-in + campaign); players the built-ins.
  const from = (
    p: Pick<PresetDraft, "name" | "modifiers" | "durationRounds" | "concentration" | "note">,
    originKey: BuiltinPresetKey | null,
  ): PresetDraft => ({
    characterId: creatureId,
    key: null,
    originKey,
    name: p.name,
    modifiers: p.modifiers,
    durationRounds: p.durationRounds,
    concentration: p.concentration,
    note: p.note,
  });
  const choices = isDm
    ? presetChoices(all).map((c) => ({
        value: choiceValue(c),
        draft: from(c.preset, originOf(c)),
        label: c.source === "customised" ? `${c.preset.name} (Customised)` : c.preset.name,
      }))
    : builtinPresets().map((b) => ({ value: b.key, draft: from(b, b.key), label: b.name }));
  return (
    <div data-testid="mod-section" className="grid gap-3 p-2">
      <Block title="Active" testId="mod-active-block">
        {effects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active effects</p>
        ) : (
          effects.map((e) => (
            <ActiveRow
              key={e.id}
              e={e}
              round={round}
              isDm={isDm}
              ownConcentration={owner && e.kind === "concentration"}
              onEdit={() => setEditing(e)}
            />
          ))
        )}
      </Block>
      <Block title="Toggles" testId="mod-toggles-block">
        {toggles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No toggles yet — New or Start from a preset
          </p>
        ) : (
          toggles.map((p) => (
            <ToggleRow
              key={p.id}
              p={p}
              on={toggleOn(p, effects)}
              may={mayToggle}
              isDm={isDm}
              features={sheet?.features}
            />
          ))
        )}
      </Block>
      {(isDm || owner) && (
        <Block title="Presets" testId="mod-presets-block">
          {toggles.map((p) => (
            <div
              key={p.id}
              data-testid="mod-preset"
              data-record-id={p.id}
              className="flex items-center gap-1 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {mayEditPresets && (
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-6"
                    data-testid="mod-preset-edit"
                    aria-label={`Edit ${p.name}`}
                    onClick={() => setForm({ start: draftFromRow(p), title: `Edit ${p.name}` })}
                  >
                    <PencilIcon className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-6"
                    data-testid="mod-preset-delete"
                    aria-label={`Delete ${p.name}`}
                    disabled={disabled}
                    onClick={() => void send(MOD_INTENTS.deletePreset, { presetId: p.id })}
                  >
                    <TrashIcon className="size-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
          {mayEditPresets ? (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                data-testid="mod-preset-new"
                onClick={() => setForm({ start: blankPreset(creatureId), title: "New toggle" })}
              >
                <PlusIcon /> New
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    data-testid="mod-preset-from-menu"
                  >
                    Start from <ChevronRightIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Start from</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {choices.map((c) => (
                    <DropdownMenuItem
                      key={c.value}
                      data-testid="mod-preset-from"
                      data-value={c.value}
                      onSelect={() =>
                        setForm({ start: c.draft, title: `New toggle from ${c.label}` })
                      }
                    >
                      {c.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Locked by the DM</p>
          )}
        </Block>
      )}
      {(isDm || owner) && (
        <Block title="Triggers" testId="mod-triggers-block">
          <TriggersBlock owner={{ kind: "character", id: creatureId }} />
        </Block>
      )}
      <EffectModifiersDialog effect={editing} onClose={() => setEditing(null)} />
      <PresetDialog
        start={form?.start ?? null}
        title={form?.title ?? ""}
        onClose={() => setForm(null)}
      />
    </div>
  );
}

/** The registry line's entry (CHARX §7.1): tab after Notes, both clients, characters. */
export const modEffectsSection: SheetSection = {
  id: "mod.effects",
  slot: "tab",
  order: 10,
  title: "Active effects",
  kinds: ["character"],
  component: ActiveEffectsSection,
};

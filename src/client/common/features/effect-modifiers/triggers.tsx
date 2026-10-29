// Triggers block (FR-MOD-49, MOD §7): one row per rule trigger of the owner — enabled Switch +
// name, the rule as a muted sentence, "= 1d6+2" (the formula for this owner now), "Uses link
// broken" / "Requires a missing preset". Owner unless locked, DM: New, Start from ▸ (the built-in
// trigger presets for the owner kind, FR-MOD-46), Edit, Delete. `rule-trigger` is lazy (FR-MOD-47,
// ADR-0045): loaded when the block mounts (the Active effects tab opens), once per snapshot
// generation; "Loading triggers…" until ready, "Couldn't load triggers" + Retry on error. Used by
// the sheet section (characters) and the DM's token menu / Creatures entries (FR-MOD-28).
// Sprint 4 (FR-MOD-60): a character's enabled trigger shows a state Badge after its name, from
// its `trigger-state` row in a started encounter, else armed from the store (same words as the
// Initiative and token badges).

import { triggerArmedNow } from "@shared/effect-modifiers/preview";
import { TRIGGER_INTENTS } from "@shared/effect-modifiers/trigger-intents";
import { triggerPresetsFor } from "@shared/effect-modifiers/trigger-presets";
import {
  CHARACTER_TRIGGERS_MAX,
  DEFINITION_TRIGGERS_MAX,
  type PlayerRuleTriggerRecord,
  RULE_TRIGGER_TYPE,
} from "@shared/effect-modifiers/trigger-records";
import {
  armedBadge,
  TRIGGER_STATE_TYPE,
  type TriggerBadge,
  type TriggerStateRecord,
  triggerBadge,
} from "@shared/effect-modifiers/trigger-state";
import type { TriggerWordsContext } from "@shared/effect-modifiers/trigger-words";
import {
  presetRefName,
  TRIGGER_WARNING_TEXT,
  triggerSentence,
  triggerValueNow,
  triggerWarnings,
} from "@shared/effect-modifiers/trigger-words";
import type { RecordStore } from "@shared/protocol/store";
import { ChevronRightIcon, PencilIcon, PlusIcon, RotateCwIcon, TrashIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Switch,
} from "../../components/ui/menus";
import { Tooltip } from "../../components/ui/overlays";
import { Badge } from "../../components/ui/primitives";
import { Tip } from "../../components/ui/tip";
import { cn } from "../../lib/utils";
import { useLazyRecords, useSync } from "../../sync/store";
import { useModIntent } from "./store";
import { TriggerEditorDialog, type TriggerEditorStart } from "./trigger-editor";
import { blankTrigger, draftFromPreset, draftOfRule } from "./trigger-editor-model";
import {
  mayEditTriggers,
  ownerTriggers,
  type TriggerOwnerFacts,
  type TriggerOwnerRef,
  triggerOwnerFacts,
  useOwnerDefinitions,
  wordsContext,
} from "./trigger-owner";

const BADGE_CLASS: Record<TriggerBadge["state"], string> = {
  ready: "border-success/50 text-success",
  "in-effect": "border-success/50 text-success",
  used: "text-muted-foreground",
  waiting: "",
  off: "border-dashed text-muted-foreground",
};

/**
 * FR-MOD-60: a character trigger's state. In a started encounter its `trigger-state` row (the
 * viewer holds it: DM, owner); otherwise (or no row) armed from the store, no charge.
 */
export function triggerBadgeOf(
  store: RecordStore,
  t: PlayerRuleTriggerRecord,
  facts: TriggerOwnerFacts,
  cx: TriggerWordsContext,
): TriggerBadge | null {
  if (!t.enabled || t.characterId === null) return null;
  const needs = t.rule.requires ? presetRefName(t.rule.requires, cx) : null;
  const row = Object.values(store.records[TRIGGER_STATE_TYPE] ?? {}).find(
    (r) => (r as TriggerStateRecord).triggerId === t.id,
  ) as TriggerStateRecord | undefined;
  if (!row)
    return armedBadge(triggerArmedNow(store, t.rule, { characterId: t.characterId }), needs);
  const every = t.rule.every;
  const f =
    typeof every === "object" ? facts.features?.find((x) => x.id === every.feature) : undefined;
  return triggerBadge(row, {
    every,
    ownerName: facts.name,
    needs,
    uses: f?.usesMax ? { left: f.usesMax - f.used, max: f.usesMax } : null,
  });
}

function TriggerRow({
  t,
  facts,
  may,
  onEdit,
}: {
  t: PlayerRuleTriggerRecord;
  facts: TriggerOwnerFacts;
  may: boolean;
  onEdit(): void;
}) {
  const store = useSync((s) => s.store);
  const { send, disabled, live } = useModIntent();
  const cx = wordsContext(store, facts.features);
  const value = triggerValueNow(t.rule, facts.values);
  const warnings = triggerWarnings(t.rule, facts.features, cx);
  const badge = triggerBadgeOf(store, t, facts, cx);
  // A player's copy may name a DM's preset as `{name}`; the server keeps it (FR-MOD-47, #228).
  const owner = t.characterId
    ? { characterId: t.characterId }
    : { definitionId: t.definitionId as string };
  const setEnabled = (enabled: boolean) => {
    void send(TRIGGER_INTENTS.putTrigger, {
      trigger: { id: t.id, ...owner, name: t.name, enabled, public: t.public, rule: t.rule },
    });
  };
  return (
    <div
      data-testid="mod-trigger"
      data-record-id={t.id}
      data-state={t.enabled ? "on" : "off"}
      className="flex items-start gap-2 text-sm"
    >
      <Switch
        data-testid="mod-trigger-enabled"
        data-record-id={t.id}
        className="mt-0.5"
        aria-label={`${t.name} ${t.enabled ? "on" : "off"}`}
        checked={t.enabled}
        disabled={!may || disabled}
        onCheckedChange={setEnabled}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="min-w-0 truncate">{t.name}</span>
          {badge && (
            <Tooltip content={triggerSentence(t.rule, cx)}>
              <Badge
                variant="outline"
                data-testid="mod-trigger-state"
                data-record-id={t.id}
                data-state={badge.state}
                className={cn(
                  "shrink-0",
                  badge.down ? "border-hp-down/50 text-hp-down" : BADGE_CLASS[badge.state],
                )}
              >
                {badge.text}
              </Badge>
            </Tooltip>
          )}
          {value?.ok && (
            <Badge
              variant="outline"
              data-testid="mod-trigger-value"
              data-value={value.value.expression ?? "0"}
              className="shrink-0 font-mono"
            >
              = {value.value.expression ?? "0"}
            </Badge>
          )}
        </div>
        <div data-testid="mod-trigger-sentence" className="text-xs text-muted-foreground">
          {triggerSentence(t.rule, cx)}
        </div>
        {value && !value.ok && (
          <div
            data-testid="mod-trigger-warning"
            data-value="formula"
            className="text-xs text-destructive"
          >
            {value.error.message}
          </div>
        )}
        {warnings.map((w) => (
          <div
            key={w}
            data-testid="mod-trigger-warning"
            data-value={w}
            className="text-xs text-destructive"
          >
            {TRIGGER_WARNING_TEXT[w]}
          </div>
        ))}
      </div>
      {may && (
        <>
          <Tip content={`Edit ${t.name}`} off={!live}>
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              data-testid="mod-trigger-edit"
              data-record-id={t.id}
              aria-label={`Edit ${t.name}`}
              disabled={!live}
              onClick={onEdit}
            >
              <PencilIcon className="size-3.5" />
            </Button>
          </Tip>
          <Tip content={`Delete ${t.name}`} off={disabled}>
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              data-testid="mod-trigger-delete"
              data-record-id={t.id}
              aria-label={`Delete ${t.name}`}
              disabled={disabled}
              onClick={() => void send(TRIGGER_INTENTS.deleteTrigger, { triggerId: t.id })}
            >
              <TrashIcon className="size-3.5" />
            </Button>
          </Tip>
        </>
      )}
    </div>
  );
}

/** The owner's triggers with their states and controls (no frame: callers wrap it). */
export function TriggersBlock({ owner }: { owner: TriggerOwnerRef }) {
  const store = useSync((s) => s.store);
  const { live } = useModIntent();
  const { rows, state, retry } = useLazyRecords<PlayerRuleTriggerRecord>(RULE_TRIGGER_TYPE);
  const [editor, setEditor] = useState<TriggerEditorStart | null>(null);
  const facts = triggerOwnerFacts(store, owner, useOwnerDefinitions(owner));
  const may = mayEditTriggers(store, owner);
  const mine = ownerTriggers(rows, owner, store.you?.role);
  const cap = owner.kind === "character" ? CHARACTER_TRIGGERS_MAX : DEFINITION_TRIGGERS_MAX;
  const full = mine.length >= cap;
  const open = (
    draft: TriggerEditorStart["draft"],
    title: string,
    id?: string,
    confirm: TriggerEditorStart["confirm"] = [],
  ) => setEditor({ owner, draft, title, confirm, ...(id ? { id } : {}) });
  return (
    <div data-testid="mod-triggers" className="grid gap-1">
      {state === "loading" ? (
        <p
          data-testid="mod-trigger-loading"
          data-state="loading"
          className="text-sm text-muted-foreground"
        >
          Loading triggers…
        </p>
      ) : state === "error" ? (
        <div
          data-testid="mod-trigger-loading"
          data-state="error"
          className="flex items-center gap-2 text-sm"
        >
          <span className="text-destructive">Couldn't load triggers</span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            data-testid="mod-trigger-retry"
            onClick={retry}
          >
            <RotateCwIcon className="size-3" /> Retry
          </Button>
        </div>
      ) : (
        <>
          {mine.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No triggers yet — New or Start from a preset
            </p>
          ) : (
            mine.map((t) => (
              <TriggerRow
                key={t.id}
                t={t}
                facts={facts}
                may={may}
                onEdit={() => open(draftOfRule(t, t.rule), `Edit ${t.name}`, t.id)}
              />
            ))
          )}
          {may ? (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                data-testid="mod-trigger-new"
                disabled={full || !live}
                onClick={() => open(blankTrigger(owner.kind), "New trigger")}
              >
                <PlusIcon /> New
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    data-testid="mod-trigger-from-menu"
                    disabled={full || !live}
                  >
                    Start from <ChevronRightIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Start from</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {triggerPresetsFor(owner.kind).map((p) => (
                    <DropdownMenuItem
                      key={p.key}
                      data-testid="mod-trigger-from"
                      data-value={p.key}
                      onSelect={() => {
                        const f = draftFromPreset(p.key, { ...owner, features: facts.features });
                        if (f) open(f.draft, `New trigger from ${p.name}`, undefined, f.confirm);
                      }}
                    >
                      {p.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {full && <span className="text-xs text-muted-foreground">At most {cap}</span>}
            </div>
          ) : (
            owner.kind === "character" &&
            facts.locked &&
            facts.ownerPlayerId === store.you?.playerId && (
              <p className="text-xs text-muted-foreground">Locked by the DM</p>
            )
          )}
        </>
      )}
      <TriggerEditorDialog start={editor} onClose={() => setEditor(null)} />
    </div>
  );
}

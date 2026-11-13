// Token forms, both clients (FORM §6, §7; ADR-0081): the token menu's Form ▸ submenu, the sheet
// header's Form picker with its "while Rage is on" line, the preset form's Token form field and
// the DM's Token forms row. Store reads only; every change is one intent (`forms.put`,
// `forms.choose`); the server decides what the tokens show.
import type { EffectView } from "@shared/combat-extras/schemas";
import { toggleOn } from "@shared/effect-modifiers/rules";
import type { EffectPresetRecord } from "@shared/effect-modifiers/schemas";
import { ENTITY_TYPE, type EntityRecord } from "@shared/entities/schemas";
import type { RecordStore } from "@shared/protocol/store";
import {
  FORM_INTENTS,
  FORM_NAME_MAX,
  FORMS_MAX,
  type TokenForm,
  type TokenFormInput,
} from "@shared/token-forms/schemas";
import { ImageIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "../../components/ui/menus";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/overlays";
import { Input, Label } from "../../components/ui/primitives";
import { Tip } from "../../components/ui/tip";
import { useSync } from "../../sync/store";
import { AssetImg } from "../assets-pipeline/AssetImg";
import { AssetPickerDialog } from "../assets-pipeline/AssetPicker";
import { activeEffects, effectsOn } from "../combat-extras/logic";
import { presetsIn } from "../effect-modifiers/store";
import { toastReject, useMapIntent } from "../scenes-map/intents";

/** The "Base" value in Selects and radio groups (no form: each token's own art). */
export const BASE = "base";

/** The character's forms, from a full character record; [] for anything else (redacted, monster). */
export function formsOf(e: unknown): readonly TokenForm[] {
  const r = e as Partial<Extract<EntityRecord, { kind: "character" }>> | undefined;
  return r?.kind === "character" && Array.isArray(r.tokenForms) ? r.tokenForms : [];
}

/** The full character record the store holds (DM; owner), else undefined. */
export const characterIn = (store: RecordStore, id: string | null) =>
  id ? (store.records[ENTITY_TYPE]?.[id] as EntityRecord | undefined) : undefined;

/** Player token menu: a token of a character this client holds in full, with ≥ 1 form. */
export const hasForms = (store: RecordStore, characterId: string | null): boolean =>
  formsOf(characterIn(store, characterId)).length > 0;

/**
 * FR-FORM-14: which on-toggle preset gives the shown form (the server's FR-FORM-05 order: the one
 * started last; players get no start times, so among several the one whose image a token shows).
 */
export function presetFormShown(
  forms: readonly TokenForm[],
  presets: readonly EffectPresetRecord[],
  effects: readonly Pick<EffectView, "id" | "endedAt">[],
  tokenImages: readonly (string | null | undefined)[],
): { preset: EffectPresetRecord; form: TokenForm } | null {
  const on = presets.flatMap((p) => {
    const form = p.formId ? forms.find((f) => f.id === p.formId) : undefined;
    return form && toggleOn(p, effects) ? [{ preset: p, form }] : [];
  });
  if (on.length <= 1) return on[0] ?? null;
  return on.find((x) => tokenImages.includes(x.form.imageAssetId)) ?? on[0] ?? null;
}

function useChoose() {
  const send = useMapIntent();
  return (characterId: string, formId: string | null) =>
    void send(FORM_INTENTS.choose, { characterId, formId }).catch(toastReject);
}

/** FR-FORM-15: Form ▸ Base / each form, both token menus. Nothing without forms. */
export function FormMenuItem({ characterId }: { characterId: string | null }) {
  const c = useSync((s) => characterIn(s.store, characterId));
  const choose = useChoose();
  const forms = formsOf(c);
  if (!c || forms.length === 0) return null;
  const chosen = c.kind === "character" ? c.formId : null;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid="form-menu">
        <ImageIcon /> Form
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup value={chosen ?? BASE}>
          <DropdownMenuRadioItem
            value={BASE}
            onSelect={() => choose(c.id, null)}
            data-testid="form-menu-item"
            data-record-id={BASE}
          >
            Base
          </DropdownMenuRadioItem>
          {forms.map((f) => (
            <DropdownMenuRadioItem
              key={f.id}
              value={f.id}
              onSelect={() => choose(c.id, f.id)}
              data-testid="form-menu-item"
              data-record-id={f.id}
            >
              {f.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * FR-FORM-14: the sheet header's Form picker (DM; owner; locked too) with ≥ 1 form. It shows the
 * hand-picked form; while a preset's form shows instead, a muted line says so.
 */
export function FormHeaderSelect({ characterId }: { characterId: string }) {
  const store = useSync((s) => s.store);
  const live = useSync((s) => s.state === "live");
  const choose = useChoose();
  const c = characterIn(store, characterId);
  const forms = formsOf(c);
  if (c?.kind !== "character" || forms.length === 0) return null;
  const presets = presetsIn(store).filter((p) => p.characterId === characterId);
  const effects = effectsOn(activeEffects(store), { characterId });
  const images = Object.values(store.records.token ?? {}).flatMap((t) => {
    const r = t as { characterId?: string | null; formImageAssetId?: string };
    return r.characterId === characterId ? [r.formImageAssetId] : [];
  });
  const fromPreset = presetFormShown(forms, presets, effects, images);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
      <span className="text-xs text-muted-foreground">Form</span>
      <Select
        value={c.formId ?? BASE}
        disabled={!live}
        onValueChange={(v) => choose(c.id, v === BASE ? null : v)}
      >
        <SelectTrigger data-testid="form-header-select" className="h-7 w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={BASE} data-testid="form-header-option" data-value={BASE}>
            Base
          </SelectItem>
          {forms.map((f) => (
            <SelectItem key={f.id} value={f.id} data-testid="form-header-option" data-value={f.id}>
              {f.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {fromPreset && (
        <span data-testid="form-header-preset" className="text-xs text-muted-foreground">
          Showing {fromPreset.form.name} while {fromPreset.preset.name} is on
        </span>
      )}
    </div>
  );
}

/** FR-FORM-16: the preset form's Token form Select; hidden without forms. */
export function PresetFormSelect({
  characterId,
  value,
  onChange,
  disabled,
}: {
  characterId: string;
  value: string | null;
  onChange(v: string | null): void;
  disabled: boolean;
}) {
  const forms = formsOf(useSync((s) => characterIn(s.store, characterId)));
  if (forms.length === 0) return null;
  const known = value === null || forms.some((f) => f.id === value);
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="form-preset-select">Token form</Label>
      <Select
        value={known ? (value ?? BASE) : BASE}
        disabled={disabled}
        onValueChange={(v) => onChange(v === BASE ? null : v)}
      >
        <SelectTrigger
          id="form-preset-select"
          data-testid="form-preset-select"
          className="h-8 w-56"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={BASE} data-testid="form-preset-option" data-value={BASE}>
            None
          </SelectItem>
          {forms.map((f) => (
            <SelectItem key={f.id} value={f.id} data-testid="form-preset-option" data-value={f.id}>
              {f.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        The character's tokens show this form while it's on
      </p>
    </div>
  );
}

/** FR-FORM-16: the preset row's mark: the linked form's name, else nothing. */
export function presetFormName(store: RecordStore, p: EffectPresetRecord): string | null {
  if (!p.formId || !p.characterId) return null;
  return formsOf(characterIn(store, p.characterId)).find((f) => f.id === p.formId)?.name ?? null;
}

const inputOf = (f: TokenForm): TokenFormInput => ({
  id: f.id,
  name: f.name,
  imageAssetId: f.imageAssetId,
});

/**
 * FR-FORM-13 (DM, sheet edit mode): the Token forms row under Portrait. Each change sends one
 * `forms.put` (the whole list), like the Portrait row; a name commits on blur / Enter.
 */
export function FormsEditor({ characterId }: { characterId: string }) {
  const c = useSync((s) => characterIn(s.store, characterId));
  const assets = useSync((s) => s.store.records.asset);
  const live = useSync((s) => s.state === "live");
  const send = useMapIntent();
  const [picking, setPicking] = useState<{ index: number | null } | null>(null);
  const forms = formsOf(c);
  if (c?.kind !== "character") return null;
  const put = (next: TokenFormInput[]) =>
    void send(FORM_INTENTS.put, { characterId, forms: next }).catch(toastReject);
  const current = forms.map(inputOf);
  const rename = (i: number, name: string) => {
    const trimmed = name.trim().slice(0, FORM_NAME_MAX);
    if (!trimmed || trimmed === forms[i]?.name) return;
    put(current.map((f, j) => (j === i ? { ...f, name: trimmed } : f)));
  };
  const full = forms.length >= FORMS_MAX;
  return (
    <div data-testid="form-row" className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Token forms
        </span>
        <span className="ml-auto">
          {full ? (
            <Tip content={`Up to ${FORMS_MAX} forms`} off>
              <Button data-testid="form-row-add" type="button" variant="outline" size="sm" disabled>
                Add form
              </Button>
            </Tip>
          ) : (
            <Button
              data-testid="form-row-add"
              type="button"
              variant="outline"
              size="sm"
              disabled={!live}
              onClick={() => setPicking({ index: null })}
            >
              Add form
            </Button>
          )}
        </span>
      </div>
      {forms.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No forms. Add one to switch this character's token, e.g. while raging.
        </p>
      ) : (
        forms.map((f, i) => (
          <div
            key={f.id}
            data-testid="form-row-item"
            data-record-id={f.id}
            className="flex items-center gap-1.5"
          >
            <AssetImg id={f.imageAssetId} file="thumb" alt={f.name} className="size-10 rounded" />
            <Input
              key={`${f.id}-${f.name}`}
              data-testid="form-row-name"
              data-record-id={f.id}
              aria-label="Form name"
              className="h-7 min-w-0 flex-1"
              maxLength={FORM_NAME_MAX}
              defaultValue={f.name}
              disabled={!live}
              onBlur={(e) => rename(i, e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
            <Button
              data-testid="form-row-change"
              data-record-id={f.id}
              type="button"
              variant="ghost"
              size="sm"
              disabled={!live}
              onClick={() => setPicking({ index: i })}
            >
              Change…
            </Button>
            <Tip content={`Remove ${f.name}`} off={!live}>
              <Button
                data-testid="form-row-remove"
                data-record-id={f.id}
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${f.name}`}
                disabled={!live}
                onClick={() => put(current.filter((_, j) => j !== i))}
              >
                <XIcon />
              </Button>
            </Tip>
          </div>
        ))
      )}
      <AssetPickerDialog
        open={picking !== null}
        onOpenChange={(o) => {
          if (!o) setPicking(null);
        }}
        title="Token form image"
        context="token"
        initialSelectedId={
          picking?.index != null ? (forms[picking.index]?.imageAssetId ?? null) : null
        }
        onSelect={(next) => {
          if (!next || !picking) return;
          const name = (assets?.[next] as { name?: string } | undefined)?.name;
          if (picking.index === null) {
            put([...current, { name: newFormName(name, forms), imageAssetId: next }]);
          } else {
            const i = picking.index;
            put(current.map((f, j) => (j === i ? { ...f, imageAssetId: next } : f)));
          }
        }}
      />
    </div>
  );
}

/** A new form's name: the image's name cut to 24, made unique ("Raging 2"); "Form" without one. */
export function newFormName(imageName: string | undefined, forms: readonly TokenForm[]): string {
  const base = (imageName?.trim() || "Form").slice(0, FORM_NAME_MAX);
  const taken = new Set(forms.map((f) => f.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const name = `${base.slice(0, FORM_NAME_MAX - suffix.length)}${suffix}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** Re-exported for the preset row's icon. */
export { ImageIcon as FormIcon };

// "Dice look" (FR-DICEX-27): the tray gear popover's second pane. Style swatches, body / pip
// colour (12-swatch palette + hex Input), material ToggleGroup, live preview die (3D when this
// device renders 3D, else flat), Save (`dicex.setLook`, owner = sender), Reset (= the style's
// defaults). Low pips / body contrast → inline hint, still allowed. Save needs `live`.
import {
  DICE_MATERIALS,
  DICE_STYLES,
  DICEX_INTENTS,
  type DiceLook,
  type DiceMaterial,
  STYLE_LOOK,
  sameLook,
} from "@shared/dice-extras/looks";
import { ChevronLeftIcon } from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/controls";
import { Input } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { IntentRejected } from "../../sync/connection";
import { useSync } from "../../sync/store";
import type { PreviewHandle } from "./dice3d/index";
import { dice3d, useChunk3d, useThreeD } from "./lazy3d";
import {
  draftReducer,
  editorView,
  LOOK_PALETTE,
  MATERIAL_NAME,
  parseHex,
  STYLE_NAME,
} from "./look-editor";
import { useOwnLook } from "./own-look";
import { useDiceSettings } from "./settings";

const PREVIEW_PX = 72;

function FlatPreview({ look }: { look: DiceLook }) {
  return (
    <span
      className="flex size-14 items-center justify-center rounded-2xl border-2 text-xl font-bold tabular-nums shadow-sm"
      style={{ backgroundColor: look.body, color: look.pips, borderColor: look.pips }}
    >
      20
    </span>
  );
}

/** 3D preview (lazy chunk, own small renderer); flat while loading or when WebGL fails. */
function Preview3D({ look, onFail }: { look: DiceLook; onFail(): void }) {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<PreviewHandle | null>(null);
  const chunk = useChunk3d();
  const latest = useRef(look);
  latest.current = look;
  const fail = useRef(onFail);
  fail.current = onFail;
  useEffect(() => {
    dice3d.load();
  }, []);
  useEffect(() => {
    if (chunk === "failed") fail.current();
    const mod = dice3d.module();
    const el = host.current;
    if (chunk !== "ready" || !mod || !el) return;
    try {
      handle.current = mod.previewDie(el, PREVIEW_PX, latest.current);
    } catch {
      fail.current();
      return;
    }
    return () => {
      handle.current?.stop();
      handle.current = null;
    };
  }, [chunk]);
  useEffect(() => {
    handle.current?.update(look);
  }, [look]);
  return (
    <div ref={host} className="flex size-[72px] items-center justify-center">
      {chunk !== "ready" && <FlatPreview look={look} />}
    </div>
  );
}

function LookPreview({ look }: { look: DiceLook }) {
  const { render } = useDiceSettings();
  const threeD = useThreeD();
  const [failed, setFailed] = useState(false);
  const mode = render === "3d" && threeD.available && !failed ? "3d" : "flat";
  return (
    <div
      data-testid="dicex-look-preview"
      data-render={mode}
      className="flex h-[72px] items-center justify-center"
    >
      {mode === "3d" ? (
        <Preview3D look={look} onFail={() => setFailed(true)} />
      ) : (
        <FlatPreview look={look} />
      )}
    </div>
  );
}

function ColourField({
  part,
  label,
  value,
  invalid,
  onChange,
}: {
  part: "body" | "pips";
  label: string;
  value: string;
  invalid: boolean;
  onChange(v: string): void;
}) {
  const current = parseHex(value);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`dicex-look-${part}`} className="text-xs font-medium">
          {label}
        </label>
        <Input
          id={`dicex-look-${part}`}
          data-testid={`dicex-look-${part}`}
          aria-invalid={invalid}
          value={value}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-24 px-2 font-mono text-xs"
        />
      </div>
      <fieldset
        className="m-0 grid grid-cols-12 gap-0.5 border-0 p-0"
        aria-label={`${label} colours`}
      >
        {LOOK_PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            data-testid={`dicex-look-${part}-swatch`}
            data-value={c}
            aria-label={c}
            aria-pressed={current === c}
            onClick={() => onChange(c)}
            className={cn(
              "aspect-square rounded-sm border border-border",
              current === c && "ring-2 ring-ring ring-offset-1 ring-offset-popover",
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </fieldset>
    </div>
  );
}

export function LookEditor({ onBack }: { onBack(): void }) {
  const live = useSync((s) => s.state === "live");
  const connection = useSync((s) => s.connection);
  const current = useOwnLook();
  const [draft, dispatch] = useReducer(draftReducer, current);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Another tab (or this Save) changed the stored look: an untouched draft follows it.
  const base = useRef(current);
  useEffect(() => {
    if (sameLook(base.current, current)) return;
    const untouched = editorView(draft, base.current, true).dirty === false;
    base.current = current;
    if (untouched) dispatch({ type: "load", look: current });
  }, [current, draft]);
  const view = editorView(draft, current, live);
  const preview = view.look ?? current;

  const save = () => {
    if (!view.canSave || !view.look) return;
    setError(null);
    setSaving(true);
    connection
      .sendIntent(DICEX_INTENTS.setLook, view.look)
      .catch((err: unknown) => {
        setError(err instanceof IntentRejected ? err.message : "Couldn't save the look");
      })
      .finally(() => setSaving(false));
  };

  return (
    <div data-testid="dicex-look" className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        <Button
          data-testid="dicex-look-back"
          size="icon"
          variant="ghost"
          className="size-6"
          aria-label="Back to dice settings"
          onClick={onBack}
        >
          <ChevronLeftIcon className="size-4" />
        </Button>
        <p className="text-sm font-medium">Dice look</p>
      </div>
      <fieldset className="m-0 grid grid-cols-4 gap-1 border-0 p-0" aria-label="Dice style">
        {DICE_STYLES.map((s) => {
          const l = STYLE_LOOK[s];
          return (
            <button
              key={s}
              type="button"
              data-testid="dicex-look-style"
              data-value={s}
              aria-pressed={draft.style === s}
              onClick={() => dispatch({ type: "style", style: s })}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-md border p-1 text-[10px] leading-none",
                draft.style === s ? "border-ring bg-accent" : "border-transparent hover:bg-accent",
              )}
            >
              <span
                className="size-5 rounded-md border"
                style={{ backgroundColor: l.body, borderColor: l.pips }}
              />
              {STYLE_NAME[s]}
            </button>
          );
        })}
      </fieldset>
      <ColourField
        part="body"
        label="Body"
        value={draft.body}
        invalid={view.bodyInvalid}
        onChange={(value) => dispatch({ type: "body", value })}
      />
      <ColourField
        part="pips"
        label="Pips"
        value={draft.pips}
        invalid={view.pipsInvalid}
        onChange={(value) => dispatch({ type: "pips", value })}
      />
      {(view.bodyInvalid || view.pipsInvalid) && (
        <p data-testid="dicex-look-error" className="text-xs text-destructive">
          Use a colour like #1f4fa3.
        </p>
      )}
      {view.lowContrast && (
        <p data-testid="dicex-look-contrast" className="text-xs text-muted-foreground">
          Pips and body are hard to tell apart.
        </p>
      )}
      <ToggleGroup
        type="single"
        aria-label="Dice material"
        value={draft.material}
        onValueChange={(v) => {
          if (v) dispatch({ type: "material", material: v as DiceMaterial });
        }}
      >
        {DICE_MATERIALS.map((m) => (
          <ToggleGroupItem
            key={m}
            value={m}
            data-testid="dicex-look-material"
            data-value={m}
            className="h-7 px-2 text-xs"
          >
            {MATERIAL_NAME[m]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <LookPreview look={preview} />
      {error && (
        <p data-testid="dicex-look-save-error" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          data-testid="dicex-look-reset"
          size="sm"
          variant="outline"
          onClick={() => dispatch({ type: "reset" })}
        >
          Reset
        </Button>
        <Button
          data-testid="dicex-look-save"
          size="sm"
          disabled={!view.canSave || saving}
          onClick={save}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

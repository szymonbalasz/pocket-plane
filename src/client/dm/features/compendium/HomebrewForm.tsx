// Homebrew form Dialog (FR-CMP-24, -25; CMP §7): kind (New only), name, the kind's facets and
// short fields, text Textarea with a live markdown-lite preview, **Shared with players** Switch.
// Images strip (FR-CMP-50): one tile per image (first "Main"), Remove / Move left / right, then
// the image attach control (upload, drop or paste anywhere in the Dialog, From library).
// Saves with `POST` (New, Clone) or `PUT` (Edit); server errors inline; the window refetches.
import {
  HOMEBREW_TEXT_MAX,
  IMAGE_SLOTS_MAX,
  ITEM_CATEGORIES,
  SPELL_SCHOOLS,
  SRD_CLASSES,
} from "@shared/compendium/schemas";
import { type Api, ApiError } from "@ui/api";
import { Button } from "@ui/components/ui/button";
import { Checkbox, Switch } from "@ui/components/ui/controls";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
} from "@ui/components/ui/overlays";
import { Badge, Input, Label } from "@ui/components/ui/primitives";
import { AssetImg } from "@ui/features/assets-pipeline/AssetImg";
import { ImageAttach } from "@ui/features/assets-pipeline/attach/ImageAttach";
import { useLive } from "@ui/features/combat-tracker/store";
import { MarkdownLite } from "@ui/features/compendium/MarkdownLite";
import { openEntry, refetch } from "@ui/features/compendium/nav";
import { ArrowLeftIcon, ArrowRightIcon, XIcon } from "lucide-react";
import { type ReactNode, type RefObject, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ALREADY_IN_ENTRY,
  attachImage,
  draftError,
  draftOf,
  type FormMode,
  HOMEBREW_KINDS,
  type HomebrewFields,
  type HomebrewKind,
  initialFields,
  moveImage,
  removeImage,
} from "./homebrew-form";
import { putEntry } from "./homebrew-rest";

const KIND_LABEL: Record<HomebrewKind, string> = {
  spell: "Spell",
  item: "Item",
  condition: "Condition",
  feature: "Feature",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const LEVELS = Array.from({ length: 10 }, (_, i) => String(i));
const NONE = "__none__";

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1" data-testid="cmp-form-field" data-field={id}>
      <Label htmlFor={`cmp-form-${id}`} className="text-xs">
        {label}
      </Label>
      {children}
    </div>
  );
}

function Pick({
  id,
  value,
  options,
  onChange,
  testId,
}: {
  id: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange(v: string): void;
  testId?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={`cmp-form-${id}`} className="h-8 min-w-0" data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} data-value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Check({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange(v: boolean): void;
}) {
  return (
    <div className="flex items-center gap-2" data-testid="cmp-form-field" data-field={id}>
      <Checkbox
        id={`cmp-form-${id}`}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
      />
      <Label htmlFor={`cmp-form-${id}`} className="text-xs">
        {label}
      </Label>
    </div>
  );
}

function KindFields({
  f,
  set,
}: {
  f: HomebrewFields;
  set<K extends keyof HomebrewFields>(k: K, v: HomebrewFields[K]): void;
}) {
  const text = (k: keyof HomebrewFields, label: string, placeholder?: string) => (
    <Field id={k} label={label}>
      <Input
        id={`cmp-form-${k}`}
        className="h-8"
        maxLength={200}
        placeholder={placeholder}
        value={f[k] as string}
        onChange={(e) => set(k, e.target.value as never)}
      />
    </Field>
  );
  switch (f.kind) {
    case "spell":
      return (
        <>
          <Field id="level" label="Level">
            <Pick
              id="level"
              value={f.level}
              options={LEVELS.map((v) => ({ value: v, label: v === "0" ? "Cantrip" : v }))}
              onChange={(v) => set("level", v)}
            />
          </Field>
          <Field id="school" label="School">
            <Pick
              id="school"
              value={f.school}
              options={SPELL_SCHOOLS.map((v) => ({ value: v, label: cap(v) }))}
              onChange={(v) => set("school", v)}
            />
          </Field>
          {text("castingTime", "Casting time")}
          {text("range", "Range")}
          {text("components", "Components")}
          {text("duration", "Duration")}
          <Check
            id="concentration"
            label="Concentration"
            checked={f.concentration}
            onChange={(v) => set("concentration", v)}
          />
          <Check id="ritual" label="Ritual" checked={f.ritual} onChange={(v) => set("ritual", v)} />
        </>
      );
    case "item":
      return (
        <>
          <Field id="category" label="Category">
            <Pick
              id="category"
              value={f.category}
              options={ITEM_CATEGORIES.map((v) => ({ value: v, label: cap(v) }))}
              onChange={(v) => set("category", v)}
            />
          </Field>
          {text("rarity", "Rarity", "rare")}
          <div className="col-span-2">{text("typeLine", "Type", "Wondrous item")}</div>
          <Check
            id="attunement"
            label="Requires attunement"
            checked={f.attunement}
            onChange={(v) => set("attunement", v)}
          />
        </>
      );
    case "feature":
      return (
        <>
          <Field id="className" label="Class">
            <Pick
              id="className"
              value={f.className}
              options={SRD_CLASSES.map((v) => ({ value: v, label: v }))}
              onChange={(v) => set("className", v as HomebrewFields["className"])}
            />
          </Field>
          <Field id="featureLevel" label="Level">
            <Pick
              id="featureLevel"
              value={f.featureLevel || NONE}
              options={[
                { value: NONE, label: "—" },
                ...Array.from({ length: 20 }, (_, i) => ({
                  value: String(i + 1),
                  label: String(i + 1),
                })),
              ]}
              onChange={(v) => set("featureLevel", v === NONE ? "" : v)}
            />
          </Field>
          <div className="col-span-2">{text("subclass", "Subclass (optional)")}</div>
        </>
      );
    case "condition":
      return null;
  }
}

function SlotButton({
  label,
  testId,
  disabled,
  onClick,
  children,
}: {
  label: string;
  testId: string;
  disabled?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label}>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-6"
        aria-label={label}
        data-testid={testId}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </Button>
    </Tooltip>
  );
}

/**
 * FR-CMP-50: "Images (n / 4)", the tiles in slot order (first badged "Main") with Move left /
 * Remove / Move right, then `ImageAttach` (paste / drop on `target`, the Dialog content). An id
 * the draft already holds is skipped with "Already in this entry".
 */
export function ImageSlots({
  images,
  onChange,
  target,
  busy,
  duplicate,
  onAdd,
}: {
  images: readonly string[];
  onChange(ids: string[]): void;
  target?: RefObject<HTMLElement | null>;
  busy: boolean;
  duplicate: boolean;
  onAdd(id: string): void;
}) {
  return (
    <div className="flex flex-col gap-1.5" data-testid="cmp-form-images" data-value={images.length}>
      <span className="text-xs font-medium">
        Images ({images.length} / {IMAGE_SLOTS_MAX})
      </span>
      {images.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {images.map((id, i) => (
            <li
              key={id}
              data-testid="cmp-form-image"
              data-record-id={id}
              data-value={i + 1}
              className="relative flex flex-col items-center gap-1 rounded-md border p-1"
            >
              <AssetImg id={id} file="thumb" alt={`Image ${i + 1}`} className="size-16 rounded" />
              {i === 0 && (
                <Badge
                  data-testid="cmp-form-image-main"
                  className="absolute left-1 top-1 px-1 py-0 text-[10px]"
                >
                  Main
                </Badge>
              )}
              <span className="flex gap-0.5">
                <SlotButton
                  label="Move left"
                  testId="cmp-form-image-left"
                  disabled={i === 0}
                  onClick={() => onChange(moveImage(images, i, -1))}
                >
                  <ArrowLeftIcon className="size-3.5" />
                </SlotButton>
                <SlotButton
                  label="Remove"
                  testId="cmp-form-image-remove"
                  onClick={() => onChange(removeImage(images, i))}
                >
                  <XIcon className="size-3.5" />
                </SlotButton>
                <SlotButton
                  label="Move right"
                  testId="cmp-form-image-right"
                  disabled={i === images.length - 1}
                  onClick={() => onChange(moveImage(images, i, 1))}
                >
                  <ArrowRightIcon className="size-3.5" />
                </SlotButton>
              </span>
            </li>
          ))}
        </ul>
      )}
      <ImageAttach
        owner="cmp-form"
        max={IMAGE_SLOTS_MAX}
        count={images.length}
        onAdd={onAdd}
        pasteTarget={target}
        dropTarget={target}
        disabled={busy}
      />
      {duplicate && (
        <p data-testid="cmp-form-image-dup" className="text-xs text-muted-foreground">
          {ALREADY_IN_ENTRY}
        </p>
      )}
    </div>
  );
}

function HomebrewForm({
  api,
  mode,
  close,
  target,
}: {
  api: Api;
  mode: FormMode;
  close(): void;
  target: RefObject<HTMLElement | null>;
}) {
  const [f, setF] = useState<HomebrewFields>(() => initialFields(mode));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const live = useLive();
  const set = <K extends keyof HomebrewFields>(k: K, v: HomebrewFields[K]) =>
    setF((x) => ({ ...x, [k]: v }));
  // The strip as of the last add: several uploads can finish before a re-render.
  const images = useRef(f.images);
  images.current = f.images;
  const setImages = (ids: string[]) => {
    images.current = ids;
    setDuplicate(false);
    set("images", ids);
  };
  const attach = (id: string) => {
    const r = attachImage(images.current, id);
    if (r.duplicate) {
      setDuplicate(true);
      return;
    }
    setImages(r.ids);
  };

  const save = async () => {
    const invalid = draftError(f);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const id = mode.kind === "edit" ? mode.entry.id : null;
      const r = await putEntry(api, id, {
        entry: draftOf(f) as Parameters<typeof putEntry>[2]["entry"],
        shared: f.shared,
        derivedFromId: mode.kind === "clone" ? mode.base.id : null,
        imageAssetIds: f.images,
      });
      toast.success(`Saved ${f.name.trim()}`);
      close();
      if (mode.kind === "edit") refetch();
      else openEntry(r.entryId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const title =
    mode.kind === "new" ? "New homebrew" : mode.kind === "clone" ? "Clone to homebrew" : "Edit";
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <form
        className="grid max-h-[70vh] grid-cols-2 gap-2.5 overflow-y-auto pr-1"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {mode.kind === "new" && (
          <Field id="kind" label="Kind">
            <Pick
              id="kind"
              testId="cmp-form-kind"
              value={f.kind}
              options={HOMEBREW_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
              onChange={(v) => setF((x) => ({ ...x, kind: v as HomebrewKind }))}
            />
          </Field>
        )}
        <div className={mode.kind === "new" ? "" : "col-span-2"}>
          <Field id="name" label="Name">
            <Input
              id="cmp-form-name"
              className="h-8"
              data-testid="cmp-form-name"
              maxLength={80}
              value={f.name}
              autoFocus
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
        </div>
        <KindFields f={f} set={set} />
        <div className="col-span-2">
          <Field id="text" label="Text (markdown-lite: **bold**, *italic*, - lists, | tables)">
            <textarea
              id="cmp-form-text"
              data-testid="cmp-form-text"
              maxLength={HOMEBREW_TEXT_MAX}
              rows={6}
              value={f.text}
              onChange={(e) => set("text", e.target.value)}
              className="flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </Field>
        </div>
        <div
          className="col-span-2 max-h-40 overflow-y-auto rounded-md border bg-muted/30 p-2 text-sm"
          data-testid="cmp-form-preview"
        >
          {f.text.trim() === "" ? (
            <span className="text-xs text-muted-foreground">Preview</span>
          ) : (
            <MarkdownLite text={f.text} context={{ kind: "plain", label: f.name || "Homebrew" }} />
          )}
        </div>
        <div className="col-span-2">
          <ImageSlots
            images={f.images}
            onChange={setImages}
            target={target}
            busy={saving}
            duplicate={duplicate}
            onAdd={attach}
          />
        </div>
        <div className="col-span-2 flex items-center gap-2">
          <Switch
            id="cmp-form-shared"
            data-testid="cmp-form-shared"
            checked={f.shared}
            onCheckedChange={(v) => set("shared", v)}
          />
          <Label htmlFor="cmp-form-shared">Shared with players</Label>
        </div>
        {error && (
          <p data-testid="cmp-form-error" className="col-span-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter className="col-span-2">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button data-testid="cmp-form-save" type="submit" disabled={saving || !live}>
            Save
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

export function HomebrewDialog({
  api,
  mode,
  onClose,
}: {
  api: Api;
  mode: FormMode | null;
  onClose(): void;
}) {
  // Paste / drop anywhere in the Dialog (name and text included) adds images (FR-CMP-50).
  const content = useRef<HTMLDivElement>(null);
  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        ref={content}
        data-testid="cmp-form"
        className="max-w-lg"
        aria-describedby={undefined}
      >
        {mode && <HomebrewForm api={api} mode={mode} close={onClose} target={content} />}
      </DialogContent>
    </Dialog>
  );
}

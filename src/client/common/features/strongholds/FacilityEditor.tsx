// Facility editor (FR-HOLD-26, DM): FR-HOLD-04's fields; State and Replaces Selects; Order Input
// with this campaign's suggestions (FR-HOLD-32, a native datalist: no built-in list); Income dice
// with the live notation check; DM only Switch. Save disabled while invalid, unchanged, not `live`
// or in flight; a reject shows inline, a lost intent the Toast (FR-HOLD-26). Live (FR-HOLD-34): the
// facility removed while open → "This facility was removed", Save disabled; changed by another
// tab → "Changed in another tab", the draft kept.
import {
  FACILITY_EFFECT_MAX,
  FACILITY_ORDER_MAX,
  FACILITY_STATES,
  type FacilityState,
  HOLD_INTENTS,
  HOLD_NAME_MAX,
} from "@shared/strongholds/schemas";
import { useEffect, useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/controls";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/overlays";
import { Input, Label } from "../../components/ui/primitives";
import { Textarea } from "../party-board/controls";
import {
  CHANGED_ELSEWHERE,
  FACILITY_REMOVED,
  type FacilityDraft,
  type FacilityView,
  facilityDraft,
  facilityErrors,
  facilityPayload,
  NEW_FACILITY,
  STATE_LABELS,
  sameDraft,
} from "./logic";
import { useHoldIntent, useLive } from "./send";

const NONE = "__none";

export interface FacilityEditorProps {
  strongholdId: string;
  /** null = Add facility. */
  editing: FacilityView | null;
  /** The facility as it is now (live); undefined once removed. */
  current: FacilityView | undefined;
  facilities: readonly FacilityView[];
  suggestions: readonly string[];
  open: boolean;
  onOpenChange(o: boolean): void;
}

function Field({
  label,
  id,
  error,
  children,
}: {
  label: string;
  id: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {children}
      {error && (
        <p className="text-xs text-destructive" data-testid="hold-facility-form-field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function FacilityEditor(p: FacilityEditorProps) {
  const live = useLive();
  const intent = useHoldIntent();
  const uid = useId();
  const base = p.editing ? facilityDraft(p.editing) : NEW_FACILITY;
  const [draft, setDraft] = useState<FacilityDraft>(base);
  const { setError } = intent;
  // Reset on each open (a new target or Add).
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the dialog (re)opens
  useEffect(() => {
    if (p.open) {
      setDraft(p.editing ? facilityDraft(p.editing) : NEW_FACILITY);
      setError(null);
    }
  }, [p.open, p.editing?.id]);
  const id = p.editing?.id;
  const gone = p.editing !== null && p.current === undefined;
  const changed =
    p.editing !== null && p.current !== undefined && !sameDraft(facilityDraft(p.current), base);
  const errors = facilityErrors(draft, id);
  const invalid = Object.keys(errors).length > 0;
  const set = <K extends keyof FacilityDraft>(k: K, v: FacilityDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const save = async () => {
    const r = await intent.send(HOLD_INTENTS.saveFacility, {
      strongholdId: p.strongholdId,
      facility: facilityPayload(draft, id),
    });
    if (r) p.onOpenChange(false);
  };
  const others = p.facilities.filter((f) => f.id !== id);
  const f = (name: string) => `${uid}-${name}`;
  const tid = (name: string) => `hold-facility-form-${name}`;
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="max-w-md" data-testid="hold-facility-form">
        <DialogTitle>{p.editing ? `Edit ${p.editing.name}` : "Add facility"}</DialogTitle>
        {gone && (
          <p
            role="alert"
            className="text-sm text-destructive"
            data-testid="hold-facility-form-gone"
          >
            {FACILITY_REMOVED}
          </p>
        )}
        {changed && !gone && (
          <p className="text-xs text-muted-foreground" data-testid="hold-facility-form-changed">
            {CHANGED_ELSEWHERE}
          </p>
        )}
        <form
          className="grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto pr-1"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="col-span-2">
            <Field label="Name" id={f("name")} error={draft.name === "" ? undefined : errors.name}>
              <Input
                id={f("name")}
                data-testid={tid("name")}
                value={draft.name}
                maxLength={HOLD_NAME_MAX}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>
          </div>
          <Field label="State" id={f("state")}>
            <Select value={draft.state} onValueChange={(v) => set("state", v as FacilityState)}>
              <SelectTrigger id={f("state")} data-testid={tid("state")} className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FACILITY_STATES.map((s) => (
                  <SelectItem key={s} value={s} data-testid={tid("state-option")} data-value={s}>
                    {STATE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Replaces" id={f("replaces")} error={errors.replacesId}>
            <Select
              value={draft.replacesId ?? NONE}
              onValueChange={(v) => set("replacesId", v === NONE ? null : v)}
            >
              <SelectTrigger id={f("replaces")} data-testid={tid("replacesId")} className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Nothing</SelectItem>
                {others.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {(["cost", "buildDays", "upkeep"] as const).map((k) => (
            <Field
              key={k}
              label={k === "cost" ? "Cost (gp)" : k === "buildDays" ? "Build days" : "Upkeep (gp)"}
              id={f(k)}
              error={errors[k]}
            >
              <Input
                id={f(k)}
                data-testid={tid(k)}
                inputMode="numeric"
                value={draft[k]}
                onChange={(e) => set(k, e.target.value)}
              />
            </Field>
          ))}
          <Field label="Income dice" id={f("dice")} error={errors.incomeDice}>
            <Input
              id={f("dice")}
              data-testid={tid("incomeDice")}
              placeholder="e.g. 2d6"
              value={draft.incomeDice}
              onChange={(e) => set("incomeDice", e.target.value)}
            />
          </Field>
          <div className="col-span-2">
            <Field label="Order" id={f("order")} error={errors.order}>
              <Input
                id={f("order")}
                data-testid={tid("order")}
                list={f("orders")}
                value={draft.order}
                maxLength={FACILITY_ORDER_MAX}
                onChange={(e) => set("order", e.target.value)}
              />
              <datalist id={f("orders")} data-testid="hold-facility-form-suggestions">
                {p.suggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Effect" id={f("effect")} error={errors.effect}>
              <Textarea
                id={f("effect")}
                data-testid={tid("effect")}
                rows={3}
                value={draft.effect}
                maxLength={FACILITY_EFFECT_MAX}
                onChange={(e) => set("effect", e.target.value)}
              />
              <span className="self-end text-xs text-muted-foreground">
                {draft.effect.length} / {FACILITY_EFFECT_MAX}
              </span>
            </Field>
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <Switch
              id={f("dm")}
              data-testid={tid("dmOnly")}
              checked={draft.dmOnly}
              onCheckedChange={(v) => set("dmOnly", v)}
            />
            <Label htmlFor={f("dm")} className="text-sm">
              DM only
            </Label>
          </div>
          {intent.error && (
            <p
              role="alert"
              className="col-span-2 text-xs text-destructive"
              data-testid="hold-facility-form-error"
            >
              {intent.error}
            </p>
          )}
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => p.onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              data-testid="hold-facility-form-save"
              disabled={
                !live ||
                intent.busy ||
                invalid ||
                gone ||
                (p.editing !== null && sameDraft(draft, base))
              }
            >
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

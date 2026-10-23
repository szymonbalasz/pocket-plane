// Staff tab (FR-HOLD-27): rows in the DM's order: name, role, wage ("2 gp"), "works in ‹facility›",
// notes (muted); DM eye-off on DM-only rows. DM: Add staff, Edit (Dialog: FR-HOLD-05's fields,
// Works in Select), Move up / down, Remove (inline confirm).
import {
  HOLD_INTENTS,
  HOLD_NAME_MAX,
  STAFF_NOTES_MAX,
  STAFF_ROLE_MAX,
} from "@shared/strongholds/schemas";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  EyeOffIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
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
import {
  CHANGED_ELSEWHERE,
  isDmOnly,
  NEW_STAFF,
  STAFF_REMOVED,
  type StaffDraft,
  type StaffView,
  sameDraft,
  staffDraft,
  staffErrors,
  staffPayload,
} from "./logic";
import type { HoldParts } from "./StrongholdWindow";
import { useHoldIntent, useLive } from "./send";

const NONE = "__none";

function StaffEditor({
  parts,
  editing,
  open,
  onOpenChange,
}: {
  parts: HoldParts;
  editing: StaffView | null;
  open: boolean;
  onOpenChange(o: boolean): void;
}) {
  const live = useLive();
  const intent = useHoldIntent();
  const uid = useId();
  const base = editing ? staffDraft(editing) : NEW_STAFF;
  const [draft, setDraft] = useState<StaffDraft>(base);
  const { setError } = intent;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the dialog (re)opens
  useEffect(() => {
    if (open) {
      setDraft(editing ? staffDraft(editing) : NEW_STAFF);
      setError(null);
    }
  }, [open, editing?.id]);
  const id = editing?.id;
  const current = id ? parts.hold.staff.find((m) => m.id === id) : undefined;
  const gone = editing !== null && current === undefined;
  const changed = current !== undefined && !sameDraft(staffDraft(current), base);
  const errors = staffErrors(draft, id);
  const set = <K extends keyof StaffDraft>(k: K, v: StaffDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const f = (n: string) => `${uid}-${n}`;
  const tid = (n: string) => `hold-staff-form-${n}`;
  const save = async () => {
    const r = await intent.send(HOLD_INTENTS.saveStaff, {
      strongholdId: parts.hold.id,
      staff: staffPayload(draft, id),
    });
    if (r) onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="hold-staff-form">
        <DialogTitle>{editing ? `Edit ${editing.name}` : "Add staff"}</DialogTitle>
        {gone && (
          <p role="alert" className="text-sm text-destructive" data-testid="hold-staff-form-gone">
            {STAFF_REMOVED}
          </p>
        )}
        {changed && !gone && <p className="text-xs text-muted-foreground">{CHANGED_ELSEWHERE}</p>}
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {(
            [
              ["name", "Name", HOLD_NAME_MAX],
              ["role", "Role", STAFF_ROLE_MAX],
              ["wage", "Wage (gp)", 6],
              ["notes", "Notes", STAFF_NOTES_MAX],
            ] as const
          ).map(([k, label, max]) => (
            <div key={k} className="flex flex-col gap-1">
              <Label htmlFor={f(k)} className="text-xs">
                {label}
              </Label>
              <Input
                id={f(k)}
                data-testid={tid(k)}
                inputMode={k === "wage" ? "numeric" : undefined}
                maxLength={max}
                value={draft[k]}
                onChange={(e) => set(k, e.target.value)}
              />
              {errors[k] && (k !== "name" || draft.name !== "") && (
                <p className="text-xs text-destructive">{errors[k]}</p>
              )}
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <Label htmlFor={f("works")} className="text-xs">
              Works in
            </Label>
            <Select
              value={draft.facilityId ?? NONE}
              onValueChange={(v) => set("facilityId", v === NONE ? null : v)}
            >
              <SelectTrigger id={f("works")} data-testid={tid("facilityId")} className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Nowhere in particular</SelectItem>
                {parts.hold.facilities.map((x) => (
                  <SelectItem key={x.id} value={x.id}>
                    {x.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
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
              className="text-xs text-destructive"
              data-testid="hold-staff-form-error"
            >
              {intent.error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              data-testid="hold-staff-form-save"
              disabled={
                !live ||
                intent.busy ||
                gone ||
                Object.keys(errors).length > 0 ||
                (editing !== null && sameDraft(draft, base))
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

function StaffRow({
  m,
  index,
  count,
  works,
  parts,
  onEdit,
}: {
  m: StaffView;
  index: number;
  count: number;
  works: string | undefined;
  parts: HoldParts;
  onEdit(m: StaffView): void;
}) {
  const live = useLive();
  const intent = useHoldIntent();
  const [confirming, setConfirming] = useState(false);
  const dmOnly = isDmOnly(m);
  const moveTo = (to: number) =>
    void intent.send(HOLD_INTENTS.moveRow, {
      strongholdId: parts.hold.id,
      list: "staff",
      id: m.id,
      index: to,
    });
  const icon = "size-7 shrink-0";
  return (
    <li
      data-testid="hold-staff"
      data-record-id={m.id}
      data-dm-only={String(dmOnly)}
      className="flex min-w-0 items-start gap-1.5 rounded-md border px-2 py-1.5"
    >
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex flex-wrap items-center gap-x-1.5">
          {dmOnly && <EyeOffIcon className="size-3.5 text-muted-foreground" aria-label="DM only" />}
          <span className="break-words font-medium">{m.name}</span>
          {m.role && <span className="break-words">{m.role}</span>}
          {m.wage !== null && <span data-testid="hold-staff-wage">{m.wage} gp</span>}
        </div>
        {works && <p className="text-xs">works in {works}</p>}
        {m.notes && <p className="break-words text-xs text-muted-foreground">{m.notes}</p>}
        {intent.error && (
          <p role="alert" className="text-xs text-destructive">
            {intent.error}
          </p>
        )}
      </div>
      {parts.dm &&
        (confirming ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant="destructive"
              className="h-7 px-2"
              data-testid="hold-staff-remove-confirm"
              disabled={!live || intent.busy}
              onClick={async () => {
                if (
                  await intent.send(HOLD_INTENTS.removeStaff, {
                    strongholdId: parts.hold.id,
                    staffId: m.id,
                  })
                )
                  setConfirming(false);
              }}
            >
              Remove
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2"
              onClick={() => setConfirming(false)}
            >
              Keep
            </Button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center">
            <Button
              size="icon"
              variant="ghost"
              className={icon}
              aria-label={`Move ${m.name} up`}
              data-testid="hold-staff-up"
              disabled={!live || index === 0 || intent.busy}
              onClick={() => moveTo(index - 1)}
            >
              <ArrowUpIcon className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className={icon}
              aria-label={`Move ${m.name} down`}
              data-testid="hold-staff-down"
              disabled={!live || index === count - 1 || intent.busy}
              onClick={() => moveTo(index + 1)}
            >
              <ArrowDownIcon className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className={icon}
              aria-label={`Edit ${m.name}`}
              data-testid="hold-staff-edit"
              disabled={!live}
              onClick={() => onEdit(m)}
            >
              <PencilIcon className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className={icon}
              aria-label={`Remove ${m.name}`}
              data-testid="hold-staff-remove"
              disabled={!live}
              onClick={() => setConfirming(true)}
            >
              <Trash2Icon className="size-3.5" />
            </Button>
          </div>
        ))}
    </li>
  );
}

export function StaffTab({ parts }: { parts: HoldParts }) {
  const live = useLive();
  const { staff, facilities } = parts.hold;
  const names = new Map(facilities.map((f) => [f.id, f.name]));
  const [editing, setEditing] = useState<{ m: StaffView | null } | null>(null);
  return (
    <div className="flex flex-col gap-1.5">
      {staff.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="hold-staff-empty">
          No staff yet
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {staff.map((m, i) => (
            <StaffRow
              key={m.id}
              m={m}
              index={i}
              count={staff.length}
              works={m.facilityId !== null ? names.get(m.facilityId) : undefined}
              parts={parts}
              onEdit={(x) => setEditing({ m: x })}
            />
          ))}
        </ul>
      )}
      {parts.dm && (
        <>
          <Button
            size="sm"
            variant="outline"
            className="h-7 self-start"
            data-testid="hold-staff-add"
            disabled={!live}
            onClick={() => setEditing({ m: null })}
          >
            <PlusIcon className="size-3.5" /> Add staff
          </Button>
          <StaffEditor
            parts={parts}
            editing={editing?.m ?? null}
            open={editing !== null}
            onOpenChange={(o) => {
              if (!o) setEditing(null);
            }}
          />
        </>
      )}
    </div>
  );
}

// Facilities tab (FR-HOLD-25): rows in the DM's order: name + state Badge, the figures line, the
// Income roll button (FR-HOLD-33: the macros' roll path, a plain `dice.roll` as "DM" / "Me"),
// "Order: …", the effect (3 lines, More expands), Replaces / Replaced by, the staff who work there,
// DM eye-off on DM-only rows. DM: Add facility, row menu Edit, Move up / down, Remove… (FR-HOLD-17's
// confirm names the reminders it removes).
import { HOLD_INTENTS } from "@shared/strongholds/schemas";
import { EllipsisIcon, EyeOffIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/menus";
import { Badge } from "../../components/ui/primitives";
import { useSync } from "../../sync/store";
import { toastIntentError } from "../combat-tracker/store";
import { RollButton, useRollControl } from "../dice-roll-log/roll-control";
import { ConfirmDialog } from "./dialogs";
import { FacilityEditor } from "./FacilityEditor";
import {
  type FacilityView,
  facilityReminderCount,
  figuresLine,
  incomeRollIntent,
  isDmOnly,
  type LinkedReminder,
  removeFacilityText,
  replacedBy,
  STATE_LABELS,
  staffByFacility,
} from "./logic";
import type { HoldParts } from "./StrongholdWindow";
import { useHoldIntent, useLive } from "./send";

const STATE_CLASS: Record<FacilityView["state"], string> = {
  planned: "border-border bg-transparent text-muted-foreground",
  building: "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400",
  built: "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  replaced: "border-border bg-transparent text-muted-foreground line-through",
};

/** FR-HOLD-33: "‹Facility› income", category `other`, no actor (rolls as "DM" / "Me"). */
export function IncomeButton({ f }: { f: FacilityView & { incomeDice: string } }) {
  const live = useLive();
  const connection = useSync((s) => s.connection);
  const label = `${f.name} income`;
  const control = useRollControl({
    expressions: [f.incomeDice],
    category: "other",
    label,
    onRoll: (r) => {
      connection
        .sendIntent("dice.roll", incomeRollIntent({ name: f.name, incomeDice: f.incomeDice }, r))
        .catch(toastIntentError);
    },
  });
  return (
    <RollButton
      control={control}
      data-testid="hold-facility-income"
      data-record-id={f.id}
      size="sm"
      variant="outline"
      className="h-7 px-2"
      disabled={!live}
    >
      Income {f.incomeDice}
    </RollButton>
  );
}

function Effect({ text }: { text: string }) {
  const [more, setMore] = useState(false);
  const long = text.length > 160 || text.split("\n").length > 3;
  return (
    <div className="text-xs">
      <p
        data-testid="hold-facility-effect"
        className={`whitespace-pre-wrap break-words ${more ? "" : "line-clamp-3"}`}
      >
        {text}
      </p>
      {long && (
        <button
          type="button"
          className="text-xs text-muted-foreground underline"
          data-testid="hold-facility-effect-more"
          onClick={() => setMore((m) => !m)}
        >
          {more ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

function FacilityRow({
  f,
  index,
  count,
  names,
  replacer,
  staff,
  reminders,
  parts,
  onEdit,
}: {
  f: FacilityView;
  index: number;
  count: number;
  names: Map<string, string>;
  replacer: string | undefined;
  staff: string[];
  reminders: readonly LinkedReminder[];
  parts: HoldParts;
  onEdit(f: FacilityView): void;
}) {
  const live = useLive();
  const move = useHoldIntent();
  const remove = useHoldIntent();
  const [removing, setRemoving] = useState(false);
  const figures = figuresLine(f);
  const replaces = f.replacesId !== null ? names.get(f.replacesId) : undefined;
  const dmOnly = isDmOnly(f);
  const moveTo = (to: number) =>
    void move.send(HOLD_INTENTS.moveRow, {
      strongholdId: parts.hold.id,
      list: "facilities",
      id: f.id,
      index: to,
    });
  return (
    <li
      data-testid="hold-facility"
      data-record-id={f.id}
      data-state={f.state}
      data-dm-only={String(dmOnly)}
      className="flex min-w-0 flex-col gap-1 rounded-md border px-2 py-1.5"
    >
      <div className="flex min-w-0 items-start gap-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {dmOnly && (
            <EyeOffIcon
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-label="DM only"
              data-testid="hold-facility-dm-only"
            />
          )}
          <span
            data-testid="hold-facility-name"
            className={`break-words font-medium ${f.state === "replaced" ? "line-through" : ""}`}
          >
            {f.name}
          </span>
          <Badge className={STATE_CLASS[f.state]} data-testid="hold-facility-state">
            {STATE_LABELS[f.state]}
          </Badge>
        </div>
        {f.incomeDice !== null && <IncomeButton f={{ ...f, incomeDice: f.incomeDice }} />}
        {parts.dm && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7 shrink-0"
                aria-label={`${f.name} menu`}
                data-testid="hold-facility-menu"
                data-record-id={f.id}
                disabled={!live}
              >
                <EllipsisIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem data-testid="hold-facility-edit" onSelect={() => onEdit(f)}>
                Edit…
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="hold-facility-up"
                disabled={index === 0 || move.busy}
                onSelect={() => moveTo(index - 1)}
              >
                Move up
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="hold-facility-down"
                disabled={index === count - 1 || move.busy}
                onSelect={() => moveTo(index + 1)}
              >
                Move down
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="hold-facility-remove"
                variant="destructive"
                onSelect={() => {
                  remove.setError(null);
                  setRemoving(true);
                }}
              >
                Remove…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {figures && (
        <p className="text-xs text-muted-foreground" data-testid="hold-facility-figures">
          {figures}
        </p>
      )}
      {f.order !== "" && (
        <p className="break-words text-xs" data-testid="hold-facility-order">
          Order: {f.order}
        </p>
      )}
      {f.effect !== "" && <Effect text={f.effect} />}
      {(replaces || replacer) && (
        <p className="text-xs text-muted-foreground" data-testid="hold-facility-replaces">
          {[replaces && `Replaces ${replaces}`, replacer && `Replaced by ${replacer}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {staff.length > 0 && (
        <p className="break-words text-xs text-muted-foreground" data-testid="hold-facility-staff">
          {staff.join(", ")}
        </p>
      )}
      {move.error && (
        <p role="alert" className="text-xs text-destructive">
          {move.error}
        </p>
      )}
      {parts.dm && (
        <ConfirmDialog
          open={removing}
          onOpenChange={setRemoving}
          title={`Remove ${f.name}?`}
          summary={removeFacilityText(f.name, facilityReminderCount(f.id, reminders))}
          action="Remove"
          testId="hold-facility-remove"
          busy={remove.busy}
          error={remove.error}
          onConfirm={async () => {
            const r = await remove.send(HOLD_INTENTS.removeFacility, {
              strongholdId: parts.hold.id,
              facilityId: f.id,
            });
            if (r) setRemoving(false);
          }}
        />
      )}
    </li>
  );
}

export function FacilitiesTab({
  parts,
  reminders,
  suggestions,
}: {
  parts: HoldParts;
  reminders: readonly LinkedReminder[];
  suggestions: readonly string[];
}) {
  const live = useLive();
  const { facilities, staff } = parts.hold;
  const names = new Map(facilities.map((f) => [f.id, f.name]));
  const replacers = replacedBy(facilities);
  const workers = staffByFacility(staff);
  const [editing, setEditing] = useState<{ facility: FacilityView | null } | null>(null);
  return (
    <div className="flex flex-col gap-1.5">
      {facilities.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="hold-facilities-empty">
          No facilities yet
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {facilities.map((f, i) => (
            <FacilityRow
              key={f.id}
              f={f}
              index={i}
              count={facilities.length}
              names={names}
              replacer={replacers.get(f.id)}
              staff={workers.get(f.id) ?? []}
              reminders={reminders}
              parts={parts}
              onEdit={(facility) => setEditing({ facility })}
            />
          ))}
        </ul>
      )}
      {parts.dm && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 self-start"
          data-testid="hold-facility-add"
          disabled={!live}
          onClick={() => setEditing({ facility: null })}
        >
          <PlusIcon className="size-3.5" /> Add facility
        </Button>
      )}
      {parts.dm && (
        <FacilityEditor
          strongholdId={parts.hold.id}
          editing={editing?.facility ?? null}
          current={
            editing?.facility ? facilities.find((f) => f.id === editing.facility?.id) : undefined
          }
          facilities={facilities}
          suggestions={suggestions}
          open={editing !== null}
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      )}
    </div>
  );
}

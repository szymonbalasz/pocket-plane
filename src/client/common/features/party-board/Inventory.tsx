// Inventory tab of `party.board`, both clients (FR-PARTY-24): rows by name; everyone **Take** (to
// one of the viewer's characters; picker if > 1; qty) and **Give…** (one of the viewer's
// characters' sheet items → Party or another character); the DM's Add form, row Edit and Remove,
// and Move to any character. Reads the synced store; every change is an intent
// (`party.addItem` / `editItem` / `removeItem` / `moveItem`). Locks, reject and lost-intent rules
// as FR-LOOT-16.
import { CREATURE_SHEET_TYPE, type CreatureSheetRecord } from "@shared/character-sheet/sheet";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { PARTY_ITEM_TYPE, type PartyItemRecord } from "@shared/party-board/schemas";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/overlays";
import { Input } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { useLazyRecords, useRecords, useSync } from "../../sync/store";
import { submitEnabled } from "../party-loot/logic";
import {
  addPayload,
  canTakeOrGive,
  characterKey,
  EMPTY_ITEM,
  editDraftOf,
  editPayload,
  type GiveSource,
  givePayload,
  giveSources,
  giveTargets,
  ITEM_INTENTS as I,
  INVENTORY_EMPTY,
  type InvCharacter,
  type InvViewer,
  type ItemDraft,
  LOST_ITEM_ADD,
  LOST_ITEM_EDIT,
  LOST_ITEM_MOVE,
  LOST_ITEM_REMOVE,
  removePayload,
  sortItems,
  type TargetOption,
  takePayload,
  takeTargets,
} from "./inventory-logic";
import { intentFailure } from "./logic";
import { LoadingRows, RetryLoad } from "./Viewer";

/** One item intent in flight per form: reject → inline, lost to a disconnect → toast. */
function useItemIntent(lost: string) {
  const connection = useSync((s) => s.connection);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (name: string, payload: unknown): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await connection.sendIntent(name, payload);
      return true;
    } catch (err) {
      const f = intentFailure(err, lost);
      if (f.kind === "toast") toast.error(f.message);
      else setError(f.message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, send };
}

function ErrorLine({
  message,
  testId = "party-item-error",
}: {
  message: string | null;
  testId?: string;
}) {
  if (!message) return null;
  return (
    <p data-testid={testId} role="alert" className="text-xs text-destructive">
      {message}
    </p>
  );
}

function QtyInput({ value, onChange }: { value: string; onChange(v: string): void }) {
  return (
    <Input
      data-testid="party-item-qty"
      aria-label="Quantity"
      inputMode="numeric"
      className="h-8 w-16 px-2 text-xs tabular-nums"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Target picker: a Select when there is a choice, else the one target as text. */
function TargetPicker({
  options,
  value,
  onChange,
}: {
  options: TargetOption[];
  value: string;
  onChange(key: string): void;
}) {
  if (options.length === 1) {
    const only = options[0] as TargetOption;
    return (
      <span
        data-testid="party-item-target"
        data-value={only.key}
        className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
      >
        To {only.label}
      </span>
    );
  }
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        data-testid="party-item-target"
        data-value={value}
        aria-label="To"
        className="h-8 min-w-0 flex-1"
      >
        <SelectValue placeholder="To" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem
            key={o.key}
            value={o.key}
            data-testid="party-item-target-option"
            data-value={o.key}
          >
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const pick = (options: TargetOption[], chosen: string) =>
  options.some((o) => o.key === chosen) ? chosen : (options[0]?.key ?? "");

const escapeTo = (onCancel: () => void) => (e: KeyboardEvent) => {
  if (e.key === "Escape") onCancel();
};

/** Take: this party row → one of the viewer's characters (any for the DM). */
function TakeForm({
  item,
  chars,
  live,
  onDone,
}: {
  item: PartyItemRecord;
  chars: InvCharacter[];
  live: boolean;
  onDone(): void;
}) {
  const options = chars.map((c) => ({ key: characterKey(c.id), label: c.name }));
  const [chosen, setChosen] = useState("");
  const target = pick(options, chosen);
  const [qty, setQty] = useState("1");
  const { busy, error, send } = useItemIntent(LOST_ITEM_MOVE);
  const parsed = takePayload(item, target.slice("character:".length), qty);
  const enabled = submitEnabled({ valid: parsed.ok, live, busy });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!enabled || !parsed.ok) return;
    if (await send(I.moveItem, parsed.value)) onDone();
  };
  return (
    <form
      data-testid="party-item-take-form"
      onSubmit={submit}
      onKeyDown={escapeTo(onDone)}
      className="flex flex-col gap-1 pb-1.5"
    >
      <fieldset disabled={!live} className="flex items-center gap-1">
        <TargetPicker options={options} value={target} onChange={setChosen} />
        <QtyInput value={qty} onChange={setQty} />
        <Button type="submit" size="sm" data-testid="party-item-submit" disabled={!enabled}>
          Take
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-testid="party-item-cancel"
          onClick={onDone}
        >
          Cancel
        </Button>
      </fieldset>
      <ErrorLine message={error ?? (!parsed.ok && qty !== "" ? parsed.message : null)} />
    </form>
  );
}

/** DM Remove (sold / used up): qty ≤ held. */
function RemoveForm({
  item,
  live,
  onDone,
}: {
  item: PartyItemRecord;
  live: boolean;
  onDone(): void;
}) {
  const [qty, setQty] = useState(String(item.qty));
  const { busy, error, send } = useItemIntent(LOST_ITEM_REMOVE);
  const parsed = removePayload(item, qty);
  const enabled = submitEnabled({ valid: parsed.ok, live, busy });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!enabled || !parsed.ok) return;
    if (await send(I.removeItem, parsed.value)) onDone();
  };
  return (
    <form
      data-testid="party-item-remove-form"
      onSubmit={submit}
      onKeyDown={escapeTo(onDone)}
      className="flex flex-col gap-1 pb-1.5"
    >
      <fieldset disabled={!live} className="flex items-center gap-1">
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">Remove from the party</span>
        <QtyInput value={qty} onChange={setQty} />
        <Button
          type="submit"
          size="sm"
          variant="destructive"
          data-testid="party-item-submit"
          disabled={!enabled}
        >
          Remove
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-testid="party-item-cancel"
          onClick={onDone}
        >
          Cancel
        </Button>
      </fieldset>
      <ErrorLine message={error ?? (!parsed.ok && qty !== "" ? parsed.message : null)} />
    </form>
  );
}

/** Name / qty / notes Inputs of the Add and Edit forms. */
function ItemInputs({
  draft,
  onChange,
  prefix,
}: {
  draft: ItemDraft;
  onChange(d: ItemDraft): void;
  prefix: "party-item-add" | "party-item-edit";
}) {
  return (
    <div className="flex gap-1">
      <Input
        data-testid={`${prefix}-name`}
        aria-label="Item"
        placeholder="Healer's kit"
        className="h-8 min-w-0 flex-1 text-sm"
        value={draft.name}
        onChange={(e) => onChange({ ...draft, name: e.target.value })}
      />
      <Input
        data-testid={`${prefix}-qty`}
        aria-label="Quantity"
        inputMode="numeric"
        className="h-8 w-16 px-2 text-xs tabular-nums"
        value={draft.qty}
        onChange={(e) => onChange({ ...draft, qty: e.target.value })}
      />
      <Input
        data-testid={`${prefix}-notes`}
        aria-label="Notes"
        placeholder="Notes"
        className="h-8 min-w-0 flex-1 text-sm"
        value={draft.notes}
        onChange={(e) => onChange({ ...draft, notes: e.target.value })}
      />
    </div>
  );
}

/** DM Edit: full replacement (FR-PARTY-20); Enter saves, Esc cancels. */
function EditForm({
  item,
  live,
  onDone,
}: {
  item: PartyItemRecord;
  live: boolean;
  onDone(): void;
}) {
  const [draft, setDraft] = useState<ItemDraft>(() => editDraftOf(item));
  const { busy, error, send } = useItemIntent(LOST_ITEM_EDIT);
  const parsed = editPayload(item, draft);
  const enabled = submitEnabled({ valid: parsed.ok, live, busy, unchanged: parsed.unchanged });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!enabled || !parsed.ok) return;
    if (await send(I.editItem, parsed.value)) onDone();
  };
  return (
    <form
      data-testid="party-item-edit-form"
      onSubmit={submit}
      onKeyDown={escapeTo(onDone)}
      className="flex flex-col gap-1 pb-1.5"
    >
      <fieldset disabled={!live} className="flex flex-col gap-1">
        <ItemInputs draft={draft} onChange={setDraft} prefix="party-item-edit" />
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-testid="party-item-cancel"
            onClick={onDone}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" data-testid="party-item-submit" disabled={!enabled}>
            Save
          </Button>
        </div>
      </fieldset>
      <ErrorLine message={error ?? (!parsed.ok ? parsed.message : null)} />
    </form>
  );
}

/** DM Add form (FR-PARTY-24): name, qty, notes; Enter submits; ack clears. */
function AddForm({ live }: { live: boolean }) {
  const [draft, setDraft] = useState<ItemDraft>(EMPTY_ITEM);
  const { busy, error, send } = useItemIntent(LOST_ITEM_ADD);
  const parsed = addPayload(draft);
  const enabled = submitEnabled({ valid: parsed.ok, live, busy });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!enabled || !parsed.ok) return;
    if (await send(I.addItem, parsed.value)) setDraft(EMPTY_ITEM);
  };
  const dirty = draft.name !== "" || draft.notes !== "" || draft.qty !== EMPTY_ITEM.qty;
  return (
    <form data-testid="party-item-add" onSubmit={submit} className="flex flex-col gap-1">
      <fieldset disabled={!live} className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <ItemInputs draft={draft} onChange={setDraft} prefix="party-item-add" />
        </div>
        <Button type="submit" size="sm" data-testid="party-item-add-submit" disabled={!enabled}>
          Add
        </Button>
      </fieldset>
      <ErrorLine
        testId="party-item-add-error"
        message={error ?? (!parsed.ok && dirty ? parsed.message : null)}
      />
    </form>
  );
}

const sourceKey = (s: GiveSource) => s.row.id;

/** Give…: one of the viewer's characters' sheet items → Party or another character. */
function GivePanel({
  sources,
  chars,
  viewer,
  live,
  onDone,
}: {
  sources: GiveSource[];
  chars: InvCharacter[];
  viewer: InvViewer;
  live: boolean;
  onDone(): void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const source = sources.find((s) => sourceKey(s) === chosen);
  const options = source ? giveTargetsOf(chars, viewer, source) : [];
  const [targetSel, setTarget] = useState("");
  const target = pick(options, targetSel);
  const [qty, setQty] = useState("1");
  const { busy, error, send } = useItemIntent(LOST_ITEM_MOVE);
  const parsed = givePayload(source, target, qty);
  const enabled = submitEnabled({ valid: parsed.ok, live, busy });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!enabled || !parsed.ok) return;
    if (await send(I.moveItem, parsed.value)) onDone();
  };
  return (
    <form
      data-testid="party-item-give-form"
      onSubmit={submit}
      onKeyDown={escapeTo(onDone)}
      className="flex flex-col gap-1 rounded-md border p-1.5"
    >
      {sources.length === 0 ? (
        <p className="text-xs text-muted-foreground">No items on your characters' sheets</p>
      ) : (
        <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
          {sources.map((s) => (
            <li key={sourceKey(s)}>
              <button
                type="button"
                data-testid="party-item-source"
                data-record-id={s.row.id}
                data-character-id={s.character.id}
                aria-pressed={chosen === sourceKey(s)}
                disabled={!live}
                onClick={() => setChosen(sourceKey(s))}
                className={cn(
                  "flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-accent disabled:opacity-50",
                  chosen === sourceKey(s) && "bg-accent",
                )}
              >
                <span className="text-muted-foreground">{s.character.name}:</span>
                <span className="min-w-0 flex-1 truncate">{s.row.name}</span>
                <span className="tabular-nums text-muted-foreground">×{s.row.qty}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <fieldset disabled={!live || !source} className="flex items-center gap-1">
        {source ? (
          <TargetPicker options={options} value={target} onChange={setTarget} />
        ) : (
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">Pick an item</span>
        )}
        <QtyInput value={qty} onChange={setQty} />
        <Button type="submit" size="sm" data-testid="party-item-submit" disabled={!enabled}>
          Give
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-testid="party-item-cancel"
          onClick={onDone}
        >
          Cancel
        </Button>
      </fieldset>
      <ErrorLine message={error ?? (source && !parsed.ok && qty !== "" ? parsed.message : null)} />
    </form>
  );
}

const giveTargetsOf = (chars: InvCharacter[], viewer: InvViewer, s: GiveSource) =>
  giveTargets(chars, viewer, s.character.id);

interface CharacterRecordLike extends InvCharacter {
  kind: string;
}

type Open = { kind: "take" | "edit" | "remove"; itemId: string } | { kind: "give" } | null;

export function InventoryTab() {
  const you = useSync((s) => s.store.you);
  const live = useSync((s) => s.state === "live");
  const { rows, state, retry } = useLazyRecords<PartyItemRecord>(PARTY_ITEM_TYPE);
  const entities = useRecords<CharacterRecordLike>(ENTITY_TYPE);
  const sheets = useSync((s) => s.store.records[CREATURE_SHEET_TYPE]) as
    | Record<string, CreatureSheetRecord | undefined>
    | undefined;
  const chars = useMemo(
    () =>
      entities
        .filter((e) => e.kind === "character")
        .map((e) => ({ id: e.id, name: e.name, ownerPlayerId: e.ownerPlayerId })),
    [entities],
  );
  const sorted = useMemo(() => sortItems(rows), [rows]);
  const [open, setOpen] = useState<Open>(null);
  const campaignId = you?.campaignId ?? null;
  // A campaign switch closes any open form.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on campaign change only
  useEffect(() => setOpen(null), [campaignId]);

  if (!you) return null;
  const viewer: InvViewer = { role: you.role === "dm" ? "dm" : "player", playerId: you.playerId };
  const isDm = viewer.role === "dm";
  const movable = canTakeOrGive(chars, viewer);
  const targets = takeTargets(chars, viewer);
  const sources = giveSources(chars, sheets ?? {}, viewer);
  const close = () => setOpen(null);
  const isOpen = (kind: "take" | "edit" | "remove", itemId: string) =>
    open !== null && open.kind === kind && open.itemId === itemId;

  let list: ReactNode;
  if (state === "error") list = <RetryLoad onRetry={retry} />;
  else if (state === "loading") list = <LoadingRows testId="party-item-loading" />;
  else if (sorted.length === 0)
    list = (
      <p data-testid="party-item-empty" className="p-2 text-sm text-muted-foreground">
        {INVENTORY_EMPTY}
      </p>
    );
  else
    list = (
      <ul data-testid="party-item-list" className="flex flex-col divide-y">
        {sorted.map((i) => (
          <li
            key={i.id}
            data-testid="party-item-row"
            data-record-id={i.id}
            className="flex flex-col px-1"
          >
            <div className="flex items-baseline gap-2 py-1.5 text-sm">
              <span data-testid="party-item-name" className="min-w-0 flex-1 truncate">
                {i.name}
              </span>
              <span data-testid="party-item-count" className="tabular-nums text-muted-foreground">
                ×{i.qty}
              </span>
              {i.notes && (
                <span className="max-w-[30%] truncate text-xs text-muted-foreground">
                  {i.notes}
                </span>
              )}
              {movable && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  data-testid="party-item-take"
                  disabled={!live}
                  onClick={() => setOpen({ kind: "take", itemId: i.id })}
                >
                  {isDm ? "Move…" : "Take"}
                </Button>
              )}
              {isDm && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    data-testid="party-item-edit"
                    disabled={!live}
                    onClick={() => setOpen({ kind: "edit", itemId: i.id })}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    data-testid="party-item-remove"
                    disabled={!live}
                    onClick={() => setOpen({ kind: "remove", itemId: i.id })}
                  >
                    Remove
                  </Button>
                </>
              )}
            </div>
            {isOpen("take", i.id) && (
              <TakeForm item={i} chars={targets} live={live} onDone={close} />
            )}
            {isOpen("edit", i.id) && <EditForm item={i} live={live} onDone={close} />}
            {isOpen("remove", i.id) && <RemoveForm item={i} live={live} onDone={close} />}
          </li>
        ))}
      </ul>
    );

  return (
    <div data-testid="party-inventory" className="flex flex-col gap-2">
      {isDm && <AddForm live={live} />}
      {movable && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            data-testid="party-item-give"
            disabled={!live}
            onClick={() => setOpen(open?.kind === "give" ? null : { kind: "give" })}
          >
            Give…
          </Button>
        </div>
      )}
      {open?.kind === "give" && (
        <GivePanel sources={sources} chars={chars} viewer={viewer} live={live} onDone={close} />
      )}
      {list}
    </div>
  );
}

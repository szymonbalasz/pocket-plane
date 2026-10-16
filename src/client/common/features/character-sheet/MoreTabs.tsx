// Features, Inventory and Notes tabs (CHARX §7). Feature uses are counters (owner + DM, also
// locked); everything else edits in place in edit mode. The wallet line is party-loot's
// read-only `wallet` record (FR-CHARX-33).
import {
  CHARX_INTENTS,
  type FeatureRow,
  type ItemRow,
  ROW_LIMITS,
} from "@shared/character-sheet/sheet";
import { WALLET_TYPE, type WalletRecord } from "@shared/party-loot/schemas";
import { useRecords, useSync } from "../../sync/store";
import { DiceText } from "../dice-extras/DiceText";
import { LOOT_LOG_KIND } from "../party-loot/logic";
import { useOpenWindow } from "../play-shell/ShellContext";
import { IntField, SelectField, TextField, useBusy } from "./fields";
import { AddRow, RowTools, useRows } from "./rows";
import { notationContext, useSheet, useSheetIntents } from "./sheet-context";
import { pipDelta, walletLine } from "./view-model";

const clean = (row: Record<string, unknown>) => {
  for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k];
  return row;
};

function FeatureUses({ f }: { f: FeatureRow }) {
  const ctx = useSheet();
  const live = useSync((s) => s.state === "live");
  const intents = useSheetIntents();
  const busy = useBusy();
  if (!f.usesMax) return null;
  const counters = ctx.creature.kind === "character" && ctx.canCount;
  const use = (op: object) =>
    busy.run(() =>
      intents.send(CHARX_INTENTS.useResource, {
        characterId: ctx.creature.id,
        resource: { feature: f.id },
        ...op,
      }),
    );
  return (
    <span className="flex items-center gap-1">
      {Array.from({ length: f.usesMax }, (_, i) => (
        <button
          // biome-ignore lint/suspicious/noArrayIndexKey: pips are positional.
          key={i}
          type="button"
          data-testid="charx-feature-use"
          data-record-id={f.id}
          data-used={f.used}
          aria-label={`${f.name}: ${f.used} of ${f.usesMax} used`}
          disabled={!live || busy.busy || !counters}
          className={`size-3 rounded-full border border-foreground/60 ${i < f.used ? "bg-foreground" : ""}`}
          onClick={(e) => use({ delta: pipDelta(e.shiftKey) })}
        />
      ))}
      <span className="text-[10px] tabular-nums text-muted-foreground">
        {f.used}/{f.usesMax}
        {f.reset ? ` · ${f.reset} rest` : ""}
      </span>
      {counters && f.used > 0 && (
        <button
          type="button"
          data-testid="charx-resource-reset"
          data-value={`feature.${f.id}`}
          disabled={!live || busy.busy}
          className="text-[10px] text-muted-foreground underline"
          onClick={() => use({ reset: true })}
        >
          Reset
        </button>
      )}
    </span>
  );
}

function FeatureView({ f, index, count }: { f: FeatureRow; index: number; count: number }) {
  const ctx = useSheet();
  const rows = useRows("features");
  const e = ctx.editing && ctx.canEdit;
  const put = (patch: Partial<FeatureRow>) => rows.put(clean({ ...f, ...patch }));
  return (
    <div
      data-testid="charx-feature"
      data-record-id={f.id}
      className="flex flex-col gap-1 border-b py-1.5"
    >
      {e ? (
        <>
          <div className="flex items-start gap-1">
            <TextField
              path={`features.${f.id}.name`}
              label="Feature name"
              value={f.name}
              max={60}
              required
              className="flex-1"
              commit={(name) => put({ name })}
            />
            <RowTools list="features" rowId={f.id} index={index} count={count} />
          </div>
          <div className="flex flex-wrap items-start gap-1">
            <TextField
              path={`features.${f.id}.source`}
              label="Source"
              placeholder="Source"
              value={f.source}
              max={40}
              commit={(source) => put({ source })}
            />
            <IntField
              path={`features.${f.id}.usesMax`}
              label="Uses"
              value={f.usesMax ?? null}
              min={1}
              max={20}
              optional
              commit={(usesMax) => put({ usesMax: usesMax ?? undefined })}
            />
            <SelectField
              path={`features.${f.id}.reset`}
              label="Reset on"
              value={f.reset ?? null}
              options={[
                { value: "" as const, label: "No reset" },
                { value: "short", label: "Short rest" },
                { value: "long", label: "Long rest" },
              ]}
              commit={(reset) => put({ reset: reset ?? undefined })}
            />
          </div>
          <TextField
            path={`features.${f.id}.text`}
            label="Feature text"
            value={f.text}
            max={600}
            multiline
            commit={(text) => put({ text })}
          />
        </>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">{f.name}</span>
            {f.source && <span className="text-[10px] text-muted-foreground">{f.source}</span>}
          </div>
          {f.text && (
            <p className="text-xs whitespace-pre-wrap text-muted-foreground">
              <DiceText text={f.text} context={notationContext(ctx, f.name)} />
            </p>
          )}
        </>
      )}
      <FeatureUses f={f} />
    </div>
  );
}

export function FeaturesTab() {
  const ctx = useSheet();
  const list = ctx.sheet.features;
  const e = ctx.editing && ctx.canEdit;
  return (
    <div className="flex flex-col gap-1">
      {list.length === 0 && !e && <p className="text-xs text-muted-foreground">No features</p>}
      {list.map((f, i) => (
        <FeatureView key={f.id} f={f} index={i} count={list.length} />
      ))}
      {e && (
        <AddRow
          list="features"
          label="Feature"
          full={list.length >= ROW_LIMITS.features}
          row={{ name: "New feature" }}
        />
      )}
    </div>
  );
}

function ItemView({ it, index, count }: { it: ItemRow; index: number; count: number }) {
  const ctx = useSheet();
  const rows = useRows("items");
  const e = ctx.editing && ctx.canEdit;
  const put = (patch: Partial<ItemRow>) => rows.put({ ...it, ...patch });
  return (
    <div
      data-testid="charx-item"
      data-record-id={it.id}
      className="flex flex-col gap-0.5 border-b py-1"
    >
      {e ? (
        <div className="flex flex-wrap items-start gap-1">
          <TextField
            path={`items.${it.id}.name`}
            label="Item name"
            value={it.name}
            max={60}
            required
            className="flex-1"
            commit={(name) => put({ name })}
          />
          <IntField
            path={`items.${it.id}.qty`}
            label="Quantity"
            value={it.qty}
            min={0}
            max={9999}
            commit={(qty) => put({ qty: qty ?? 0 })}
          />
          <SelectField
            path={`items.${it.id}.equipped`}
            label="Equipped"
            value={it.equipped ? "yes" : "no"}
            options={[
              { value: "no", label: "Carried" },
              { value: "yes", label: "Equipped" },
            ]}
            commit={(v) => put({ equipped: v === "yes" })}
          />
          <RowTools list="items" rowId={it.id} index={index} count={count} />
          <TextField
            path={`items.${it.id}.notes`}
            label="Item notes"
            placeholder="Notes"
            value={it.notes}
            max={120}
            className="w-full"
            commit={(notes) => put({ notes })}
          />
        </div>
      ) : (
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="min-w-0 truncate">
            {it.name}
            {it.qty !== 1 && <span className="text-muted-foreground"> ×{it.qty}</span>}
          </span>
          {it.equipped && <span className="text-[10px] text-muted-foreground">Equipped</span>}
        </div>
      )}
      {!e && it.notes && (
        <p className="text-xs text-muted-foreground">
          <DiceText text={it.notes} context={notationContext(ctx, it.name)} />
        </p>
      )}
    </div>
  );
}

function WalletLine() {
  const ctx = useSheet();
  const openWindow = useOpenWindow();
  const wallets = useRecords<WalletRecord>(WALLET_TYPE);
  if (ctx.creature.kind !== "character") return null;
  const w = wallets.find((x) => x.characterId === ctx.creature.id);
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span data-testid="charx-wallet" className="tabular-nums">
        {walletLine(w)}
      </span>
      <button
        type="button"
        data-testid="charx-wallet-open"
        className="text-[10px] text-muted-foreground underline"
        onClick={() => openWindow(LOOT_LOG_KIND)}
      >
        Move coin in Party loot
      </button>
    </div>
  );
}

const NOTE_KEYS = [
  ["armor", "Armour"],
  ["weapons", "Weapons"],
  ["tools", "Tools"],
  ["languages", "Languages"],
] as const;

function ProficiencyNotes() {
  const ctx = useSheet();
  const intents = useSheetIntents();
  const notes = ctx.sheet.proficiencyNotes;
  const e = ctx.editing && ctx.canEdit;
  if (!e && NOTE_KEYS.every(([k]) => !notes[k])) return null;
  return (
    <div className="flex flex-col gap-1 border-t pt-2 text-xs">
      <span className="text-xs font-medium text-muted-foreground">Proficiencies</span>
      {NOTE_KEYS.map(([k, label]) =>
        e ? (
          <TextField
            key={k}
            path={`proficiencyNotes.${k}`}
            label={label}
            placeholder={label}
            value={notes[k]}
            max={200}
            commit={(v) =>
              intents.edit(ctx.creature.id, { proficiencyNotes: { ...notes, [k]: v } })
            }
          />
        ) : (
          notes[k] && (
            <p key={k}>
              <span className="text-muted-foreground">{label}: </span>
              {notes[k]}
            </p>
          )
        ),
      )}
    </div>
  );
}

export function InventoryTab() {
  const ctx = useSheet();
  const items = ctx.sheet.items;
  const e = ctx.editing && ctx.canEdit;
  return (
    <div className="flex flex-col gap-1">
      <WalletLine />
      {items.length === 0 && !e && <p className="text-xs text-muted-foreground">No items</p>}
      {items.map((it, i) => (
        <ItemView key={it.id} it={it} index={i} count={items.length} />
      ))}
      {e && (
        <AddRow
          list="items"
          label="Item"
          full={items.length >= ROW_LIMITS.items}
          row={{ name: "New item" }}
        />
      )}
      <ProficiencyNotes />
    </div>
  );
}

export function NotesTab() {
  const ctx = useSheet();
  const intents = useSheetIntents();
  const s = ctx.sheet;
  const e = ctx.editing && ctx.canEdit;
  const edit = (key: string) => (v: string) => intents.edit(ctx.creature.id, { [key]: v });
  if (e) {
    return (
      <div className="flex flex-col gap-1.5">
        <TextField
          path="background"
          label="Background"
          placeholder="Background"
          value={s.background}
          max={40}
          commit={edit("background")}
        />
        <TextField
          path="alignment"
          label="Alignment"
          placeholder="Alignment"
          value={s.alignment}
          max={40}
          commit={edit("alignment")}
        />
        <TextField
          path="notes"
          label="Notes"
          value={s.notes}
          max={4000}
          multiline
          commit={edit("notes")}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 text-xs">
      {s.background && (
        <p>
          <span className="text-muted-foreground">Background: </span>
          {s.background}
        </p>
      )}
      {s.alignment && (
        <p>
          <span className="text-muted-foreground">Alignment: </span>
          {s.alignment}
        </p>
      )}
      <p data-testid="charx-notes" className="whitespace-pre-wrap">
        {s.notes ? (
          <DiceText text={s.notes} context={notationContext(ctx, "Notes")} />
        ) : (
          <span className="text-muted-foreground">No notes</span>
        )}
      </p>
    </div>
  );
}

// Window `charx.companion` body, both clients (FR-CHARX-59–68, CHARX §7): a small card built from
// a companion's stat block (HP, AC, speed, size / type, mode, attacks with Roll, conditions). Not
// a sheet (FR-CHARX-66): the only edit is a pet's AC, HP max, speed and attack rows (FR-CHARX-63,
// #288). One window, a picker between the viewer's companions (OQ-CHARX-31). Every change goes
// out as an existing intent; the DM's combat parts (Damage / heal, chip menu) come in as `dm`.
import { hpState, initials, parseHpAmount, speedText } from "@shared/character-sheet/logic";
import { COMPANION_ROLL_BUTTONS, type PetRollKind } from "@shared/character-sheet/rolls";
import { defaultSheetData } from "@shared/character-sheet/sheet";
import type { CombatantView } from "@shared/combat-tracker/schemas";
import {
  CARD_ATTACKS_MAX,
  type CompanionCardAttack,
  type DefinitionRecord,
  ENTITY_TYPE,
  type MonsterStatBlock,
} from "@shared/entities/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { Trash2Icon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { Button } from "../../../components/ui/button";
import { Badge, Input, Skeleton } from "../../../components/ui/primitives";
import { cn } from "../../../lib/utils";
import { useRecords, useSync } from "../../../sync/store";
import { AssetImg } from "../../assets-pipeline/AssetImg";
import { activeEffects, effectsOn } from "../../combat-extras/logic";
import { EffectChips } from "../../combat-extras/parts";
import { useCompanionCardRequest } from "../../combat-tracker/companion-card-request";
import { SIDE_LABEL } from "../../combat-tracker/side";
import { useCombatants, useStartedEncounter } from "../../combat-tracker/store";
import { slotLabelsOf } from "../../dice-roll-log/logic";
import { RollButton, useRollControl } from "../../dice-roll-log/roll-control";
import { useOpenWindow } from "../../play-shell/ShellContext";
import { AttackEditFields } from "../ActionsTab";
import { IntField, useBusy } from "../fields";
import { ROLL_HINT } from "../rolls";
import { AddRow, useRows } from "../rows";
import { openSheetFor } from "../selection";
import { SheetContext, type SheetCtx, useSheetIntents } from "../sheet-context";
import { attackRowView } from "../view-model";
import { CHAR_SHEET_KIND } from "../window";
import {
  bindCompanionMemory,
  type CompanionEntityLike,
  type CompanionEntry,
  companionEntries,
  companionMemoryKey,
  companionSelection,
  entryFor,
  GONE_MS,
  leftCompanion,
  modeText,
  ownerText,
  selectCompanion,
  shownEntry,
  sizeTypeText,
} from "./picker";
import { type CardRollTarget, cardCritOptions, cardRollIntent, cardRowSpecs } from "./rolls";

/** FR-ENT-36 (entities, CP1): a pet's kept HP out of a fight; the card's ± sends it. */
export const PET_ADJUST_HP = "pet.adjustHp";

export const EMPTY_TEXT = "No companions — your DM can give you one";
export const DM_EMPTY_TEXT = "No companions in this campaign";
export const GONE_TEXT = "No longer your companion";
export const IN_FIGHT_HP_HINT = "The DM applies damage in combat";
export const OFFLINE_TEXT = "Disconnected — reconnecting…";

const HP_CLASS = { full: "text-hp-full", bloodied: "text-hp-bloodied", down: "text-hp-down" };
const HP_BAR = { full: "bg-hp-full", bloodied: "bg-hp-bloodied", down: "bg-hp-down" };

/** The DM client's combat parts (`@dm` can't be imported here). */
export interface CompanionDmParts {
  /** FR-CHARX-63: in a fight, the button that opens combat's Damage / heal dialog (FR-CBT-21). */
  hpButton(c: CombatantView): ReactNode;
  /** FR-CHARX-65: the combatant's effect chips with the Initiative row's chip menu. */
  effects(c: CombatantView, round: number): ReactNode;
}

interface CardProps {
  e: CompanionEntry;
  /** The pet's full row (DM, owner); null for a summon. */
  pet: CompanionEntityLike | null;
  client: "dm" | "player";
  picker: ReactNode;
  live: boolean;
  dm?: CompanionDmParts;
  /** DM: the definition has an NPC sheet (a pet or a custom; FR-CHARX-66). */
  npcSheet: boolean;
  ownerPlayerName: string | null;
  /** Tests: open in edit mode (a static render can't press Edit). */
  startEditing?: boolean;
}

function Portrait({ e }: { e: CompanionEntry }) {
  return (
    <div className="size-10 shrink-0 overflow-hidden rounded-full">
      {e.imageAssetId ? (
        <AssetImg id={e.imageAssetId} file="thumb" alt={e.name} className="size-full" />
      ) : (
        <div className="flex size-full items-center justify-center bg-muted text-sm font-semibold text-muted-foreground">
          {initials(e.name)}
        </div>
      )}
    </div>
  );
}

/** FR-CHARX-62: portrait, name, "Mira's pet", the mode in words, "In combat", side chip. */
function Header({ e, picker, edit }: { e: CompanionEntry; picker: ReactNode; edit: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <Portrait e={e} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span data-testid="charx-companion-name" className="truncate font-semibold">
            {e.name}
          </span>
          {e.combatant && (
            <Badge data-testid="charx-companion-in-combat" variant="secondary" className="px-1.5">
              In combat
            </Badge>
          )}
          {e.side && (
            <Badge
              data-testid="charx-companion-side"
              data-value={e.side}
              variant="outline"
              className="px-1.5 text-[11px]"
            >
              {SIDE_LABEL[e.side]}
            </Badge>
          )}
        </div>
        <span data-testid="charx-companion-owner" className="text-xs text-muted-foreground">
          {ownerText(e)}
        </span>
        <span
          data-testid="charx-companion-mode"
          data-value={e.turnMode}
          className="text-xs text-muted-foreground"
        >
          {modeText(e.turnMode, e.ownerName)}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {picker}
        {edit}
      </div>
    </div>
  );
}

/** FR-CHARX-63 (pet out of a fight, owner and DM): amount + Damage / Heal → `pet.adjustHp`. */
function PetHpAdjust({ petId, live }: { petId: string; live: boolean }) {
  const intents = useSheetIntents();
  const [raw, setRaw] = useState("");
  const busy = useBusy();
  const amount = parseHpAmount(raw);
  const off = !live || busy.busy || amount === null;
  const send = (sign: 1 | -1) => {
    if (amount === null) return;
    busy.run(() =>
      intents.send(PET_ADJUST_HP, { petId, delta: sign * amount }).then(() => setRaw("")),
    );
  };
  return (
    <div className="flex items-center gap-1.5">
      <Input
        data-testid="charx-companion-hp-amount"
        aria-label="HP amount"
        inputMode="numeric"
        placeholder="Amount"
        className="h-7 w-16 px-1.5 text-xs"
        value={raw}
        disabled={!live}
        aria-invalid={raw.trim() !== "" && amount === null}
        onChange={(ev) => setRaw(ev.target.value)}
      />
      <Button
        data-testid="charx-companion-hp-adjust"
        data-value="damage"
        size="sm"
        variant="destructive"
        className="h-7 px-2"
        disabled={off}
        onClick={() => send(-1)}
      >
        Damage
      </Button>
      <Button
        data-testid="charx-companion-hp-adjust"
        data-value="heal"
        size="sm"
        variant="outline"
        className="h-7 px-2"
        disabled={off}
        onClick={() => send(1)}
      >
        Heal
      </Button>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** FR-CHARX-63: AC · HP bar + "45 / 59" (+ temp) · Speed; edit mode: AC, HP max, Speed inputs. */
function Stats({ e, editing, petId }: { e: CompanionEntry; editing: boolean; petId: string }) {
  const intents = useSheetIntents();
  const card = e.card;
  const { current, max, temp } = e.hp;
  const state = current !== null && max ? hpState(current, max) : "full";
  const edit = (key: "ac" | "hpMax" | "speed", v: number | null) =>
    intents.edit(petId, { [key]: v });
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
      <Stat label="AC">
        {editing ? (
          <IntField
            path="ac"
            label="AC"
            value={card?.ac ?? 0}
            min={0}
            max={30}
            commit={(v) => edit("ac", v)}
          />
        ) : (
          <span
            data-testid="charx-companion-ac"
            data-value={card?.ac}
            className="text-lg font-semibold tabular-nums leading-tight"
          >
            {card?.ac ?? "—"}
          </span>
        )}
      </Stat>
      <Stat label="HP">
        <span className="flex items-center gap-1.5">
          <span
            data-testid="charx-companion-hp"
            data-value={current ?? undefined}
            data-state={state}
            className={cn("text-lg font-semibold tabular-nums leading-tight", HP_CLASS[state])}
          >
            {current ?? "—"} / {max ?? "—"}
          </span>
          {temp > 0 && (
            <span data-testid="charx-companion-temp" className="text-xs text-muted-foreground">
              Temp {temp}
            </span>
          )}
          {editing && (
            <IntField
              path="hpMax"
              label="HP max"
              value={card?.hpMax ?? max ?? 1}
              min={1}
              max={999}
              commit={(v) => edit("hpMax", v)}
            />
          )}
        </span>
        {current !== null && max ? (
          <span className="mt-0.5 h-1 w-24 overflow-hidden rounded-full bg-muted">
            <span
              className={cn("block h-full", HP_BAR[state])}
              style={{ width: `${Math.max(0, Math.min(100, (current / max) * 100))}%` }}
            />
          </span>
        ) : null}
      </Stat>
      <Stat label="Speed">
        {editing ? (
          <IntField
            path="speed"
            label="Speed"
            value={card?.speed ?? null}
            min={0}
            max={200}
            step={5}
            optional
            commit={(v) => edit("speed", v)}
          />
        ) : (
          <span
            data-testid="charx-companion-speed"
            data-value={card?.speed}
            className="text-lg font-semibold tabular-nums leading-tight"
          >
            {speedText(card?.speed)}
          </span>
        )}
      </Stat>
    </div>
  );
}

/** FR-CHARX-64: one of a card row's three buttons (shared roll control: Shift / Ctrl, physical). */
function CardRoll({
  e,
  target,
  row,
  kind,
  label,
  live,
}: {
  e: CompanionEntry;
  target: CardRollTarget;
  row: CompanionCardAttack;
  kind: PetRollKind;
  label: string;
  live: boolean;
}) {
  const connection = useSync((s) => s.connection);
  const notes = useRecords<NotificationRecord>("notification");
  const busy = useBusy();
  const specs = cardRowSpecs(row, kind);
  const slotLabels = slotLabelsOf(specs);
  const control = useRollControl({
    expressions: specs.map((s) => s.expression),
    category: specs[0]?.category ?? "other",
    label: `${e.name} — ${row.name} ${label.toLowerCase()}`,
    ...(slotLabels ? { slotLabels } : {}),
    ...cardCritOptions(target, row, kind, notes),
    onRoll(r) {
      const intent = cardRollIntent(target, row.id, kind, r);
      busy.run(() => connection.sendIntent(intent.name, intent.payload));
    },
  });
  return (
    <RollButton
      control={control}
      hint={ROLL_HINT}
      type="button"
      size="sm"
      variant="secondary"
      className="h-7 px-2"
      data-testid="charx-companion-roll"
      data-value={kind}
      data-record-id={row.id}
      disabled={!live || busy.busy}
    >
      {label}
    </RollButton>
  );
}

/** FR-CHARX-63 edit mode: a row's delete (moving rows stays the DM's, on the NPC sheet). */
function DeleteRow({ rowId, live }: { rowId: string | undefined; live: boolean }) {
  const rows = useRows("attacks");
  const busy = useBusy();
  return (
    <Button
      size="icon"
      variant="ghost"
      className="size-6"
      data-testid="charx-row-delete"
      data-value="attacks"
      data-record-id={rowId}
      aria-label="Delete row"
      disabled={!live || busy.busy || rowId === undefined}
      onClick={() => rowId && busy.run(() => rows.remove(rowId))}
    >
      <Trash2Icon className="size-3" />
    </Button>
  );
}

/** FR-CHARX-64: "Claws · +7 · 2d8+5 slashing" + Attack / Damage / Attack + damage per row. */
function Attacks({
  e,
  pet,
  editing,
  live,
}: {
  e: CompanionEntry;
  pet: CompanionEntityLike | null;
  editing: boolean;
  live: boolean;
}) {
  const card = e.card;
  // In a fight the companion attacks (FR-CBT-114); out of one only a pet rolls (FR-CHARX-69).
  const target: CardRollTarget | null = e.combatant
    ? { combatantId: e.combatant.id }
    : e.petId
      ? { petId: e.petId }
      : null;
  const editRows = editing ? (pet?.statBlock?.attacks ?? []) : [];
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">Attacks</span>
      {editing ? (
        <>
          {editRows.map((a, i) => (
            <div
              key={a.id ?? `legacy-${i}`}
              data-testid="charx-companion-attack"
              data-record-id={a.id}
              className="border-b py-1.5"
            >
              <AttackEditFields a={a} tools={<DeleteRow rowId={a.id} live={live} />} />
            </div>
          ))}
          {editRows.length < CARD_ATTACKS_MAX && (
            <AddRow
              list="attacks"
              label="Attack"
              full={false}
              row={{ name: "New attack", toHit: 0, damage: "1d6" }}
            />
          )}
        </>
      ) : (
        <>
          {card?.attacks.length === 0 && (
            <p className="text-xs text-muted-foreground">No attacks</p>
          )}
          {card?.attacks.map((row) => {
            const v = attackRowView(row);
            return (
              <div
                key={row.id}
                data-testid="charx-companion-attack"
                data-record-id={row.id}
                className="flex flex-col gap-1 border-b py-1.5"
              >
                <span className="text-sm">
                  {v.name}
                  <span className="text-muted-foreground">
                    {" · "}
                    {v.parts.join(" ")}
                  </span>
                </span>
                {target && (
                  <div className="flex flex-wrap justify-end gap-1">
                    {COMPANION_ROLL_BUTTONS.map((b) => (
                      <CardRoll
                        key={b.kind}
                        e={e}
                        target={target}
                        row={row}
                        kind={b.kind}
                        label={b.label}
                        live={live}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {card?.more ? (
            <span data-testid="charx-companion-more" className="text-xs text-muted-foreground">
              +{card.more} more
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}

/** FR-CHARX-65: the combatant's effects the viewer receives; none out of a fight. */
function Conditions({ c, round, dm }: { c: CombatantView; round: number; dm?: CompanionDmParts }) {
  const store = useSync((s) => s.store);
  if (dm) return <>{dm.effects(c, round)}</>;
  const effects = effectsOn(activeEffects(store), { combatantId: c.id });
  return <EffectChips effects={effects} round={round} testId="charx-companion-effect" />;
}

/** One companion's card. */
export function CompanionCardView({
  e,
  pet,
  client,
  picker,
  live,
  dm,
  npcSheet,
  ownerPlayerName,
  startEditing = false,
}: CardProps) {
  const [editing, setEditing] = useState(startEditing);
  const enc = useStartedEncounter();
  const openWindow = useOpenWindow();
  // FR-CHARX-63: the Edit toggle is a pet's, for the owner and the DM; summons stay read-only.
  const canEdit = pet !== null && pet.statBlock !== undefined;
  const isEditing = editing && canEdit && live;
  const hpControl = e.combatant ? (
    client === "dm" && dm ? (
      dm.hpButton(e.combatant)
    ) : (
      <span data-testid="charx-companion-hp-hint" className="text-xs text-muted-foreground">
        {IN_FIGHT_HP_HINT}
      </span>
    )
  ) : e.petId ? (
    <PetHpAdjust petId={e.petId} live={live} />
  ) : null;
  const body = (
    <div
      data-testid="charx-companion"
      data-record-id={e.key}
      data-editing={isEditing ? "true" : "false"}
      className="flex flex-col gap-2 p-1"
    >
      <Header
        e={e}
        picker={picker}
        edit={
          canEdit ? (
            <Button
              size="sm"
              variant={isEditing ? "secondary" : "outline"}
              className="h-7"
              data-testid="charx-companion-edit"
              data-state={isEditing ? "on" : "off"}
              aria-pressed={isEditing}
              disabled={!live}
              onClick={() => setEditing(!isEditing)}
            >
              {isEditing ? "Done" : "Edit"}
            </Button>
          ) : null
        }
      />
      {e.combatant && <Conditions c={e.combatant} round={enc?.round ?? 0} dm={dm} />}
      {e.petId && isEditing ? (
        <Stats e={e} editing petId={e.petId} />
      ) : (
        <Stats e={e} editing={false} petId={e.petId ?? ""} />
      )}
      {hpControl}
      {e.card && (
        <span data-testid="charx-companion-type" className="text-xs text-muted-foreground">
          {sizeTypeText(e.card)}
        </span>
      )}
      <Attacks e={e} pet={pet} editing={isEditing} live={live} />
      {client === "dm" && npcSheet && e.definitionId && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1 text-xs underline-offset-2 hover:underline"
            data-testid="charx-companion-npc-sheet"
            onClick={() => {
              openSheetFor(e.definitionId as string, "monster");
              openWindow(CHAR_SHEET_KIND);
            }}
          >
            Open NPC sheet
          </Button>
        </div>
      )}
    </div>
  );
  if (!canEdit || !pet?.statBlock) return body;
  // The sheet's edit fields (FR-CHARX-27 / -28 / -38) read the pet as their creature.
  const ctx: SheetCtx = {
    creature: pet as unknown as DefinitionRecord,
    stats: pet.statBlock as MonsterStatBlock,
    sheet: defaultSheetData(),
    row: undefined,
    client,
    npc: false,
    readOnly: false,
    canEdit: true,
    editing: isEditing,
    canCount: false,
    ownerName: ownerPlayerName,
  };
  return <SheetContext.Provider value={ctx}>{body}</SheetContext.Provider>;
}

export function CompanionCard({ dm }: { dm?: CompanionDmParts }) {
  const you = useSync((s) => s.store.you);
  const live = useSync((s) => s.state === "live");
  const entities = useRecords<CompanionEntityLike>(ENTITY_TYPE);
  const players = useRecords<{ id: string; name: string }>("player");
  const enc = useStartedEncounter();
  const combatants = useCombatants(enc?.id ?? null);
  const sel = useStore(companionSelection);
  const role = you?.role ?? "player";
  const playerId = you?.playerId ?? null;
  const entries = useMemo(
    () => companionEntries({ role, playerId }, entities, combatants),
    [role, playerId, entities, combatants],
  );
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  // FR-CHARX-61: the remembered choice, once the first snapshot is in (and per campaign).
  const memoryKey = you && live ? companionMemoryKey(you.campaignId, you.role, you.playerId) : null;
  useEffect(() => {
    if (memoryKey)
      bindCompanionMemory(memoryKey, (id) => entryFor(entriesRef.current, id) !== null);
  }, [memoryKey]);

  // FR-CBT-119 / FR-PARTY-42 / FR-MAP-77: the latest open request selects its companion.
  const request = useCompanionCardRequest((s) => s.id);
  const requestN = useCompanionCardRequest((s) => s.n);
  const handled = useRef(0);
  useEffect(() => {
    if (requestN === handled.current) return;
    const hit = entryFor(entries, request);
    if (!hit) return;
    handled.current = requestN;
    selectCompanion(hit.key);
  }, [requestN, request, entries]);

  // FR-CHARX-68: the shown companion leaves (Dismiss, hostile, hidden, released) → the message
  // for 3 s, then the picker moves on.
  const shown = shownEntry(entries, sel.selectedId);
  const [gone, setGone] = useState<string | null>(null);
  const lastShown = useRef<CompanionEntry | null>(null);
  useEffect(() => {
    const left = live ? leftCompanion(lastShown.current, entries) : null;
    if (left) setGone(left);
    lastShown.current = left ? null : shown;
  }, [entries, shown, live]);
  useEffect(() => {
    if (!gone) return;
    const t = setTimeout(() => setGone(null), GONE_MS);
    return () => clearTimeout(t);
  }, [gone]);

  if (!you) {
    return (
      <div data-testid="charx-companion-loading" className="flex flex-col gap-3 p-1">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  const client = you.role === "dm" ? "dm" : "player";
  const banner = !live && (
    <p
      data-testid="charx-companion-offline"
      className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
    >
      {OFFLINE_TEXT}
    </p>
  );
  if (gone) {
    return (
      <div className="flex flex-col gap-2 p-2">
        {banner}
        <p data-testid="charx-companion-gone" className="text-sm text-muted-foreground">
          {gone}: {GONE_TEXT}
        </p>
      </div>
    );
  }
  if (!shown) {
    return (
      <div className="flex flex-col gap-2 p-2">
        {banner}
        <p data-testid="charx-companion-empty" className="text-sm text-muted-foreground">
          {client === "dm" ? DM_EMPTY_TEXT : EMPTY_TEXT}
        </p>
      </div>
    );
  }
  const picker = (
    <select
      data-testid="charx-companion-picker"
      aria-label="Companion"
      className="h-7 max-w-32 min-w-0 rounded-md border border-input bg-background px-1.5 text-xs"
      value={shown.key}
      onChange={(ev) => selectCompanion(ev.target.value)}
    >
      {entries.map((x) => (
        <option
          key={x.key}
          value={x.key}
          data-testid="charx-companion-option"
          data-record-id={x.key}
        >
          {client === "dm" ? `${x.name} (${x.ownerName})` : x.name}
        </option>
      ))}
    </select>
  );
  const pet = shown.petId ? (entities.find((x) => x.id === shown.petId) ?? null) : null;
  // FR-CHARX-66: a pet or a custom definition (a campaign row) has an NPC sheet; imported none.
  const npcSheet =
    shown.definitionId !== null &&
    entities.some((x) => x.id === shown.definitionId && (x.campaignId ?? null) !== null);
  const ownerPlayer = pet?.ownerPlayerId ?? shown.combatant?.ownerPlayerId ?? null;
  return (
    <div className="flex flex-col gap-2">
      {banner}
      <CompanionCardView
        key={shown.key}
        e={shown}
        pet={pet}
        client={client}
        picker={picker}
        live={live}
        dm={dm}
        npcSheet={npcSheet}
        ownerPlayerName={players.find((p) => p.id === ownerPlayer)?.name ?? null}
      />
    </div>
  );
}

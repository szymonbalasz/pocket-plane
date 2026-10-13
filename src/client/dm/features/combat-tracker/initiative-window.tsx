// DM `cbt.initiative` (CBT §7): round + turns, Undo, Roll monsters, pending cards, rows by
// `position` (initiative roll / set, AC, HP, band, Attack, Damage / heal, Remove), Removed.
import { critExpression, d20Expression, healthBand } from "@shared/combat-tracker/rules";
import type { CombatantView, EncounterView } from "@shared/combat-tracker/schemas";
import type { DefinitionRecord } from "@shared/entities/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { Button } from "@ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ui/components/ui/menus";
import { Tooltip } from "@ui/components/ui/overlays";
import { Input, Skeleton } from "@ui/components/ui/primitives";
import { BandBadge, Portrait, TurnMarker } from "@ui/features/combat-tracker/parts";
import {
  useCbtIntent,
  useCombatants,
  useStartedEncounter,
} from "@ui/features/combat-tracker/store";
import { ENCOUNTERS_KIND, initiativeWindowBase } from "@ui/features/combat-tracker/window";
import { modeFromKeys } from "@ui/features/dice-roll-log/logic";
import { RollButton, useRollControl } from "@ui/features/dice-roll-log/roll-control";
import { defineWindow } from "@ui/features/play-shell/registry";
import { useOpenWindow } from "@ui/features/play-shell/ShellContext";
import { cn } from "@ui/lib/utils";
import { useSync } from "@ui/sync/store";
import {
  DicesIcon,
  EllipsisIcon,
  EyeOffIcon,
  HeartPulseIcon,
  RotateCcwIcon,
  SwordIcon,
  UserMinusIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AttackPopup, acOf, hpOf } from "./attack-popup";
import { useDefinitions, useLatestUndoable, usePendingCards } from "./data";
import { HpDialog } from "./hp-dialog";
import { useCombatDialogs } from "./popup-store";

function InitiativeCell({ c, def }: { c: CombatantView; def: DefinitionRecord | undefined }) {
  const { send, disabled } = useCbtIntent();
  const [draft, setDraft] = useState(c.initiative == null ? "" : String(c.initiative));
  useEffect(() => setDraft(c.initiative == null ? "" : String(c.initiative)), [c.initiative]);
  const control = useRollControl({
    expressions: [d20Expression(def?.statBlock.initBonus ?? 0)],
    category: "initiative",
    onRoll: (r) =>
      void send("cbt.rollInitiative", {
        combatantIds: [c.id],
        mode: r.mode,
        ...(r.manual ? { manual: r.manual[0] } : {}),
        ...(r.public !== undefined ? { public: r.public } : {}),
      }),
  });
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isInteger(n) || n === c.initiative) {
      setDraft(c.initiative == null ? "" : String(c.initiative));
      return;
    }
    void send("cbt.setInitiative", { combatantId: c.id, value: n });
  };
  return (
    <div className="flex items-center gap-0.5">
      <Input
        data-testid="cbt-init-row-init"
        data-record-id={c.id}
        aria-label={`Initiative of ${c.name}`}
        inputMode="numeric"
        className="h-7 w-11 px-1.5 text-center text-xs tabular-nums"
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      <RollButton
        control={control}
        data-testid="cbt-init-row-roll"
        data-record-id={c.id}
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label={`Roll initiative for ${c.name}`}
        disabled={disabled}
      >
        <DicesIcon className="size-3.5" />
      </RollButton>
    </div>
  );
}

function AttackButton({ c, def }: { c: CombatantView; def: DefinitionRecord | undefined }) {
  const { send, disabled } = useCbtIntent();
  const openCard = useCombatDialogs((s) => s.openCard);
  const attack = def?.statBlock.attacks[0];
  const control = useRollControl({
    expressions: attack ? [d20Expression(attack.toHit), attack.damage] : ["1d20"],
    critExpressions: attack ? [critExpression(attack.damage)] : undefined,
    category: "attack",
    onRoll: async (r) => {
      const res = await send<{ cardId: string }>("cbt.attack", {
        attackerId: c.id,
        mode: r.mode,
        ...(r.manual ? { manual: r.manual } : {}),
      });
      if (res) openCard(res.cardId);
    },
  });
  return (
    <Tooltip content={attack ? `Attack: ${attack.name} (Shift adv, Ctrl dis)` : "No weapon attack"}>
      <span>
        <RollButton
          control={control}
          data-testid="cbt-init-row-attack"
          data-record-id={c.id}
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label={`Attack with ${c.name}`}
          disabled={disabled || !attack}
        >
          <SwordIcon className="size-3.5" />
        </RollButton>
      </span>
    </Tooltip>
  );
}

function Row({
  c,
  def,
  turn,
  defs,
}: {
  c: CombatantView;
  def: DefinitionRecord | undefined;
  turn: boolean;
  defs: Map<string, DefinitionRecord>;
}) {
  const { send, disabled } = useCbtIntent();
  const openHp = useCombatDialogs((s) => s.openHp);
  const hp = hpOf(c, defs);
  const ac = acOf(c, defs);
  return (
    <li
      data-testid="cbt-init-row"
      data-record-id={c.id}
      data-turn={turn}
      data-hidden={c.hidden === true}
      className={cn(
        "flex items-center gap-1 rounded-md px-1 py-0.5",
        turn && "bg-accent",
        c.hidden && "opacity-70",
      )}
    >
      <TurnMarker active={turn} />
      <Portrait name={c.name} imageAssetId={c.imageAssetId} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1">
          <span
            className="truncate text-sm font-medium"
            data-testid="cbt-init-row-name"
            title={c.name}
          >
            {c.name}
          </span>
          {c.hidden && (
            <EyeOffIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="Hidden" />
          )}
        </div>
        <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-muted-foreground tabular-nums">
          <span className="shrink-0">AC {ac ?? "—"}</span>
          <span className="shrink-0" data-testid="cbt-init-row-hp" data-record-id={c.id}>
            HP {hp ? `${hp.cur}/${hp.max}` : "—"}
          </span>
          {c.kind === "monster" && hp && (
            <BandBadge band={healthBand(hp.cur, hp.max)} testId="cbt-init-row-band" />
          )}
        </div>
      </div>
      <InitiativeCell c={c} def={def} />
      <AttackButton c={c} def={def} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            data-testid="cbt-init-row-menu"
            data-record-id={c.id}
            aria-label={`More for ${c.name}`}
          >
            <EllipsisIcon className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem data-testid="cbt-init-row-hp-adjust" onSelect={() => openHp(c.id)}>
            <HeartPulseIcon /> Damage / heal…
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            data-testid="cbt-init-row-remove"
            disabled={disabled}
            onSelect={() => void send("cbt.setRemoved", { combatantId: c.id, removed: true })}
          >
            <UserMinusIcon /> Remove from combat
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function PendingCards({ cards }: { cards: NotificationRecord[] }) {
  const openCard = useCombatDialogs((s) => s.openCard);
  if (cards.length === 0) return null;
  return (
    <section
      aria-label="Pending attacks"
      className="flex max-h-28 shrink-0 flex-col gap-1 overflow-y-auto"
    >
      <h3 className="text-xs font-medium text-muted-foreground">Pending ({cards.length})</h3>
      {cards.map((n) => (
        <Button
          key={n.id}
          variant="outline"
          size="sm"
          data-testid="cbt-init-card"
          data-record-id={n.id}
          className="justify-start truncate"
          onClick={() => openCard(n.id)}
        >
          <SwordIcon className="size-3.5" /> {n.text}
        </Button>
      ))}
    </section>
  );
}

function Header({ enc, rows }: { enc: EncounterView; rows: CombatantView[] }) {
  const { send, disabled } = useCbtIntent();
  const last = useLatestUndoable(enc.id);
  const turnArgs = {
    encounterId: enc.id,
    expectedRound: enc.round,
    expectedTurnId: enc.turnCombatantId ?? null,
  };
  const unrolled = rows.filter((c) => c.kind === "monster" && !c.removed && c.initiative == null);
  const undoText = last
    ? `Undo: ${last.attackerName ?? "DM"} → ${last.targetName}, ${last.kind === "heal" ? "+" : ""}${last.applied}`
    : "Nothing to undo";
  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-semibold">{enc.name}</span>
        <span
          data-testid="cbt-init-round"
          data-value={enc.round}
          className="text-xs text-muted-foreground"
        >
          {enc.round === 0 ? "Initiative" : `Round ${enc.round}`}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          data-testid="cbt-init-prev"
          disabled={disabled || enc.round === 0}
          onClick={() => void send("cbt.prevTurn", turnArgs)}
        >
          Prev
        </Button>
        <Button
          size="sm"
          data-testid="cbt-init-next"
          disabled={disabled}
          onClick={() => void send("cbt.nextTurn", turnArgs)}
        >
          {enc.round === 0 ? "Start round 1" : "Next"}
        </Button>
        <Tooltip content={undoText}>
          <span>
            <Button
              size="sm"
              variant="ghost"
              data-testid="cbt-init-undo"
              aria-label={undoText}
              disabled={disabled || !last}
              onClick={() => last && void send("cbt.undo", { expectedHpChangeId: last.id })}
            >
              <RotateCcwIcon className="size-3.5" /> Undo
            </Button>
          </span>
        </Tooltip>
        <Button
          size="sm"
          variant="ghost"
          data-testid="cbt-init-roll-monsters"
          disabled={disabled || unrolled.length === 0}
          onClick={(e) =>
            void send("cbt.rollInitiative", {
              combatantIds: unrolled.map((c) => c.id),
              mode: modeFromKeys(e, "normal"),
            })
          }
        >
          <DicesIcon className="size-3.5" /> Roll monsters
        </Button>
      </div>
    </div>
  );
}

function DmInitiativeBody() {
  const enc = useStartedEncounter();
  const everLive = useSync((s) => s.everLive);
  const rows = useCombatants(enc?.id);
  const defs = useDefinitions();
  const cards = usePendingCards(enc?.id);
  const openWindow = useOpenWindow();
  const { send, disabled } = useCbtIntent();
  if (!everLive) return <Skeleton className="h-24" />;
  if (!enc) {
    return (
      <div data-testid="cbt-init" className="flex flex-col items-center gap-2 py-6 text-center">
        <p data-testid="cbt-init-empty" className="text-sm text-muted-foreground">
          No encounter running — open Encounters
        </p>
        <Button size="sm" variant="outline" onClick={() => openWindow(ENCOUNTERS_KIND)}>
          Encounters
        </Button>
      </div>
    );
  }
  const active = rows.filter((c) => !c.removed);
  const removed = rows.filter((c) => c.removed);
  return (
    // Header + pending cards stay put; the rows scroll inside the window (glitch 3).
    <div
      data-testid="cbt-init"
      data-record-id={enc.id}
      className="flex h-full min-h-0 flex-col gap-2"
    >
      <Header enc={enc} rows={rows} />
      <PendingCards cards={cards} />
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <div
          aria-hidden
          className="sticky top-0 z-10 flex items-center gap-1 bg-card px-1 pb-0.5 text-[11px] text-muted-foreground"
        >
          <span className="flex-1 pl-[52px]">Combatant</span>
          <span className="w-[74px] text-center">Init</span>
          <span className="w-[60px]" />
        </div>
        <ul className="flex flex-col gap-0.5">
          {active.map((c) => (
            <Row
              key={c.id}
              c={c}
              def={c.entityId ? defs.get(c.entityId) : undefined}
              turn={enc.turnCombatantId === c.id}
              defs={defs}
            />
          ))}
        </ul>
        {removed.length > 0 && (
          <section aria-label="Removed" className="flex flex-col gap-1">
            <h3 className="text-xs font-medium text-muted-foreground">Removed</h3>
            {removed.map((c) => (
              <div
                key={c.id}
                data-testid="cbt-init-row"
                data-record-id={c.id}
                data-removed="true"
                className="flex items-center gap-2 px-1 text-sm text-muted-foreground"
              >
                <Portrait name={c.name} imageAssetId={c.imageAssetId} />
                <span className="flex-1 truncate">{c.name}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="cbt-init-row-restore"
                  data-record-id={c.id}
                  disabled={disabled}
                  onClick={() => void send("cbt.setRemoved", { combatantId: c.id, removed: false })}
                >
                  Restore
                </Button>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

/** Dialogs hosted while the window type is available (popup opens from cards and rows). */
function CombatDialogs() {
  return (
    <>
      <AttackPopup />
      <HpDialog />
    </>
  );
}

export const dmInitiativeWindow = defineWindow({
  ...initiativeWindowBase,
  clients: ["dm"],
  // CBT §7: right edge. DM right column, below `camp.players` (400×220); fitted to end above
  // the launcher (352 px high at 720, 532 at 900). 400 wide so AC / HP never wrap.
  defaultSize: { w: 400, h: 540 },
  minSize: { w: 320, h: 240 },
  defaultPosition: { anchor: "top-right", dy: 232 },
  companion: CombatDialogs,
  component: DmInitiativeBody,
});

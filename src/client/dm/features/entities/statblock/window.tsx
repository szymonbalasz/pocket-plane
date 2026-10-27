// Kit parity §6.11 (OQ-KIT-04 B): the DM-only stat-block window `ent.statblock`, the kit's "Goblin"
// card you can roll from (FR-KIT-100–107). One reused window (FR-KIT-102); the creature comes from
// its openers (`store.ts`): the Initiative row ⋯, the token menu / double-click, the compendium's
// "Open at the table". Same markup and slots as the compendium card (FR-KIT-77, `statblock-card`).
// Bound to a combatant of the running encounter, rolls go through combat's intents and the damage
// card opens in the DM popup; else plain `dice.roll`s as the creature (`logic.ts`). Data: the
// DM's definitions (snapshot / on-demand imported load) and, for traits and the type line, the
// compendium entry read on demand like the compendium window's. 0 B on the wire.

import { d20Expression } from "@shared/combat-tracker/rules";
import type { CombatantView } from "@shared/combat-tracker/schemas";
import type { EntryResponse } from "@shared/compendium/rest";
import type { BodyOf, FacetsOf, StatBlockSection } from "@shared/compendium/schemas";
import {
  type Ability,
  type Attack,
  checkBonus,
  type DefinitionRecord,
  saveBonus,
} from "@shared/entities/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { HpBar } from "@ui/components/kit/hp-bar";
import { Button } from "@ui/components/ui/button";
import { Badge } from "@ui/components/ui/primitives";
import { openSheetFor } from "@ui/features/character-sheet/selection";
import { CHAR_SHEET_KIND } from "@ui/features/character-sheet/window";
import { pendingToHitCard } from "@ui/features/combat-tracker/roll-route";
import { useCbtIntent } from "@ui/features/combat-tracker/store";
import { INITIATIVE_KIND } from "@ui/features/combat-tracker/window";
import { useDefinitions } from "@ui/features/compendium/definitions";
import { fetchEntry, readError } from "@ui/features/compendium/fetch";
import { CMP_KIND, entryForDefinition, signed } from "@ui/features/compendium/logic";
import { MarkdownLite } from "@ui/features/compendium/MarkdownLite";
import { openDefinition, openEntry } from "@ui/features/compendium/nav";
import { lazyApi, resolveApi, searchCompendium } from "@ui/features/compendium/search";
import {
  StatBlockAbilities,
  StatBlockCard,
  StatBlockCore,
  StatBlockEntry,
  StatBlockTypeLine,
  StatLabel,
} from "@ui/features/compendium/statblock-card";
import { RollButton, useRollControl } from "@ui/features/dice-roll-log/roll-control";
import { defineWindow } from "@ui/features/play-shell/registry";
import { useOpenWindow } from "@ui/features/play-shell/ShellContext";
import { useRecords, useSync } from "@ui/sync/store";
import { BookOpenIcon, ScrollTextIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  type AttackAction,
  attackChoices,
  attackRolls,
  attackSubjects,
  attackSummary,
} from "../../combat-tracker/attack-choices";
import { acOf, hpOf } from "../../combat-tracker/attack-popup";
import { useCombatDialogs } from "../../combat-tracker/popup-store";
import {
  type AbilityKind,
  ATTACK_BUTTONS,
  abilityLabel,
  abilitySend,
  attackSends,
  boundCombatant,
  EMPTY_TEXT,
  plainAttackRolls,
  type RollAs,
  type Send,
  STATBLOCK_KIND,
  typeLine,
} from "./logic";
import { useStatBlockTarget } from "./store";

const api = lazyApi(() => import("../../campaign-management/session").then((m) => m.api));

type EntryRead = { state: "none" } | { state: "ready"; data: EntryResponse } | { state: "error" };

/**
 * The definition's compendium entry (traits, actions, type line): the opener's entry, else for an
 * imported definition the one a monster search on its name links (FR-CMP-22's lookup); a custom
 * definition has none. Read on demand, never pushed.
 */
function useStatBlockEntry(def: DefinitionRecord | undefined, entryId: string | undefined) {
  const [read, setRead] = useState<{ key: string; read: EntryRead }>({
    key: "",
    read: { state: "none" },
  });
  const imported = def !== undefined && def.campaignId === null;
  const key = def ? `${def.id}:${entryId ?? ""}` : "";
  const name = def?.name ?? "";
  useEffect(() => {
    if (key === "" || (!entryId && !imported)) return;
    let live = true;
    (async () => {
      const a = await resolveApi(api);
      const id =
        entryId ??
        entryForDefinition(
          key.split(":")[0] as string,
          (await searchCompendium(api, { q: name, kind: "monster" })).results,
        );
      const data = id ? await fetchEntry(a, id) : null;
      if (live) setRead({ key, read: data ? { state: "ready", data } : { state: "none" } });
    })().catch((err: unknown) => {
      console.warn("stat block: entry read failed", readError(err));
      if (live) setRead({ key, read: { state: "error" } });
    });
    return () => {
      live = false;
    };
  }, [key, entryId, imported, name]);
  return read.key === key ? read.read : { state: "none" as const };
}

/** One intent after another (definition Attack + damage: to-hit, then damage). */
async function sendAll(
  send: (name: string, payload: unknown) => Promise<unknown>,
  sends: readonly Send[],
): Promise<unknown> {
  let last: unknown;
  for (const s of sends) {
    last = await send(s.name, s.payload);
    if (last === undefined) return undefined;
  }
  return last;
}

interface RollCtx {
  as: RollAs;
  send: ReturnType<typeof useCbtIntent>["send"];
  disabled: boolean;
}

/**
 * FR-KIT-105: one attack button through the shared roll control (Shift / Ctrl, Alt to stage,
 * physical dice, the DM public switch per category). Bound: combat's rolls and preview subjects,
 * a Damage after a natural 20 on this row's pending to-hit card opens critical (FR-CBT-74), the
 * card opens in the DM popup. Definition: plain rolls.
 */
function AttackRoll({
  ctx,
  attack,
  attackId,
  rowId,
  action,
  label,
  testId,
}: {
  ctx: RollCtx;
  attack: Attack;
  attackId: string | undefined;
  rowId: string | undefined;
  action: AttackAction;
  label: string;
  testId: string;
}) {
  const { as } = ctx;
  const notes = useRecords<NotificationRecord>("notification");
  const openCard = useCombatDialogs((s) => s.openCard);
  const openWindow = useOpenWindow();
  const bound = as.combatantId !== undefined;
  const rolls = attackRolls(attack, action);
  const card =
    as.combatantId !== undefined
      ? pendingToHitCard(notes, as.combatantId, rowId === undefined ? {} : { attackId: rowId })
      : null;
  const control = useRollControl({
    expressions: bound ? rolls.expressions : plainAttackRolls(attack, action),
    category: action === "damage" ? "damage" : "attack",
    label: `${as.name} — ${attack.name} ${action === "damage" ? "damage" : "attack"}`,
    ...(bound
      ? {
          critExpressions: rolls.critExpressions,
          slotLabels: rolls.slotLabels,
          crit: action === "damage" && card?.toHit?.natural === 20,
          subject: attackSubjects(
            as.combatantId as string,
            attack.name,
            action,
            card?.mode,
            rolls.extraParts,
          ),
        }
      : {}),
    onRoll: (r) => {
      void sendAll(ctx.send, attackSends(as, attack, attackId, action, r)).then((res) => {
        const cardId = (res as { cardId?: string } | null | undefined)?.cardId;
        if (!bound || !cardId) return;
        // The popup lives with the Initiative window (as the companion card's dialogs).
        openWindow(INITIATIVE_KIND, undefined, { by: "feature" });
        openCard(cardId);
      });
    },
  });
  return (
    <RollButton
      control={control}
      hint={bound ? "Combat roll · Shift: advantage · Ctrl: disadvantage" : undefined}
      type="button"
      size="sm"
      variant="outline"
      className="h-6 px-2 text-xs"
      data-testid={testId}
      data-record-id={rowId ?? ""}
      data-value={action}
      disabled={ctx.disabled}
    >
      {label}
    </RollButton>
  );
}

/** FR-KIT-106: an ability's Check (its modifier) or Save ("Save +n") button. */
function AbilityRoll({
  ctx,
  kind,
  ability,
  bonus,
  children,
}: {
  ctx: RollCtx;
  kind: AbilityKind;
  ability: Ability;
  bonus: number;
  children: ReactNode;
}) {
  const { as } = ctx;
  const control = useRollControl({
    expressions: [d20Expression(bonus)],
    category: kind === "check" ? "ability-check" : "saving-throw",
    label: abilityLabel(as.name, kind, ability),
    ...(as.combatantId !== undefined
      ? { subject: { creature: { combatantId: as.combatantId }, roll: kind, ability } }
      : {}),
    onRoll: (r) => void ctx.send(...sendArgs(abilitySend(as, kind, ability, bonus, r))),
  });
  return (
    <RollButton
      control={control}
      hint={`${kind === "check" ? "Check" : "Save"} · Shift: advantage · Ctrl: disadvantage`}
      type="button"
      size="sm"
      variant="ghost"
      // Compact (walkthrough F2): two attack rows with buttons fit 300 × 360; the Save labels are
      // a size smaller, so the six never touch (Simple Dark, step 8).
      className={
        kind === "check"
          ? "h-5 min-w-0 px-0.5 text-xs text-muted-foreground tabular-nums"
          : "h-4 min-w-0 px-0 text-[11px] leading-4 text-muted-foreground tabular-nums"
      }
      data-testid={`ent-statblock-roll-${kind}`}
      data-value={ability}
      disabled={ctx.disabled}
    >
      {children}
    </RollButton>
  );
}

const sendArgs = (s: Send) => [s.name, s.payload] as const;

/** FR-KIT-103: traits and other actions, collapsible, from the entry (the attacks have rows). */
function Sections({
  body,
  definitionId,
  attackNames,
}: {
  body: BodyOf<"monster">;
  definitionId: string;
  attackNames: ReadonlySet<string>;
}) {
  const groups: [string, readonly StatBlockSection[]][] = [
    ["Traits", body.traits],
    ["Actions", body.actions.filter((s) => !attackNames.has(s.name.toLowerCase()))],
    ["Bonus Actions", body.bonusActions],
    ["Reactions", body.reactions],
    ["Legendary Actions", body.legendary?.actions ?? []],
  ];
  return groups
    .filter(([, list]) => list.length > 0)
    .map(([title, list]) => (
      <details
        key={title}
        data-testid="ent-statblock-section"
        data-slot="statblock-section"
        data-value={title}
        className="group border-t pt-1"
      >
        <summary className="cursor-pointer text-sm font-semibold text-primary">
          <StatLabel>{title}</StatLabel>
        </summary>
        {list.map((s, i) => (
          <StatBlockEntry
            // biome-ignore lint/suspicious/noArrayIndexKey: sections are positional (names repeat)
            key={i}
            name={`${s.name}.`}
          >
            <MarkdownLite
              text={s.text}
              context={{ kind: "monster", definitionId, label: s.name }}
            />
          </StatBlockEntry>
        ))}
      </details>
    ));
}

/** A monster definition (campaign or imported): what the window shows. */
export type MonsterDefinition = Extract<DefinitionRecord, { kind: "monster" }>;

export interface StatBlockViewProps {
  def: MonsterDefinition;
  /** The bound combatant (FR-KIT-104), else null. */
  combatant: CombatantView | null;
  /** HP / AC as Initiative shows them for the bound combatant. */
  hp: { cur: number; max: number } | null;
  ac: number | null;
  entry: EntryResponse | null;
  ctx: RollCtx;
  footer: ReactNode;
}

/** FR-KIT-103: the card, kit "Goblin" (same markup and slots as FR-KIT-77). */
export function StatBlockView({ def, combatant, hp, ac, entry, ctx, footer }: StatBlockViewProps) {
  const sb = def.statBlock;
  const facets =
    entry?.entry.kind === "monster" ? (entry.entry.facets as FacetsOf<"monster">) : null;
  const body = entry?.entry.kind === "monster" ? (entry.entry.body as BodyOf<"monster">) : null;
  const meta = body?.meta ?? {};
  const bound = combatant !== null;
  const choices = attackChoices(sb.attacks);
  const attackNames = new Set(sb.attacks.map((a) => a.name.toLowerCase()));
  return (
    // §7.3 useful 300 × 360 (walkthrough F2): name, type line, core row, abilities and two attack
    // rows with their buttons fit; hence the tighter gaps, the inline modifiers, the small Save row.
    <StatBlockCard data-testid="ent-statblock" data-record-id={def.id} className="space-y-1">
      <header>
        <div className="flex items-center gap-2">
          <h2
            data-testid="ent-statblock-name"
            data-slot="statblock-name"
            className="min-w-0 flex-1 truncate text-lg font-semibold leading-tight text-primary"
          >
            {combatant?.name ?? def.name}
          </h2>
          {bound && (
            <Badge
              variant="outline"
              data-testid="ent-statblock-combat"
              data-record-id={combatant.id}
              className="shrink-0"
            >
              In combat
            </Badge>
          )}
        </div>
        {/* As available (orchestrator ruling, 2026-10-27): a fight's copy has no entry, so no
            subtype / alignment ("Small humanoid"); the compendium's adds them. */}
        <StatBlockTypeLine testId="ent-statblock-type">
          {typeLine({
            size: facets?.size ?? sb.size,
            type: facets?.type ?? sb.type ?? null,
            subtype: meta.subtype ?? null,
            alignment: meta.alignment ?? null,
          })}
        </StatBlockTypeLine>
      </header>
      <StatBlockCore
        testId="ent-statblock-core"
        ac={ac ?? sb.ac}
        acNote={bound ? undefined : meta.armorNote}
        hp={
          hp ? (
            <HpBar
              cur={hp.cur}
              max={hp.max}
              data-testid="ent-statblock-hp"
              className="min-w-24 flex-1"
            />
          ) : (
            <span data-testid="ent-statblock-hp">
              <span className="tabular-nums">{sb.hpMax}</span>
              {sb.hpFormula && <span className="text-muted-foreground"> ({sb.hpFormula})</span>}
            </span>
          )
        }
        speed={meta.speedText ?? (sb.speed !== undefined ? `${sb.speed} ft` : "—")}
      />
      {sb.abilities && (
        <StatBlockAbilities
          abilities={sb.abilities}
          testId="ent-statblock-abilities"
          cellTestId="ent-statblock-ability"
          inlineMod
          className="gap-x-1.5 gap-y-0 py-1"
          mod={(a, text) => (
            <AbilityRoll ctx={ctx} kind="check" ability={a} bonus={checkBonus(sb, a) ?? 0}>
              {checkBonus(sb, a) === null ? text : signed(checkBonus(sb, a) ?? 0)}
            </AbilityRoll>
          )}
          below={(a) => (
            <AbilityRoll ctx={ctx} kind="save" ability={a} bonus={saveBonus(sb, a) ?? 0}>
              Save {signed(saveBonus(sb, a) ?? 0)}
            </AbilityRoll>
          )}
        />
      )}
      {sb.attacks.map((attack, i) => {
        // Bound: only the rows `cbt.attack` can name (OQ-CHARX-12); one choice goes by no id.
        const choice = choices.find((c) => c.attack === attack);
        const rollable = !bound || choice !== undefined;
        const attackId = choices.length > 1 ? choice?.attackId : undefined;
        const rowId = attack.id ?? (i === 0 ? sb.attacks[0]?.id : undefined);
        return (
          <StatBlockEntry
            key={attack.id ?? `legacy-${i}`}
            slot="statblock-attack"
            data-testid="ent-statblock-attack"
            data-record-id={attack.id ?? ""}
            // The kit's `.atk` (orchestrator ruling, K7): the name, then the muted
            // "+4 · 1d6+2 slashing" line, then the buttons.
            name={attack.name}
            actionsClassName="mt-1"
            actions={
              rollable
                ? ATTACK_BUTTONS.map((b) => (
                    <AttackRoll
                      key={b.action}
                      ctx={ctx}
                      attack={attack}
                      attackId={attackId}
                      rowId={rowId}
                      action={b.action}
                      label={b.label}
                      testId={b.testId}
                    />
                  ))
                : undefined
            }
          >
            <span data-testid="ent-statblock-attack-line" className="text-xs tabular-nums">
              {attackSummary(attack)}
            </span>
          </StatBlockEntry>
        );
      })}
      {body && <Sections body={body} definitionId={def.id} attackNames={attackNames} />}
      {footer}
    </StatBlockCard>
  );
}

function Empty({ error }: { error?: string }) {
  return (
    <div data-testid="ent-statblock-empty" className="space-y-1 p-1 text-sm text-muted-foreground">
      <p>{EMPTY_TEXT}</p>
      {error && (
        <p data-testid="ent-statblock-error" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** FR-KIT-103 footer: Open NPC sheet (custom definitions) or Compendium entry (imported). */
function Footer({ def, entryId }: { def: DefinitionRecord; entryId: string | null }) {
  const openWindow = useOpenWindow();
  const custom = def.campaignId !== null;
  return (
    <footer className="flex justify-end border-t pt-1.5">
      {custom ? (
        <Button
          variant="link"
          size="sm"
          className="h-6 px-1 text-xs"
          data-testid="ent-statblock-sheet"
          onClick={() => {
            openSheetFor(def.id, "monster");
            openWindow(CHAR_SHEET_KIND);
          }}
        >
          <ScrollTextIcon className="size-3.5" /> Open NPC sheet
        </Button>
      ) : (
        <Button
          variant="link"
          size="sm"
          className="h-6 px-1 text-xs"
          data-testid="ent-statblock-compendium"
          onClick={() => {
            if (entryId) openEntry(entryId);
            else openDefinition(def.id);
            openWindow(CMP_KIND);
          }}
        >
          <BookOpenIcon className="size-3.5" /> Compendium entry
        </Button>
      )}
    </footer>
  );
}

function StatBlockBody() {
  const target = useStatBlockTarget((s) => s.target);
  const store = useSync((s) => s.store);
  const ids = useMemo(() => (target ? [target.definitionId] : []), [target]);
  const defs = useDefinitions(ids);
  const def = target ? defs.byId.get(target.definitionId) : undefined;
  const entry = useStatBlockEntry(def, target?.entryId);
  const { send, disabled } = useCbtIntent();
  const combatant = boundCombatant(store, target);
  // FR-KIT-104: HP lives from the store while bound (Initiative's figures).
  const hp = combatant && def ? hpOf(combatant, new Map([[def.id, def]])) : null;
  const ac = combatant && def ? (acOf(combatant, new Map([[def.id, def]])) ?? null) : null;
  if (!target) return <Empty />;
  if (!def) {
    if (defs.state === "error") return <Empty error="Couldn't load this creature." />;
    // Campaign rows come with the snapshot: absent once loaded = deleted.
    if (defs.state === "ready") return <Empty error="This creature no longer exists." />;
    return <p className="p-1 text-sm text-muted-foreground">Loading…</p>;
  }
  if (def.kind !== "monster") return <Empty error="Characters have a sheet, not a stat block." />;
  const as: RollAs = combatant
    ? { combatantId: combatant.id, name: combatant.name }
    : { definitionId: def.id, name: def.name };
  const data = entry.state === "ready" ? entry.data : null;
  return (
    <div className="h-full overflow-auto px-2 pt-1.5 pb-2">
      <StatBlockView
        def={def}
        combatant={combatant}
        hp={hp ? { cur: hp.cur, max: hp.max } : null}
        ac={ac}
        entry={data}
        ctx={{ as, send, disabled }}
        footer={<Footer def={def} entryId={data?.entry.id ?? target.entryId ?? null} />}
      />
    </div>
  );
}

/** FR-KIT-100: DM registry only; closed on reload; launcher "Stat block" after Creatures. */
export const statBlockWindow = defineWindow({
  kind: STATBLOCK_KIND,
  title: "Stat block",
  clients: ["dm"],
  // Kit-parity §7.3: 300 × 440 at all four sizes; useful 300 × 360 (opens at 360 high before
  // shrinking); min 280 × 240; top-left beside the rail, as the companion card.
  defaultSize: { w: 300, h: 440 },
  minSize: { w: 280, h: 240 },
  usefulSize: { w: 300, h: 360 },
  minOpenH: 360,
  defaultPosition: { anchor: "top-left", dx: 56 },
  defaultOpen: false,
  restoreOpen: false,
  launcher: { icon: ScrollTextIcon, label: "Stat block", order: 31 },
  component: StatBlockBody,
});

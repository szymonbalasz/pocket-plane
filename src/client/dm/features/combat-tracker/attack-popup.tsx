// Attack popup (FR-CBT-33): a non-modal panel (no overlay; the canvas stays usable). Shared
// to-hit / damage (editable), then one row per target: selection rows follow the DM's map
// selection (targeting on: click, Ctrl/Shift-click, box), added rows come from "Add target".
// Per row: hit vs AC (preset, toggle), multiplier, preview. Apply sends 1–20 targets in list
// order (FR-CBT-34); Later keeps the card pending; Dismiss closes it. Close → targeting off and
// the selection cleared (FR-CBT-54, every close: popup-store). Placement: FR-CBT-55/56, over its
// notification (FR-CBT-75); movable by its header (FR-CBT-76); its card's toast stays hidden.
// Partial cards (FR-CBT-72, N7): to-hit-only → "Waiting for damage" (the DM may type a total;
// the roll fills the cell when it attaches); damage-only → no to-hit cell or "vs AC", rows Hit.
// Popup parts (FR-MOD-39, ADR-0043): every `popupParts` line renders under each target row and
// merges its share into that row's apply entry. Effect modifiers tier 2 (FR-MOD-24, -25): Hit is
// preset vs the effective AC (AC cell with its parts) and the multiplier from the target's
// defenses against the card's damage type. Weapon damage parts (FR-CBT-82, FR-MOD-58; sprint 4):
// each extra part's total is editable beside the base part's, and every target row gets one chip
// per extra part with its own multiplier, preset from the target's defenses for that part's type.
// Sprint 7 (FR-CBT-130, -131): the card-action slot above the targets (gems' Combat gem) and a
// "max" Badge on maxed dice; a maxed card refreshes like a late roll (FR-CBT-132: typed kept).
// Kit parity K3 (FR-KIT-62–65): a window-style title bar whose gem is Later, "To hit" / "Damage,
// <type>" lines ending in Result-box-styled inputs, one compact line per target (Medallion + name ·
// AC chip, Hit, multiplier, preview; Remove on hover), footer Dismiss · card actions · Apply.

import { naturalMark } from "@shared/combat-tracker/log-kinds";
import { MULTIPLIER_LABEL, rawDamage } from "@shared/combat-tracker/rules";
import {
  APPLY_TARGETS_MAX,
  type CardPartRef,
  type CombatantView,
  CRIT_CHANGED_TEXT,
  critChanged,
  DamageCardPayload,
  type DamageMultiplier,
  HIT_RULING_TYPE,
  type HitRulingRecord,
  partRollIdsOf,
} from "@shared/combat-tracker/schemas";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { modSegments } from "@shared/effect-modifiers/line";
import type { DefinitionRecord } from "@shared/entities/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { Medallion } from "@ui/components/kit/medallion";
import type { ResultOutcome } from "@ui/components/kit/result-box";
import { Button } from "@ui/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  ToggleGroup,
  ToggleGroupItem,
} from "@ui/components/ui/controls";
import { Tooltip } from "@ui/components/ui/overlays";
import { Badge, Input, Label } from "@ui/components/ui/primitives";
import { CardActions, PartDice } from "@ui/features/combat-tracker/card-actions-row";
import { medallionColour } from "@ui/features/combat-tracker/parts";
import {
  toastIntentError,
  useCbtIntent,
  useCombatants,
  useStartedEncounter,
} from "@ui/features/combat-tracker/store";
import { useTargetingAttacker } from "@ui/features/combat-tracker/token-overlay";
import { hideToast } from "@ui/features/notifications/toasts";
import {
  EDGE_GAP,
  LAUNCHER_CLEAR,
  TOP_BAR_H,
  type Viewport,
} from "@ui/features/play-shell/geometry";
import { cn } from "@ui/lib/utils";
import { IntentRejected } from "@ui/sync/connection";
import { useRecords, useSync } from "@ui/sync/store";
import { EyeOffIcon, PlusIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LinkHintNote } from "../combat-extras/link-hint";
import {
  AcCell,
  presetMultiplier,
  rowFacts,
  useActiveEffects,
} from "../effect-modifiers/popup-facts";
import {
  getMapSelection,
  setMapSelection,
  setTargeting,
  useMapSelection,
} from "../scenes-map/selection";
import { useDefinitions } from "./data";
import {
  blurField,
  FIELD_EMPTY,
  type FieldDraft,
  fieldValue,
  focusField,
  isTyped,
  lateNote,
  popupStep,
  primaryAction,
  rolledHint,
  ruledRows,
  turnKey,
  typeField,
  unusedText,
} from "./late-fill";
import {
  type PopupRowView,
  partInputs,
  partPreviewExtra,
  partRejects,
  popupParts,
  type RejectIssue,
} from "./popup-parts";
import {
  clampIntoWorkArea,
  dragPopup,
  measurePlacement,
  type Placement,
  placementTiers,
} from "./popup-placement";
import {
  type CardDraft,
  emptyDraft,
  type PerTarget,
  type PopupOrigin,
  useCombatDialogs,
} from "./popup-store";
import {
  addAction,
  applyReady,
  cardShape,
  eligibleTargets,
  extraPartPresets,
  type HpTemp,
  naturalContradiction,
  previewText,
  rowPreset,
  targetList,
  totalOf,
  weaponRaw,
} from "./targets";

const MULTS: DamageMultiplier[] = ["normal", "half", "none", "double"];

/** FR-KIT-63: a result line: the label (with its small dice) left, the boxed value right. */
const CARD_LINE = "flex min-h-9 items-center gap-2";
/** FR-KIT-63: an input drawn as a Result box (`data-slot="kit-result"`, number centred, large). */
const RESULT_INPUT =
  "h-8 w-16 shrink-0 px-1 text-center text-xl font-semibold leading-none tabular-nums";
/**
 * FR-KIT-63: the Result box's outcome colours (meaning tokens, FR-THEME-09) on an input. K8 (K6
 * gap 7): the damage box keeps a neutral border, only its number is red (the kit's `.res.dmg`).
 */
const OUTCOME_INPUT: Partial<Record<CardOutcome, string>> = {
  crit: "border-hp-full/60 text-hp-full",
  fumble: "text-muted-foreground",
  damage: "text-destructive",
  // K12 (round-2 gap 8): the kit's green to-hit once it hits; the border stays neutral (as damage).
  hit: "text-hp-full",
};
/** FR-KIT-63 (K8): a result line's label in body type, not label type (`card-label`). */
const CARD_LABEL = "min-w-0 flex-1 flex-wrap text-sm font-normal";
/** FR-KIT-64: Remove shows on the row's hover / focus, always without hover (FR-KIT-03). */
const ROW_HOVER =
  "opacity-0 transition-opacity focus-visible:opacity-100 group-hover/target:opacity-100 group-focus-within/target:opacity-100 [@media(hover:none)]:opacity-100";
/** K8 (K6 gap 7): Remove's slot takes no room until then, so the target row stays one line. */
const ROW_HOVER_SLOT =
  "flex w-0 shrink-0 overflow-hidden group-hover/target:w-6 group-focus-within/target:w-6 [@media(hover:none)]:w-6";
const MODE_SHORT = { advantage: "adv", disadvantage: "dis" } as const;

/**
 * K8 (K6 gap 7): the kit's "Apply 16": the card's damage (base + extra parts, as shown) while a
 * row is a Hit; plain "Apply" with no damage yet or every row a Miss. Per-target multipliers and
 * popup parts stay in each row's preview (OQ-KIT-11 A).
 */
export function applyLabel(
  damage: number | null,
  extra: readonly number[],
  hits: readonly boolean[],
): string {
  if (damage === null || !hits.some(Boolean)) return "Apply";
  return `Apply ${extra.reduce((n, x) => n + x, damage)}`;
}

/** FR-KIT-63: the to-hit box's outcome: natural 20 → crit, natural 1 → fumble, else plain. */
export const toHitOutcome = (natural: number | null): ResultOutcome =>
  natural === 20 ? "crit" : natural === 1 ? "fumble" : "plain";

/** K12: the card's box outcomes: the Result box's plus `hit` (a to-hit every target row hits). */
export type CardOutcome = ResultOutcome | "hit";

/**
 * K12 (round-2 gap 8): the to-hit box on the card: FR-KIT-63's natural outcome, else `hit` while
 * there is a target row and every one is a Hit (the kit's green 29), else plain.
 */
export function cardToHitOutcome(natural: number | null, hits: readonly boolean[]): CardOutcome {
  const o = toHitOutcome(natural);
  return o === "plain" && hits.length > 0 && hits.every(Boolean) ? "hit" : o;
}

/**
 * Current / max / temp HP the DM sees: monsters on the combatant, PCs on the character (temp HP:
 * CBTX play state, FR-CBT-78).
 */
export function hpOf(c: CombatantView, defs: Map<string, DefinitionRecord>): HpTemp | null {
  if (c.kind === "monster") {
    return c.hpCurrent != null && c.hpMax != null
      ? { cur: c.hpCurrent, max: c.hpMax, temp: c.tempHp ?? 0 }
      : null;
  }
  const d = c.entityId ? defs.get(c.entityId) : undefined;
  return d?.kind === "character"
    ? { cur: d.hpCurrent, max: d.statBlock.hpMax, temp: d.tempHp }
    : null;
}

export const acOf = (c: CombatantView, defs: Map<string, DefinitionRecord>) =>
  c.entityId ? (defs.get(c.entityId)?.statBlock.ac ?? null) : null;

function Dice({ dice }: { dice: readonly (readonly [number | null, boolean])[] }) {
  return (
    <span className="font-mono text-xs text-muted-foreground">
      [
      {dice.map(([v, kept], i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: dice positions are stable
        <span key={i} className={kept ? "" : "line-through opacity-60"}>
          {i > 0 ? " " : ""}
          {v ?? "?"}
        </span>
      ))}
      ]
    </span>
  );
}

/** FR-CBT-131 (sprint 7): a damage part's dice; maxed ones carry a "max" Badge. */
function DamageDice({
  part,
  dice,
  maxed,
}: {
  part: CardPartRef;
  dice: readonly (readonly [number | null, boolean])[];
  maxed: readonly number[] | undefined;
}) {
  return maxed ? <PartDice part={part} dice={dice} maxed={maxed} /> : <Dice dice={dice} />;
}

/** The chip's gap (`gap-1.5`) and the target line's, px. */
const CHIP_GAP = 6;

/**
 * K12 re-test (walkthrough 4): "Name · AC n" in a target row. The name takes the line's free
 * width: when it would truncate, the " · AC n" part steps aside (`data-ac-folded`; still in the
 * DOM) and comes back once the line has room for it again
 * (measured from the line's slack, so it never flips back and forth); only a name longer than
 * that truncates. Folded, the chip's Tooltip reads "Name · AC n".
 */
function TargetChip({ name, tip, children }: { name: string; tip: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const acWidth = useRef(0);
  const [folded, setFolded] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure for a new name, and re-attach once the Tooltip wraps or unwraps the chip
  useLayoutEffect(() => {
    const chip = ref.current;
    const line = chip?.parentElement;
    if (!chip || !line) return;
    const measure = () => {
      const nameEl = chip.querySelector<HTMLElement>("[data-target-name]");
      const ac = chip.querySelector<HTMLElement>("[data-target-ac]");
      if (!nameEl || !ac || line.clientWidth === 0) return;
      setFolded((was) => {
        if (!was) {
          acWidth.current = ac.offsetWidth;
          return nameEl.scrollWidth > nameEl.clientWidth + 0.5;
        }
        const kids = [...line.children].filter((k): k is HTMLElement => k instanceof HTMLElement);
        const used = kids.reduce((a, k) => a + k.offsetWidth, 0) + CHIP_GAP * (kids.length - 1);
        const need = nameEl.scrollWidth - nameEl.clientWidth + acWidth.current + CHIP_GAP;
        return line.clientWidth - used < need;
      });
    };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(line);
    ro?.observe(chip);
    return () => ro?.disconnect();
  }, [name, folded]);
  const chip = (
    <span
      ref={ref}
      data-slot="card-target-chip"
      data-ac-folded={folded || undefined}
      className="inline-flex min-w-0 items-center gap-1.5 rounded-full border py-0.5 pr-2 pl-0.5 data-[ac-folded]:[&_[data-target-ac]]:hidden"
    >
      {children}
    </span>
  );
  return folded ? <Tooltip content={tip}>{chip}</Tooltip> : chip;
}

/** "Add target" Combobox over every eligible combatant not yet in the list (incl. hidden). */
function AddTarget({
  options,
  onPick,
  disabled,
  collapsed,
}: {
  options: CombatantView[];
  onPick(c: CombatantView): void;
  disabled: boolean;
  /**
   * K12 (round-2 gap 8): the card has a target, so the field hides behind a small "+" (which takes
   * `cbt-popup-target-add`: a click opens the field with its list, as a click on the field did).
   */
  collapsed: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const shown = options.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const close = () => {
    setQ("");
    setOpen(false);
    setExpanded(false);
  };
  const pick = (c: CombatantView) => {
    onPick(c);
    close();
  };
  if (collapsed && !expanded) {
    return (
      <Tooltip content="Add target">
        <Button
          size="icon"
          variant="ghost"
          className="size-6 self-start"
          data-testid="cbt-popup-target-add"
          aria-label="Add target"
          disabled={disabled}
          onClick={() => {
            setExpanded(true);
            setOpen(true);
          }}
        >
          <PlusIcon className="size-3.5" />
        </Button>
      </Tooltip>
    );
  }
  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(o) => {
        // Closed (outside click, focus away, Esc): the "+" again while the card has a target.
        if (o) setOpen(true);
        else close();
      }}
    >
      <PopoverAnchor asChild>
        <Input
          // Opened from the "+": the field takes the focus for typing.
          autoFocus={collapsed}
          data-testid="cbt-popup-target-add"
          role="combobox"
          aria-expanded={open}
          aria-label="Add target"
          placeholder="Add target…"
          className="h-8"
          disabled={disabled}
          value={q}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && shown[0]) pick(shown[0]);
            if (e.key === "Escape" && open) {
              e.stopPropagation();
              close();
            }
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="max-h-56 w-[var(--radix-popover-trigger-width)] overflow-auto p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {shown.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">No combatant matches</p>
        ) : (
          <ul>
            {shown.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  data-testid="cbt-popup-target-option"
                  data-value={c.id}
                  className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => pick(c)}
                >
                  <span className="truncate">{c.name}</span>
                  {c.hidden && <EyeOffIcon className="size-3.5 text-muted-foreground" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** FR-CBT-82: one extra part's multiplier chip under a target row ("fire" + Half (Fire Ward)). */
function PartChip({
  targetId,
  index,
  type,
  value,
  hint,
  onChange,
}: {
  targetId: string;
  index: number;
  type: string;
  value: DamageMultiplier;
  hint: string | null;
  onChange(m: DamageMultiplier): void;
}) {
  return (
    <div
      data-testid="cbt-popup-target-part"
      data-record-id={targetId}
      data-value={index}
      className="flex flex-wrap items-center gap-1.5 rounded-md border border-dashed px-1.5 py-0.5 text-xs"
    >
      <span className="font-medium">{type}</span>
      <ToggleGroup
        type="single"
        data-testid="cbt-popup-target-part-mult"
        data-record-id={targetId}
        data-value={value}
        value={value}
        onValueChange={(v) => v && onChange(v as DamageMultiplier)}
      >
        {MULTS.map((m) => (
          <ToggleGroupItem
            key={m}
            value={m}
            className="h-5 px-1 text-xs"
            data-testid="cbt-popup-target-part-mult-option"
            data-value={m}
          >
            {MULTIPLIER_LABEL[m]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {hint && (
        <span
          data-testid="mod-popup-part-defense"
          data-value={index}
          className="text-caution-foreground"
        >
          {hint}
        </span>
      )}
    </div>
  );
}

const NO_DRAFT = emptyDraft();

/**
 * FR-CBT-90: one damage total that a late roll fills (base or an extra part): the DM's text once
 * typed, else the roll; focused, it never fills ("rolled N" beside it) and fills on blur if empty.
 */
function DamageField({
  id,
  testId,
  part,
  value,
  rolled,
  className,
  placeholder,
  onEdit,
}: {
  id: string;
  testId: string;
  part: number | "base";
  value: FieldDraft | undefined;
  rolled: number | null | undefined;
  className?: string;
  placeholder?: string;
  onEdit(next: FieldDraft): void;
}) {
  const hint = rolledHint(value, rolled);
  return (
    <>
      <Input
        id={id}
        data-testid={testId}
        {...(part === "base" ? {} : { "data-value": part })}
        data-typed={isTyped(value) ? "true" : undefined}
        data-slot="kit-result"
        data-outcome="damage"
        inputMode="numeric"
        className={cn(RESULT_INPUT, OUTCOME_INPUT.damage, className)}
        placeholder={placeholder}
        value={fieldValue(value, rolled)}
        onFocus={() => onEdit(focusField(value, rolled))}
        onChange={(e) => onEdit(typeField(e.target.value))}
        onBlur={() => onEdit(blurField(value))}
      />
      {hint !== null && (
        <span
          data-testid="cbt-popup-rolled-hint"
          data-value={part}
          className="shrink-0 text-xs font-normal text-muted-foreground"
        >
          rolled {hint}
        </span>
      )}
    </>
  );
}

export function PopupBody({ card, close }: { card: NotificationRecord; close(): void }) {
  const payload = useMemo(() => DamageCardPayload.safeParse(card.payload), [card.payload]);
  const p = payload.success ? payload.data : null;
  const defs = useDefinitions();
  const combatants = useCombatants(p?.encounterId);
  const tokens = useRecords<{ id: string; sceneId: string }>(TOKEN_TYPE);
  const rulings = useRecords<HitRulingRecord>(HIT_RULING_TYPE);
  const encounter = useStartedEncounter();
  const selection = useMapSelection();
  const store = useSync((s) => s.store);
  // FR-CBT-90: the DM's edits live per card in popup-store (kept across Later, another card, a
  // reconnect; lost on reload). Untouched fields follow the card, so a late roll fills them.
  const draft = useCombatDialogs((s) => s.drafts[card.id]) ?? NO_DRAFT;
  const editDraft = useCombatDialogs((s) => s.editDraft);
  const dropDraft = useCombatDialogs((s) => s.dropDraft);
  const thawDraft = useCombatDialogs((s) => s.thawDraft);
  const sawResolved = useCombatDialogs((s) => s.sawResolved);
  const resolvedCards = useCombatDialogs((s) => s.resolved);
  const edit = (patch: (d: CardDraft) => Partial<CardDraft>) => editDraft(card.id, patch);
  const effects = useActiveEffects();
  const { send, disabled: sending } = useCbtIntent();
  // Apply goes through the connection itself so popup parts see its reject (R7, `onReject`).
  const connection = useSync((s) => s.connection);
  const [applying, setApplying] = useState(false);
  const disabled = sending || applying;
  const attackerId = p?.attackerId ?? null;

  // FR-CBT-33: targeting while open; the attacker never gets a target ring.
  useEffect(() => {
    useTargetingAttacker.setState({ attackerId });
    setTargeting(true);
    return () => {
      setTargeting(false);
      useTargetingAttacker.setState({ attackerId: null });
    };
  }, [attackerId]);
  // FR-CBT-90: closing with a field focused (no blur) leaves it following its roll.
  useEffect(() => () => thawDraft(card.id), [card.id, thawDraft]);

  if (!p) return <p className="text-sm text-destructive">Unreadable card</p>;

  // FR-CBT-89: the damage step iff the card has a hit ruling (also after a reload or restart).
  const ruling = rulings.find((r) => r.cardId === card.id) ?? null;
  const step = popupStep(ruling);
  const ruled = ruling ? ruledRows(ruling, draft.dropped) : [];
  const list = ruling
    ? {
        rows: ruled.flatMap((r) => {
          const c = combatants.find((x) => x.id === r.targetId);
          return c ? [{ c, source: "ruled" as const }] : [];
        }),
        notInCombat: 0,
        tooMany: false,
      }
    : targetList({
        combatants,
        encounterId: p.encounterId,
        attackerId: p.attackerId,
        selectedTokenIds: selection.tokenIds,
        added: draft.added,
      });
  const inList = new Set(list.rows.map((r) => r.c.id));
  const addable = eligibleTargets(combatants, p.encounterId, p.attackerId).filter(
    (c) => !inList.has(c.id),
  );
  const shape = cardShape(p);
  const toHit = fieldValue(draft.toHit, p.toHit?.total);
  const damage = fieldValue(draft.damage, p.damage?.total);
  const toHitTotal = ruling?.toHitTotal ?? totalOf(toHit) ?? p.toHit?.total ?? 0;
  const rolledNatural = p.toHit?.natural ?? null;
  const natural = naturalMark(rolledNatural);
  // K8 (K6 gap 7): the to-hit line's label, the kit's "Mira · Longbow attack".
  const attackLabel = (
    <span>
      <strong className="font-semibold">{p.attackerName}</strong> · {p.attackName} attack
    </span>
  );
  // An empty / non-number cell falls back to the roll; none yet → null (FR-CBT-72).
  const damageTotal = totalOf(damage) ?? p.damage?.total ?? null;
  // FR-CBT-82: each extra part's total (an empty / non-number cell falls back to the roll).
  const extraParts = p.damage?.extra ?? [];
  const extraTotals = extraParts.map(
    (x, i) => totalOf(fieldValue(draft.extra[i], x.total)) ?? x.total,
  );
  const base = list.rows.map(({ c, source }) => {
    const ac = acOf(c, defs);
    // FR-MOD-24, -25: Hit vs the effective AC; the multiplier preset from the target's defenses
    // (FR-CBT-89: in the damage step, the ruling's).
    const facts = rowFacts(effects, c, ac, p.damageType);
    const preset = ruling
      ? true
      : rowPreset(shape, rolledNatural, toHitTotal, facts.ac?.value ?? ac);
    const ruledMult = ruled.find((r) => r.targetId === c.id)?.multiplier;
    const st = draft.per[c.id] ?? { hit: null, mult: ruledMult ?? presetMultiplier(facts) };
    // FR-CBT-89: a ruled hit stays a Hit (✕ drops it).
    const hit = ruling ? true : (st.hit ?? preset);
    // FR-MOD-58: each extra part preset from the target's defenses for its own type.
    const target = { id: c.id, kind: c.kind, entityId: c.entityId ?? null };
    const presets = extraPartPresets(
      effects,
      target,
      extraParts.map((x) => x.type),
    );
    const extraMults = presets.map((pr, i) => st.extra?.[i] ?? pr.multiplier);
    const parts = extraTotals.map((total, i) => ({
      total,
      multiplier: extraMults[i] as DamageMultiplier,
    }));
    const raw =
      damageTotal === null
        ? null
        : parts.length
          ? weaponRaw(hit, damageTotal, st.mult, parts)
          : rawDamage(hit, damageTotal, st.mult);
    const hp = hpOf(c, defs);
    const contra = ruling ? null : naturalContradiction(rolledNatural, hit);
    return {
      c,
      source,
      ac,
      facts,
      preset,
      hit,
      mult: st.mult,
      raw,
      hp,
      contra,
      presets,
      extraMults,
    };
  });
  const views: PopupRowView[] = base.map((x) => ({
    targetId: x.c.id,
    combatant: x.c,
    hit: x.hit,
    multiplier: x.mult,
    ac: x.ac,
    hp: x.hp,
  }));
  // FR-MOD-39: a line's parts on a Hit row join its preview (the server decides at apply).
  // FR-MOD-63: in the damage step the first Hit row is the first ruled hit still listed.
  const rows = base.map((x, i) => {
    const view = views[i] as PopupRowView;
    const extra = x.hit ? partPreviewExtra(popupParts, draft.parts, view, views, p) : 0;
    return { ...x, view, raw: x.raw === null ? null : x.raw + extra };
  });
  const toHitBox = cardToHitOutcome(
    rolledNatural,
    rows.map((x) => x.hit),
  );
  const ready = applyReady(
    rows.map((x) => x.hit),
    damageTotal,
    list.tooMany,
  );
  // FR-CBT-87: "Apply hit" while a Hit row waits for damage and no total is typed.
  const action = primaryAction({
    step,
    card: p,
    hits: rows.map((x) => x.hit),
    typedTotal: totalOf(damage) !== null,
  });
  const turn = encounter ? turnKey(encounter) : null;
  const note = lateNote({ seq: card.seq, p }, resolvedCards, turn);
  const unused = unusedText(p);
  const setRow = (id: string, patch: Partial<PerTarget>) => {
    const mult = rows.find((x) => x.c.id === id)?.mult ?? "normal";
    edit((d) => ({
      per: { ...d.per, [id]: { ...(d.per[id] ?? { hit: null, mult }), ...patch } },
    }));
  };
  const remove = (c: CombatantView) => {
    if (ruling) {
      // FR-CBT-89: ✕ drops a ruled hit (it resolves `dropped` at Apply).
      edit((d) => ({ dropped: [...d.dropped, c.id] }));
      return;
    }
    edit((d) => ({ added: d.added.filter((id) => id !== c.id) }));
    if (c.tokenId && selection.tokenIds.includes(c.tokenId)) {
      setMapSelection(selection.tokenIds.filter((t) => t !== c.tokenId));
    }
  };
  const add = (c: CombatantView) => {
    const sceneOf = (tokenId: string) => tokens.find((t) => t.id === tokenId)?.sceneId ?? null;
    const a = addAction(c, sceneOf, selection.sceneId);
    if ("select" in a) setMapSelection([...selection.tokenIds, a.select]);
    else edit((d) => ({ added: [...d.added, a.add] }));
  };

  const applyHit = async () => {
    if (disabled || list.tooMany || rows.length === 0) return;
    setApplying(true);
    try {
      // FR-CBT-88: the hit lines now; the popup stays open and its ruling makes the damage step.
      await connection.sendIntent("cbt.applyHit", {
        cardId: card.id,
        toHitTotal,
        // FR-CBT-129: the to-hit this popup shows; a reroll since → conflict, and the popup fills.
        partRollIds: partRollIdsOf(p),
        targets: rows.map((x) => ({ targetId: x.c.id, hit: x.hit, multiplier: x.mult })),
      });
    } catch (err) {
      toastIntentError(err);
    } finally {
      setApplying(false);
    }
  };
  const apply = async () => {
    if (!ready || disabled) return;
    setApplying(true);
    try {
      // FR-CBT-72: a to-hit total iff the card has a to-hit roll (FR-CBT-91: a ruled card takes
      // the ruling's); no damage total on an all-miss to-hit-only card.
      await connection.sendIntent("cbt.applyCard", {
        cardId: card.id,
        ...(p.toHit && !ruling ? { toHitTotal } : {}),
        ...(damageTotal !== null ? { damageTotal } : {}),
        // FR-CBT-94: the damage this popup shows; a newer one → conflict, and the popup fills.
        damageRollId: p.damage?.rollId ?? null,
        partRollIds: partRollIdsOf(p),
        // FR-CBT-82: the extra parts' values and each row's part multipliers, card order.
        ...(extraTotals.length ? { extraTotals } : {}),
        targets: rows.map((x) => ({
          ...partInputs(popupParts, draft.parts, x.view, views, p),
          targetId: x.c.id,
          hit: x.hit,
          multiplier: x.mult,
          ...(x.extraMults.length ? { extraMultipliers: x.extraMults } : {}),
        })),
      });
      // FR-CBT-93 (b): this client saw it resolved this turn (the late note's memory).
      if (turn !== null) {
        sawResolved({
          cardId: card.id,
          seq: card.seq,
          encounterId: p.encounterId,
          attackerId: p.attackerId,
          attackerName: p.attackerName,
          attackName: p.attackName,
          ...(p.attackId !== undefined ? { attackId: p.attackId } : {}),
          ...(p.spellId !== undefined ? { spellId: p.spellId } : {}),
          turn,
        });
      }
      dropDraft(card.id);
      // FR-CBT-54: closing clears the map selection (popup-store).
      close();
    } catch (err) {
      // A reject keeps the popup open; lines may mark what it names (FR-MOD-40: Force).
      toastIntentError(err);
      if (err instanceof IntentRejected) {
        const issues = (err.issues ?? []) as RejectIssue[];
        edit((d) => ({ parts: { ...partRejects(popupParts, d.parts, issues) } }));
      }
    } finally {
      setApplying(false);
    }
  };
  const dismiss = async () => {
    const r = await send("note.dismiss", { id: card.id });
    if (r !== undefined) {
      dropDraft(card.id);
      close();
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* FR-CBT-76: the header drags the popup (handled by the panel). FR-KIT-62: a window title
          bar; its gem is Later (keeps the card pending), so the footer has no Later. */}
      <div
        data-testid="cbt-popup-drag"
        data-slot="card-bar"
        className="-mx-3 -mt-3 flex h-8 shrink-0 cursor-move select-none items-center gap-1.5 border-b bg-muted/40 pr-1 pl-3"
      >
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {p.attackerName} — {p.attackName}
        </h2>
        {/* FR-CBT-89: the step marker sits beside the heading (the heading stays the name). */}
        {ruling ? (
          <Badge
            variant="secondary"
            data-testid="cbt-popup-step"
            data-value={step}
            className="shrink-0"
          >
            Hit applied
          </Badge>
        ) : (
          // A damage-only card has no to-hit (§7): its header says what it shows.
          <span data-testid="cbt-popup-step" data-value={step} className="sr-only">
            {shape === "damage" ? "Damage only, no to-hit" : "To-hit step"}
          </span>
        )}
        <Tooltip content="Later: keep the card pending">
          <button
            type="button"
            data-testid="cbt-popup-later"
            aria-label="Later"
            className="shrink-0 rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={close}
          >
            <XIcon className="size-3.5" />
          </button>
        </Tooltip>
      </div>
      {/* K8 (K6 gap 7): no summary line under the bar (the card's text repeats the lines below;
          its mode reads "adv" / "dis" after the to-hit dice). FR-KIT-63: result lines, each
          ending in a boxed value; the to-hit line names "Mira · Shortsword attack" as the kit. */}
      <div className="flex flex-col">
        {p.toHit && ruling && (
          // FR-CBT-89: the ruled to-hit, read-only.
          <div data-slot="card-line" className={CARD_LINE}>
            <span
              data-slot="card-label"
              className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-sm"
            >
              {attackLabel}
              {natural !== null && (
                <span data-testid="cbt-popup-natural" data-value={natural} className="text-xs">
                  natural {natural}
                </span>
              )}
            </span>
            <span data-testid="cbt-popup-tohit-ruled" className="text-sm tabular-nums">
              {ruling.toHitTotal} · hit applied
            </span>
          </div>
        )}
        {p.toHit && !ruling && (
          <div data-slot="card-line" className={CARD_LINE}>
            <Label htmlFor="cbt-popup-tohit" data-slot="card-label" className={CARD_LABEL}>
              {attackLabel} <Dice dice={p.toHit.dice} /> {p.toHit.constant >= 0 ? "+" : "−"}
              {Math.abs(p.toHit.constant)}
              {p.mode !== "normal" && (
                <span data-testid="cbt-popup-mode" data-value={p.mode} className="text-xs">
                  {" "}
                  {MODE_SHORT[p.mode]}
                </span>
              )}
              {/* effect-modifiers (FR-MOD-20): the card's parts, already in its total. */}
              {p.toHit.mods && lineText(modSegments(p.toHit.mods))}
              {natural !== null && (
                // FR-CBT-57 (R4): `hp.down` for a natural 1, `hp.full` for a natural 20.
                <Badge
                  variant="outline"
                  data-testid="cbt-popup-natural"
                  data-value={natural}
                  className={
                    natural === 1
                      ? "border-hp-down/50 text-hp-down"
                      : "border-hp-full/40 text-hp-full"
                  }
                >
                  natural {natural}
                </Badge>
              )}
              {toHitTotal !== p.toHit.total && <Badge variant="secondary">edited</Badge>}
            </Label>
            <Input
              id="cbt-popup-tohit"
              data-testid="cbt-popup-tohit"
              data-slot="kit-result"
              data-outcome={toHitBox}
              inputMode="numeric"
              className={cn(RESULT_INPUT, OUTCOME_INPUT[toHitBox])}
              value={toHit}
              onChange={(e) => edit(() => ({ toHit: typeField(e.target.value) }))}
            />
          </div>
        )}
        <div data-slot="card-line" className={CARD_LINE}>
          <Label htmlFor="cbt-popup-damage" data-slot="card-label" className={CARD_LABEL}>
            Damage{p.damageType ? `, ${p.damageType}` : ""}{" "}
            {p.damage ? (
              <>
                <DamageDice part="base" dice={p.damage.dice} maxed={p.damage.maxed} />{" "}
                {p.damage.constant >= 0 ? "+" : "−"}
                {Math.abs(p.damage.constant)}
                {p.damage.mods && lineText(modSegments(p.damage.mods))}
              </>
            ) : ruling ? (
              // FR-CBT-89 (§7): muted, a slow pulse, no spinner, until the roll attaches.
              <span
                data-testid="cbt-popup-waiting"
                className="animate-pulse font-normal text-muted-foreground [animation-duration:2.5s]"
              >
                Waiting for damage
              </span>
            ) : critChanged(p) ? (
              // FR-CBT-127 (sprint 7): a reroll flipped the crit; the old damage is "not used".
              <span data-testid="cbt-popup-crit-changed" className="font-normal text-warning">
                {CRIT_CHANGED_TEXT}
              </span>
            ) : (
              <span
                data-testid="cbt-popup-waiting-damage"
                className="font-normal text-muted-foreground"
              >
                Waiting for damage
              </span>
            )}
            {extraParts.length > 0 && (
              // FR-CBT-82: "15 slashing + 8 fire".
              <span className="font-normal text-muted-foreground">
                {extraParts.map((x, i) => ` + ${extraTotals[i]} ${x.type}`).join("")}
              </span>
            )}
            {p.damage && damageTotal !== p.damage.total && isTyped(draft.damage) && (
              <Badge variant="secondary">edited</Badge>
            )}
          </Label>
          <div className="flex shrink-0 items-center gap-1.5">
            <DamageField
              id="cbt-popup-damage"
              testId="cbt-popup-damage"
              part="base"
              value={draft.damage}
              rolled={p.damage?.total}
              placeholder={p.damage ? undefined : "Total"}
              onEdit={(next) => edit(() => ({ damage: next }))}
            />
          </div>
        </div>
        {extraParts.map((x, i) => (
          // FR-CBT-82: each extra part's total, editable like the base part's.
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are the card's, in order
          <div key={i} data-slot="card-line" className={CARD_LINE}>
            <Label
              htmlFor={`cbt-popup-damage-part-${i + 1}`}
              data-slot="card-label"
              className={CARD_LABEL}
            >
              + {x.type}
              {/* FR-CBT-131: a maxed extra part shows its dice with the "max" Badge. */}
              {x.maxed && <DamageDice part={i} dice={x.dice} maxed={x.maxed} />}
            </Label>
            <div className="flex shrink-0 items-center gap-1.5">
              <DamageField
                id={`cbt-popup-damage-part-${i + 1}`}
                testId="cbt-popup-damage-part"
                part={i + 1}
                value={draft.extra[i]}
                rolled={x.total}
                className="h-7 w-14 text-base"
                onEdit={(next) =>
                  edit((d) => {
                    const extra = [...d.extra];
                    for (let j = extra.length; j < i; j++) extra[j] = FIELD_EMPTY;
                    extra[i] = next;
                    return { extra };
                  })
                }
              />
            </div>
          </div>
        ))}
        {unused && (
          // FR-CBT-92: the owner's later rolls, not used.
          <p data-testid="cbt-popup-unused" className="text-xs text-muted-foreground">
            {unused}
          </p>
        )}
        {p.saveDc && (
          <p className="text-xs text-muted-foreground">
            DC {p.saveDc.dc} {p.saveDc.ability.toUpperCase()} · Half on a successful save
          </p>
        )}
      </div>
      <section aria-label="Targets" className="flex min-h-0 flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-medium text-muted-foreground">Targets ({rows.length})</h3>
          {list.notInCombat > 0 && (
            <span data-testid="cbt-popup-not-in-combat" className="text-xs text-muted-foreground">
              {list.notInCombat} selected not in combat <LinkHintNote />
            </span>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {ruling
              ? "Every ruled hit dropped: Dismiss the card."
              : "Select tokens on the map (Ctrl / Shift to add, drag a box) or add a target."}
          </p>
        ) : (
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {rows.map((x) => (
              <li
                key={x.c.id}
                data-testid="cbt-popup-target-row"
                data-record-id={x.c.id}
                data-source={x.source}
                data-slot="card-target"
                className="group/target flex flex-col gap-1 rounded-md border px-1.5 py-1"
              >
                {/* FR-KIT-64: one compact line; K8 (K6 gap 7): it never wraps, a long name
                    truncates in its chip. */}
                <div className="flex items-center gap-1.5 text-sm">
                  <TargetChip
                    name={x.c.name}
                    tip={`${x.c.name} · AC ${x.facts.ac?.value ?? x.ac ?? "—"}`}
                  >
                    <Medallion
                      name={x.c.name}
                      imageAssetId={x.c.imageAssetId}
                      colour={medallionColour(store, x.c)}
                      size="sm"
                    />
                    <span
                      data-target-name
                      className="min-w-0 truncate font-medium"
                      title={x.c.name}
                    >
                      {x.c.name}
                    </span>
                    {x.c.hidden && (
                      <EyeOffIcon
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-label="Hidden"
                      />
                    )}
                    {/* K8 (K6 gap 7): the kit's "Goblin · AC 15", on every card (the Hit toggle
                        beside it says the comparison; FR-CBT-72's damage-only text). K12
                        re-test: it steps aside (TargetChip) before the name truncates. */}
                    <span data-target-ac className="flex shrink-0 items-center gap-1.5">
                      <span aria-hidden className="text-muted-foreground">
                        ·
                      </span>
                      <AcCell combatantId={x.c.id} facts={x.facts} damageOnly />
                    </span>
                  </TargetChip>
                  {!ruling && (
                    <Button
                      size="sm"
                      variant={x.hit ? "default" : "outline"}
                      className="h-6 shrink-0 px-1.5 text-xs"
                      data-testid="cbt-popup-target-hit"
                      data-record-id={x.c.id}
                      data-value={x.hit ? "hit" : "miss"}
                      aria-pressed={x.hit}
                      onClick={() => setRow(x.c.id, { hit: !x.hit })}
                    >
                      {x.hit ? "Hit" : "Miss"}
                    </Button>
                  )}
                  {x.contra && (
                    <span
                      data-testid="cbt-popup-target-natural"
                      data-record-id={x.c.id}
                      data-value={x.contra.natural}
                      className="shrink-0 text-xs font-medium text-hp-bloodied"
                    >
                      natural {x.contra.natural}
                    </span>
                  )}
                  <ToggleGroup
                    type="single"
                    data-testid="cbt-popup-target-mult"
                    data-record-id={x.c.id}
                    data-value={x.mult}
                    className="shrink-0"
                    value={x.mult}
                    onValueChange={(v) => v && setRow(x.c.id, { mult: v as DamageMultiplier })}
                  >
                    {MULTS.map((m) => (
                      <ToggleGroupItem
                        key={m}
                        value={m}
                        className="h-6 px-1 text-[11px]"
                        data-testid="cbt-popup-target-mult-option"
                        data-value={m}
                      >
                        {MULTIPLIER_LABEL[m]}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <span
                    data-testid="cbt-popup-target-preview"
                    data-record-id={x.c.id}
                    className="ml-auto shrink-0 text-xs tabular-nums"
                  >
                    {/* FR-CBT-78 (G5): temp HP absorbs first, "10 (+5) → 10 (+2)". K8: the
                        chip names the target, so the inline preview doesn't. */}
                    {x.raw === null
                      ? "?"
                      : x.hp
                        ? previewText("", x.hp, x.raw).trimStart()
                        : String(x.raw)}
                  </span>
                  <span className={ROW_HOVER_SLOT}>
                    <Button
                      size="icon"
                      variant="ghost"
                      className={cn("size-6", ROW_HOVER)}
                      data-testid={ruling ? "cbt-popup-row-drop" : "cbt-popup-target-remove"}
                      data-record-id={x.c.id}
                      aria-label={`${ruling ? "Drop" : "Remove"} ${x.c.name}`}
                      onClick={() => remove(x.c)}
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  </span>
                </div>
                {x.contra && (
                  // FR-CBT-57/58: a ruling against a natural roll is public.
                  <p className="text-xs text-hp-bloodied">{x.contra.hint}</p>
                )}
                {x.hit && extraParts.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {extraParts.map((part, i) => (
                      <PartChip
                        // biome-ignore lint/suspicious/noArrayIndexKey: parts are the card's, in order
                        key={i}
                        targetId={x.c.id}
                        index={i}
                        type={part.type}
                        value={x.extraMults[i] as DamageMultiplier}
                        hint={x.presets[i]?.hint ?? null}
                        onChange={(m) => {
                          const extra = x.extraMults.map((v, j) => (j === i ? m : v));
                          setRow(x.c.id, { extra });
                        }}
                      />
                    ))}
                  </div>
                )}
                {popupParts.map((part) => (
                  <part.Chips
                    key={part.id}
                    card={p}
                    cardId={card.id}
                    row={x.view}
                    rows={views}
                    value={draft.parts[part.id]}
                    onChange={(v) => edit((d) => ({ parts: { ...d.parts, [part.id]: v } }))}
                    disabled={disabled}
                  />
                ))}
              </li>
            ))}
          </ul>
        )}
        {/* FR-CBT-89: the damage step adds no target. */}
        {!ruling && (
          <AddTarget
            options={addable}
            onPick={add}
            disabled={disabled}
            collapsed={rows.length > 0}
          />
        )}
      </section>
      {list.tooMany && (
        <p data-testid="cbt-popup-max-targets" className="text-xs text-destructive">
          Max {APPLY_TARGETS_MAX} targets
        </p>
      )}
      {note && (
        // FR-CBT-93 (b): the roll came after this turn's apply of the same attack.
        <p data-testid="cbt-popup-late-note" className="text-xs text-muted-foreground">
          {note}
        </p>
      )}
      {/* FR-KIT-65: Dismiss left, the card actions in the middle, Apply (primary) right. */}
      <div data-slot="card-footer" className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          data-testid="cbt-popup-dismiss"
          disabled={disabled}
          onClick={dismiss}
        >
          Dismiss
        </Button>
        <div className="flex min-w-0 flex-1 justify-center">
          {/* FR-CBT-130 (sprint 7): the card-action slot (gems' Combat gem); none → nothing. */}
          <CardActions card={card} client="dm" />
        </div>
        {action === "apply-hit" ? (
          <Button
            size="sm"
            data-testid="cbt-popup-apply-hit"
            disabled={disabled || list.tooMany}
            onClick={applyHit}
          >
            Apply hit
          </Button>
        ) : (
          <Button
            size="sm"
            data-testid="cbt-popup-apply"
            disabled={disabled || !ready}
            onClick={apply}
          >
            {applyLabel(
              damageTotal,
              extraTotals,
              rows.map((x) => x.hit),
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * FR-CBT-55/56: the placement tiers fixed when the popup opens, from the selection rows' tokens at
 * that moment, else the attacker's likely targets, then the rest (`placementTiers`; the panel
 * never jumps while the DM edits the selection, switches scene or moves a token).
 */
function useOpenTiers(card: NotificationRecord): string[][] {
  const p = DamageCardPayload.safeParse(card.payload);
  const combatants = useCombatants(p.data?.encounterId);
  const tokens = useRecords<{ id: string; sceneId: string }>(TOKEN_TYPE);
  const [tiers] = useState(() => {
    if (!p.success) return [];
    const selection = getMapSelection();
    const { rows } = targetList({
      combatants,
      encounterId: p.data.encounterId,
      attackerId: p.data.attackerId,
      selectedTokenIds: selection.tokenIds,
      added: [],
    });
    return placementTiers({
      rowTokenIds: rows.flatMap((r) => (r.c.tokenId ? [r.c.tokenId] : [])),
      combatants,
      encounterId: p.data.encounterId,
      attackerId: p.data.attackerId,
      tokenSceneOf: (id) => tokens.find((t) => t.id === id)?.sceneId ?? null,
      viewedSceneId: selection.sceneId,
    });
  });
  return tiers;
}

/**
 * Mounted once (companion of `cbt.initiative`); opened from the card, its toast, the Pending
 * list or the DM's own attack. Non-modal: a fixed panel, no overlay, no focus trap.
 */
export function AttackPopup() {
  const cardId = useCombatDialogs((s) => s.cardId);
  const origin = useCombatDialogs((s) => s.origin);
  const openSeq = useCombatDialogs((s) => s.openSeq);
  const close = useCombatDialogs((s) => s.closeCard);
  const notes = useRecords<NotificationRecord>("notification");
  const card = cardId ? notes.find((n) => n.id === cardId) : undefined;
  const resolved = card !== undefined && card.state !== "pending";
  // Resolved elsewhere (Notifications, Undo, End): that is a close too (FR-CBT-54).
  useEffect(() => {
    if (resolved) close();
  }, [resolved, close]);
  if (card?.state !== "pending") return null;
  return <PopupPanel key={`${card.id}:${openSeq}`} card={card} origin={origin} close={close} />;
}

const viewport = (): Viewport => ({ w: window.innerWidth, h: window.innerHeight });

function PopupPanel({
  card,
  origin,
  close,
}: {
  card: NotificationRecord;
  origin: PopupOrigin | null;
  close(): void;
}) {
  const tiers = useOpenTiers(card);
  const ref = useRef<HTMLDivElement>(null);
  // Top-left once placed (FR-CBT-55/56, over its notification FR-CBT-75) or dragged (FR-CBT-76);
  // null before the first layout. Client memory until the popup closes.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [side, setSide] = useState<Placement["side"] | null>(null);
  const posRef = useRef(pos);
  posRef.current = pos;

  // Item 11: a card's toast never shows while its popup is open (FR-CBT-75, FR-NOTE-26).
  useEffect(() => hideToast(card.id), [card.id]);

  // FR-CBT-55/56/75: placed once the panel's size is known (before paint); re-clamped when the
  // panel or the viewport changes size, so it stays in the work area.
  // biome-ignore lint/correctness/useExhaustiveDependencies: placed once per open
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const size = () => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height };
    };
    const at = measurePlacement(tiers, size(), origin);
    setSide(at.side);
    setPos({ x: at.x, y: at.y ?? at.top });
    const reclamp = () => {
      const p = posRef.current;
      if (p) setPos(clampIntoWorkArea({ ...p, ...size() }, viewport()));
    };
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reclamp);
    ro?.observe(el);
    window.addEventListener("resize", reclamp);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", reclamp);
    };
  }, []);

  /** FR-CBT-76: drag by the header (`cbt-popup-drag`), clamped into the work area. */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    const handle = (e.target as Element).closest('[data-testid="cbt-popup-drag"]');
    // FR-KIT-62: the bar's gem (Later) is a button, not a grip.
    if (e.button !== 0 || !el || !handle || (e.target as Element).closest("button")) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const start = { x: r.left, y: r.top, w: r.width, h: r.height };
    const sx = e.clientX;
    const sy = e.clientY;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const next = dragPopup(start, ev.clientX - sx, ev.clientY - sy, viewport());
      setPos({ x: next.x, y: next.y });
    };
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  };

  const vp = viewport();
  const maxHeight = vp.h - LAUNCHER_CLEAR - TOP_BAR_H - EDGE_GAP;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-label="Attack"
      data-testid="cbt-popup"
      data-record-id={card.id}
      data-side={side ?? undefined}
      // At `pos` (placed / dragged); hidden for the first, measuring layout only.
      style={
        pos
          ? { left: pos.x, top: pos.y, maxHeight }
          : { left: 0, top: TOP_BAR_H, maxHeight, visibility: "hidden" }
      }
      className="fixed z-40 flex w-[min(440px,calc(100vw-2rem))] flex-col overflow-y-auto rounded-lg border bg-card p-3 text-card-foreground shadow-lg"
      onPointerDown={onPointerDown}
      // Esc with focus in the popup closes it; Esc on the canvas clears the selection (FR-MAP-31).
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <PopupBody card={card} close={close} />
    </div>
  );
}

// Attack popup (FR-CBT-33): a non-modal panel (no overlay; the canvas stays usable). Shared
// to-hit / damage (editable), then one row per target: selection rows follow the DM's map
// selection (targeting on: click, Ctrl/Shift-click, box), added rows come from "Add target".
// Per row: hit vs AC (preset, toggle), multiplier, preview. Apply sends 1–20 targets in list
// order (FR-CBT-34); Later keeps the card pending; Dismiss closes it. Close → targeting off,
// selection kept, except after a successful Apply (FR-CBT-54). Placement: FR-CBT-55/56, over its
// notification (FR-CBT-75); movable by its header (FR-CBT-76); its card's toast stays hidden.
// Partial cards (FR-CBT-72, N7): to-hit-only → "Waiting for damage" (the DM may type a total;
// the roll fills the cell when it attaches); damage-only → no to-hit cell or "vs AC", rows Hit.

import { naturalMark } from "@shared/combat-tracker/log-kinds";
import { MULTIPLIER_LABEL, rawDamage } from "@shared/combat-tracker/rules";
import {
  APPLY_TARGETS_MAX,
  type CombatantView,
  DamageCardPayload,
  type DamageMultiplier,
} from "@shared/combat-tracker/schemas";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { modSegments } from "@shared/effect-modifiers/line";
import type { DefinitionRecord } from "@shared/entities/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { Button } from "@ui/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  ToggleGroup,
  ToggleGroupItem,
} from "@ui/components/ui/controls";
import { Badge, Input, Label } from "@ui/components/ui/primitives";
import { useCbtIntent, useCombatants } from "@ui/features/combat-tracker/store";
import { useTargetingAttacker } from "@ui/features/combat-tracker/token-overlay";
import { hideToast } from "@ui/features/notifications/toasts";
import type { Viewport } from "@ui/features/play-shell/geometry";
import { useRecords } from "@ui/sync/store";
import { EyeOffIcon, XIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LinkHintNote } from "../combat-extras/link-hint";
import {
  getMapSelection,
  setMapSelection,
  setTargeting,
  useMapSelection,
} from "../scenes-map/selection";
import { useDefinitions } from "./data";
import {
  clampIntoWorkArea,
  dragPopup,
  measurePlacement,
  originPlacement,
  type Placement,
  placementTokenIds,
} from "./popup-placement";
import { type PopupOrigin, useCombatDialogs } from "./popup-store";
import {
  addAction,
  applyReady,
  cardShape,
  eligibleTargets,
  type HpTemp,
  naturalContradiction,
  previewText,
  rowPreset,
  shownTotal,
  targetList,
  totalOf,
} from "./targets";

const MULTS: DamageMultiplier[] = ["normal", "half", "none", "double"];

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

/** "Add target" Combobox over every eligible combatant not yet in the list (incl. hidden). */
function AddTarget({
  options,
  onPick,
  disabled,
}: {
  options: CombatantView[];
  onPick(c: CombatantView): void;
  disabled: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const shown = options.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const pick = (c: CombatantView) => {
    onPick(c);
    setQ("");
    setOpen(false);
  };
  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
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
              setOpen(false);
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

interface PerTarget {
  /** Toggled hit; null = follow the preset. */
  hit: boolean | null;
  mult: DamageMultiplier;
}

function PopupBody({ card, close }: { card: NotificationRecord; close(): void }) {
  const payload = useMemo(() => DamageCardPayload.safeParse(card.payload), [card.payload]);
  const p = payload.success ? payload.data : null;
  const defs = useDefinitions();
  const combatants = useCombatants(p?.encounterId);
  const tokens = useRecords<{ id: string; sceneId: string }>(TOKEN_TYPE);
  const selection = useMapSelection();
  // Null = follow the card's rolled value (a Damage attaching while open fills the cell).
  const [toHitDraft, setToHit] = useState<string | null>(null);
  const [damageDraft, setDamage] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [per, setPer] = useState<Record<string, PerTarget>>({});
  const { send, disabled } = useCbtIntent();
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

  if (!p) return <p className="text-sm text-destructive">Unreadable card</p>;

  const list = targetList({
    combatants,
    encounterId: p.encounterId,
    attackerId: p.attackerId,
    selectedTokenIds: selection.tokenIds,
    added,
  });
  const inList = new Set(list.rows.map((r) => r.c.id));
  const addable = eligibleTargets(combatants, p.encounterId, p.attackerId).filter(
    (c) => !inList.has(c.id),
  );
  const shape = cardShape(p);
  const toHit = shownTotal(toHitDraft, p.toHit?.total);
  const damage = shownTotal(damageDraft, p.damage?.total);
  const toHitTotal = totalOf(toHit) ?? p.toHit?.total ?? 0;
  const rolledNatural = p.toHit?.natural ?? null;
  const natural = naturalMark(rolledNatural);
  // An empty / non-number cell falls back to the roll; none yet → null (FR-CBT-72).
  const damageTotal = totalOf(damage) ?? p.damage?.total ?? null;
  const rows = list.rows.map(({ c, source }) => {
    const ac = acOf(c, defs);
    const preset = rowPreset(shape, rolledNatural, toHitTotal, ac);
    const st = per[c.id] ?? { hit: null, mult: "normal" };
    const hit = st.hit ?? preset;
    const raw = damageTotal === null ? null : rawDamage(hit, damageTotal, st.mult);
    const hp = hpOf(c, defs);
    const contra = naturalContradiction(rolledNatural, hit);
    return { c, source, ac, preset, hit, mult: st.mult, raw, hp, contra };
  });
  const ready = applyReady(
    rows.map((x) => x.hit),
    damageTotal,
    list.tooMany,
  );
  const setRow = (id: string, patch: Partial<PerTarget>) =>
    setPer((s) => ({ ...s, [id]: { ...(s[id] ?? { hit: null, mult: "normal" }), ...patch } }));
  const remove = (c: CombatantView) => {
    setAdded((a) => a.filter((id) => id !== c.id));
    if (c.tokenId && selection.tokenIds.includes(c.tokenId)) {
      setMapSelection(selection.tokenIds.filter((t) => t !== c.tokenId));
    }
  };
  const add = (c: CombatantView) => {
    const sceneOf = (tokenId: string) => tokens.find((t) => t.id === tokenId)?.sceneId ?? null;
    const a = addAction(c, sceneOf, selection.sceneId);
    if ("select" in a) setMapSelection([...selection.tokenIds, a.select]);
    else setAdded((x) => [...x, a.add]);
  };

  const apply = async () => {
    if (!ready) return;
    // FR-CBT-72: a to-hit total iff the card has a to-hit roll; no damage total on an all-miss
    // to-hit-only card.
    const r = await send("cbt.applyCard", {
      cardId: card.id,
      ...(p.toHit ? { toHitTotal } : {}),
      ...(damageTotal !== null ? { damageTotal } : {}),
      targets: rows.map((x) => ({ targetId: x.c.id, hit: x.hit, multiplier: x.mult })),
    });
    if (r === undefined) return;
    // FR-CBT-54 (G5): a successful Apply clears the map selection, so the next popup opens with
    // no stale rows; Later, Dismiss, close and a reject keep it.
    setMapSelection([]);
    close();
  };
  const dismiss = async () => {
    const r = await send("note.dismiss", { id: card.id });
    if (r !== undefined) close();
  };

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* FR-CBT-76: the header drags the popup (handled by the panel). */}
      <div data-testid="cbt-popup-drag" className="-mx-3 -mt-3 cursor-move select-none px-3 pt-3">
        <h2 className="text-sm font-semibold">
          {p.attackerName} — {p.attackName}
        </h2>
        <p className="text-xs text-muted-foreground">
          {p.mode !== "normal" ? `${p.mode} · ` : ""}
          {p.crit ? "Critical! " : ""}
          {card.text}
        </p>
      </div>
      <div className={shape === "damage" ? "grid gap-2" : "grid grid-cols-2 gap-2"}>
        {p.toHit && (
          <div className="grid gap-1">
            <Label htmlFor="cbt-popup-tohit" className="flex-wrap text-xs">
              To hit <Dice dice={p.toHit.dice} /> {p.toHit.constant >= 0 ? "+" : "−"}
              {Math.abs(p.toHit.constant)}
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
              inputMode="numeric"
              className="h-8"
              value={toHit}
              onChange={(e) => setToHit(e.target.value)}
            />
          </div>
        )}
        <div className="grid gap-1">
          <Label htmlFor="cbt-popup-damage" className="flex-wrap text-xs">
            Damage{" "}
            {p.damage ? (
              <>
                <Dice dice={p.damage.dice} /> {p.damage.constant >= 0 ? "+" : "−"}
                {Math.abs(p.damage.constant)}
                {p.damage.mods && lineText(modSegments(p.damage.mods))}
              </>
            ) : (
              <span
                data-testid="cbt-popup-waiting-damage"
                className="font-normal text-muted-foreground"
              >
                Waiting for damage
              </span>
            )}
            {p.damageType ? ` ${p.damageType}` : ""}
            {p.damage && damageTotal !== p.damage.total && (
              <>
                <Badge variant="secondary">edited</Badge>
                <span className="font-normal text-muted-foreground">rolled {p.damage.total}</span>
              </>
            )}
          </Label>
          <Input
            id="cbt-popup-damage"
            data-testid="cbt-popup-damage"
            inputMode="numeric"
            className="h-8"
            placeholder={p.damage ? undefined : "Total"}
            value={damage}
            onChange={(e) => setDamage(e.target.value)}
          />
          {p.saveDc && (
            <p className="text-xs text-muted-foreground">
              DC {p.saveDc.dc} {p.saveDc.ability.toUpperCase()} · Half on a successful save
            </p>
          )}
        </div>
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
            Select tokens on the map (Ctrl / Shift to add, drag a box) or add a target.
          </p>
        ) : (
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {rows.map((x) => (
              <li
                key={x.c.id}
                data-testid="cbt-popup-target-row"
                data-record-id={x.c.id}
                data-source={x.source}
                className="flex flex-col gap-1 rounded-md border px-2 py-1"
              >
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium" title={x.c.name}>
                    {x.c.name}
                  </span>
                  {x.c.hidden && (
                    <EyeOffIcon
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-label="Hidden"
                    />
                  )}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {/* FR-CBT-72: a damage-only card has no to-hit to compare: AC alone. */}
                    {shape === "damage"
                      ? `AC ${x.ac ?? "—"}`
                      : x.ac === null
                        ? "vs AC —"
                        : `vs AC ${x.ac} →`}
                  </span>
                  <Button
                    size="sm"
                    variant={x.hit ? "default" : "outline"}
                    className="h-6 px-2 text-xs"
                    data-testid="cbt-popup-target-hit"
                    data-record-id={x.c.id}
                    data-value={x.hit ? "hit" : "miss"}
                    aria-pressed={x.hit}
                    onClick={() => setRow(x.c.id, { hit: !x.hit })}
                  >
                    {x.hit ? "Hit" : "Miss"}
                  </Button>
                  {x.contra && (
                    <span
                      data-testid="cbt-popup-target-natural"
                      data-record-id={x.c.id}
                      data-value={x.contra.natural}
                      className="text-xs font-medium text-hp-bloodied"
                    >
                      natural {x.contra.natural}
                    </span>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-6"
                    data-testid="cbt-popup-target-remove"
                    data-record-id={x.c.id}
                    aria-label={`Remove ${x.c.name}`}
                    onClick={() => remove(x.c)}
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                </div>
                {x.contra && (
                  // FR-CBT-57/58: a ruling against a natural roll is public.
                  <p className="text-xs text-hp-bloodied">{x.contra.hint}</p>
                )}
                <div className="flex items-center gap-2">
                  <ToggleGroup
                    type="single"
                    data-testid="cbt-popup-target-mult"
                    data-record-id={x.c.id}
                    data-value={x.mult}
                    value={x.mult}
                    onValueChange={(v) => v && setRow(x.c.id, { mult: v as DamageMultiplier })}
                  >
                    {MULTS.map((m) => (
                      <ToggleGroupItem
                        key={m}
                        value={m}
                        className="h-6 px-1.5 text-xs"
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
                    className="ml-auto text-xs tabular-nums"
                  >
                    {/* FR-CBT-78 (G5): temp HP absorbs first, "Thorn 10 (+5) → 10 (+2)". */}
                    {x.raw === null
                      ? `${x.c.name}: ?`
                      : x.hp
                        ? previewText(x.c.name, x.hp, x.raw)
                        : `${x.c.name}: ${x.raw}`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <AddTarget options={addable} onPick={add} disabled={disabled} />
      </section>
      {list.tooMany && (
        <p data-testid="cbt-popup-max-targets" className="text-xs text-destructive">
          Max {APPLY_TARGETS_MAX} targets
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          data-testid="cbt-popup-dismiss"
          disabled={disabled}
          onClick={dismiss}
        >
          Dismiss
        </Button>
        <Button size="sm" variant="outline" data-testid="cbt-popup-later" onClick={close}>
          Later
        </Button>
        <Button
          size="sm"
          data-testid="cbt-popup-apply"
          disabled={disabled || !ready}
          onClick={apply}
        >
          Apply
        </Button>
      </div>
    </div>
  );
}

/**
 * FR-CBT-55/56: placement fixed when the popup opens, from the selection rows' tokens at that
 * moment, else the attacker's likely targets (the panel never jumps while the DM edits the
 * selection, switches scene or moves a token).
 */
function useOpenPlacement(card: NotificationRecord): Placement {
  const p = DamageCardPayload.safeParse(card.payload);
  const combatants = useCombatants(p.data?.encounterId);
  const tokens = useRecords<{ id: string; sceneId: string }>(TOKEN_TYPE);
  const [placement] = useState(() => {
    if (!p.success) return measurePlacement([]);
    const selection = getMapSelection();
    const { rows } = targetList({
      combatants,
      encounterId: p.data.encounterId,
      attackerId: p.data.attackerId,
      selectedTokenIds: selection.tokenIds,
      added: [],
    });
    return measurePlacement(
      placementTokenIds({
        rowTokenIds: rows.flatMap((r) => (r.c.tokenId ? [r.c.tokenId] : [])),
        combatants,
        encounterId: p.data.encounterId,
        attackerId: p.data.attackerId,
        tokenSceneOf: (id) => tokens.find((t) => t.id === id)?.sceneId ?? null,
        viewedSceneId: selection.sceneId,
      }),
    );
  });
  return placement;
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
  const at = useOpenPlacement(card);
  const ref = useRef<HTMLDivElement>(null);
  // Top-left once placed over its notification (FR-CBT-75) or dragged (FR-CBT-76); null = the
  // FR-CBT-55/56 spot, centred. Client memory until the popup closes.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const posRef = useRef(pos);
  posRef.current = pos;

  // Item 11: a card's toast never shows while its popup is open (FR-CBT-75, FR-NOTE-26).
  useEffect(() => hideToast(card.id), [card.id]);

  // FR-CBT-75: over its origin, clamped once the panel's size is known; re-clamped when the
  // panel or the viewport changes size, so it stays in the work area.
  // biome-ignore lint/correctness/useExhaustiveDependencies: placed once per open
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const size = () => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height };
    };
    if (origin) setPos(originPlacement(origin, size(), viewport()));
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
    if (e.button !== 0 || !el || !handle) return;
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

  const maxHeight = at.bottom - at.top;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-label="Attack"
      data-testid="cbt-popup"
      data-record-id={card.id}
      data-side={origin ? "origin" : at.side}
      // FR-CBT-55: centred in the work area at its left / right edge; FR-CBT-75/76: at `pos`.
      style={
        pos
          ? { left: pos.x, top: pos.y, maxHeight }
          : origin
            ? { left: origin.x, top: origin.y, maxHeight }
            : { left: at.x, top: (at.top + at.bottom) / 2, maxHeight, translate: "0 -50%" }
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

// Attack popup (FR-CBT-19): the DM picks the target, sees hit / miss vs AC, may override any
// value, picks the multiplier and applies. Later keeps the card pending; Dismiss closes it.

import { clampHp, hitHint, MULTIPLIER_LABEL, rawDamage } from "@shared/combat-tracker/rules";
import {
  type CombatantView,
  DamageCardPayload,
  type DamageMultiplier,
} from "@shared/combat-tracker/schemas";
import type { DefinitionRecord } from "@shared/entities/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { Button } from "@ui/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@ui/components/ui/controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ui/components/ui/overlays";
import { Badge, Input, Label } from "@ui/components/ui/primitives";
import { useCbtIntent, useCombatants } from "@ui/features/combat-tracker/store";
import { useRecords } from "@ui/sync/store";
import { EyeOffIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useDefinitions } from "./data";
import { useCombatDialogs } from "./popup-store";

const MULTS: DamageMultiplier[] = ["normal", "half", "none", "double"];

/** Current / max HP the DM sees: monsters on the combatant, PCs on the character. */
export function hpOf(
  c: CombatantView,
  defs: Map<string, DefinitionRecord>,
): { cur: number; max: number } | null {
  if (c.kind === "monster") {
    return c.hpCurrent != null && c.hpMax != null ? { cur: c.hpCurrent, max: c.hpMax } : null;
  }
  const d = c.entityId ? defs.get(c.entityId) : undefined;
  return d?.kind === "character" ? { cur: d.hpCurrent, max: d.statBlock.hpMax } : null;
}

export const acOf = (c: CombatantView, defs: Map<string, DefinitionRecord>) =>
  c.entityId ? (defs.get(c.entityId)?.statBlock.ac ?? null) : null;

const intOr = (s: string, fallback: number) => {
  const n = Number(s);
  return s.trim() !== "" && Number.isInteger(n) ? n : fallback;
};

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

function PopupBody({ card, close }: { card: NotificationRecord; close(): void }) {
  const payload = useMemo(() => DamageCardPayload.safeParse(card.payload), [card.payload]);
  const p = payload.success ? payload.data : null;
  const defs = useDefinitions();
  const combatants = useCombatants(p?.encounterId);
  const targets = combatants.filter((c) => c.active !== false && !c.removed);
  const [targetId, setTargetId] = useState("");
  const [toHit, setToHit] = useState(String(p?.toHit.total ?? 0));
  const [damage, setDamage] = useState(String(p?.damage.total ?? 0));
  const [hitOverride, setHitOverride] = useState<boolean | null>(null);
  const [mult, setMult] = useState<DamageMultiplier>("normal");
  const { send, disabled } = useCbtIntent();
  if (!p) return <p className="text-sm text-destructive">Unreadable card</p>;

  const target = targets.find((c) => c.id === targetId) ?? null;
  const ac = target ? acOf(target, defs) : null;
  const toHitTotal = intOr(toHit, p.toHit.total);
  const damageTotal = intOr(damage, p.damage.total);
  const computed = ac === null ? null : hitHint(p.toHit.natural, toHitTotal, ac);
  const hit = hitOverride ?? computed ?? true;
  const raw = rawDamage(hit, damageTotal, mult);
  const hp = target ? hpOf(target, defs) : null;

  const apply = async () => {
    if (!target) return;
    const r = await send("cbt.applyCard", {
      cardId: card.id,
      targetId: target.id,
      toHitTotal,
      hit,
      damageTotal,
      multiplier: mult,
    });
    if (r !== undefined) close();
  };
  const dismiss = async () => {
    const r = await send("note.dismiss", { id: card.id });
    if (r !== undefined) close();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {p.attackerName} — {p.attackName}
        </DialogTitle>
        <DialogDescription>
          {p.mode !== "normal" ? `${p.mode} · ` : ""}
          {p.crit ? "Critical! " : ""}
          {card.text}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="cbt-popup-target">Target</Label>
          <Select value={targetId} onValueChange={(v) => setTargetId(v)}>
            <SelectTrigger id="cbt-popup-target" data-testid="cbt-popup-target">
              <SelectValue placeholder="Pick a target" />
            </SelectTrigger>
            <SelectContent>
              {targets.map((c) => (
                <SelectItem
                  key={c.id}
                  value={c.id}
                  data-testid="cbt-popup-target-option"
                  data-value={c.id}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {c.name}
                    {c.hidden && <EyeOffIcon className="size-3.5 text-muted-foreground" />}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-2">
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="cbt-popup-tohit">
              To hit <Dice dice={p.toHit.dice} /> {p.toHit.constant >= 0 ? "+" : "−"}
              {Math.abs(p.toHit.constant)}
              {toHitTotal !== p.toHit.total && <Badge variant="secondary">edited</Badge>}
            </Label>
            <Input
              id="cbt-popup-tohit"
              data-testid="cbt-popup-tohit"
              inputMode="numeric"
              value={toHit}
              onChange={(e) => setToHit(e.target.value)}
            />
          </div>
          <span data-testid="cbt-popup-vs" className="pb-2 text-sm text-muted-foreground">
            {ac === null ? "vs AC —" : `vs AC ${ac} → ${computed ? "Hit" : "Miss"}`}
          </span>
        </div>
        <ToggleGroup
          type="single"
          data-testid="cbt-popup-hit"
          data-value={hit ? "hit" : "miss"}
          value={hit ? "hit" : "miss"}
          onValueChange={(v) => v && setHitOverride(v === "hit")}
        >
          <ToggleGroupItem value="hit" data-testid="cbt-popup-hit-option" data-value="hit">
            Hit
          </ToggleGroupItem>
          <ToggleGroupItem value="miss" data-testid="cbt-popup-hit-option" data-value="miss">
            Miss
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="grid gap-1.5">
          <Label htmlFor="cbt-popup-damage">
            Damage <Dice dice={p.damage.dice} /> {p.damage.constant >= 0 ? "+" : "−"}
            {Math.abs(p.damage.constant)}
            {p.damageType ? ` ${p.damageType}` : ""}
            {damageTotal !== p.damage.total && <Badge variant="secondary">edited</Badge>}
          </Label>
          <Input
            id="cbt-popup-damage"
            data-testid="cbt-popup-damage"
            inputMode="numeric"
            value={damage}
            onChange={(e) => setDamage(e.target.value)}
          />
        </div>
        <ToggleGroup
          type="single"
          data-testid="cbt-popup-mult"
          data-value={mult}
          value={mult}
          onValueChange={(v) => v && setMult(v as DamageMultiplier)}
        >
          {MULTS.map((m) => (
            <ToggleGroupItem key={m} value={m} data-testid="cbt-popup-mult-option" data-value={m}>
              {MULTIPLIER_LABEL[m]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p data-testid="cbt-popup-preview" className="text-sm">
          {target
            ? hp
              ? `${target.name} ${hp.cur} → ${clampHp(hp.cur, -raw, hp.max)}`
              : `${target.name}: ${raw} damage`
            : "Pick a target"}
        </p>
      </div>
      <DialogFooter>
        <Button
          variant="ghost"
          data-testid="cbt-popup-dismiss"
          disabled={disabled}
          onClick={dismiss}
        >
          Dismiss
        </Button>
        <Button variant="outline" data-testid="cbt-popup-later" onClick={close}>
          Later
        </Button>
        <Button data-testid="cbt-popup-apply" disabled={disabled || !target} onClick={apply}>
          Apply
        </Button>
      </DialogFooter>
    </>
  );
}

/** Mounted once (companion of `cbt.initiative`); opened from the card or the Pending list. */
export function AttackPopup() {
  const cardId = useCombatDialogs((s) => s.cardId);
  const close = useCombatDialogs((s) => s.closeCard);
  const notes = useRecords<NotificationRecord>("notification");
  const card = cardId ? notes.find((n) => n.id === cardId) : undefined;
  const open = card !== undefined && card.state === "pending";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent data-testid="cbt-popup" data-record-id={cardId ?? undefined}>
        {card && <PopupBody key={card.id} card={card} close={close} />}
      </DialogContent>
    </Dialog>
  );
}

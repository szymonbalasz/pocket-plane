// Concentration card views (FR-CBTX-37), both clients: brain icon, the card's text, the outcome
// once closed ("DC 12: 14 — kept" / "DC 12: 7 — lost" / "Ended" / "Undone"). The action ("Roll
// save") opens a roll dialog with the shared roll control (Shift / Ctrl, physical dice, DM public
// toggle) hosted by each client's always-mounted combat companion; no host mounted (a player
// after End) → the server rolls at once.

import { signed } from "@shared/character-sheet/logic";
import {
  CBTX_INTENTS,
  ConcentrationCardPayload,
  ConcentrationCardResolution,
} from "@shared/combat-extras/intents";
import {
  CONCENTRATION_CARD_KIND,
  EFFECT_TYPE,
  type EffectView,
} from "@shared/combat-extras/schemas";
import { d20Expression } from "@shared/combat-tracker/rules";
import { COMBATANT_TYPE, type CombatantView } from "@shared/combat-tracker/schemas";
import {
  concentrationSaveBonus,
  type DefinitionRecord,
  ENTITY_TYPE,
  IMPORTED_ENTITY_TYPE,
} from "@shared/entities/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { BrainIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useEffect } from "react";
import { create } from "zustand";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/overlays";
import { useSync } from "../../sync/store";
import { useCbtIntent } from "../combat-tracker/store";
import { RollButton, useRollControl } from "../dice-roll-log/roll-control";
import { defineNotificationView, type NotificationView } from "../notifications/views";

/** "DC 12: 14 — kept", "Ended", "Undone"; null while pending. */
export function concentrationOutcome(n: Pick<NotificationRecord, "state" | "resolution">) {
  if (n.state === "pending") return null;
  if (n.state === "dismissed") return "Dismissed";
  const r = ConcentrationCardResolution.safeParse(n.resolution);
  if (!r.success) return "Resolved";
  if ("outcome" in r.data) return r.data.outcome === "ended" ? "Ended" : "Undone";
  return `DC ${r.data.dc}: ${r.data.total} — ${r.data.success ? "kept" : "lost"}`;
}

function CardBody({ notification: n }: { notification: NotificationRecord }) {
  const outcome = concentrationOutcome(n);
  return (
    <span className="flex flex-col">
      <span>{n.text}</span>
      {outcome && (
        <span
          data-testid="cbtx-note-outcome"
          data-value={n.state}
          className="text-xs text-muted-foreground"
        >
          {outcome}
        </span>
      )}
    </span>
  );
}

interface RollHostState {
  /** Hosts mounted (DM / player combat companions). */
  hosts: number;
  noteId: string | null;
}

export const useConcentrationRoll = create<RollHostState>(() => ({ hosts: 0, noteId: null }));

export const concentrationView: NotificationView = defineNotificationView({
  kind: CONCENTRATION_CARD_KIND,
  icon: BrainIcon,
  render: CardBody,
  // No end rule (OQ-CBTX-15): pending cards stay at End.
  onAction(n, ctx) {
    if (useConcentrationRoll.getState().hosts > 0) {
      useConcentrationRoll.setState({ noteId: n.id });
      return;
    }
    return ctx.send(CBTX_INTENTS.rollConcentration, { notificationId: n.id });
  },
});

/** FR-CBTX-42 display only: the bonus the server will add (it decides). */
function useBonus(effectId: string | undefined): number {
  return useSync((s) => {
    if (!effectId) return 0;
    const e = s.store.records[EFFECT_TYPE]?.[effectId] as EffectView | undefined;
    if (!e) return 0;
    if (e.targetCharacterId) {
      const ch = s.store.records[ENTITY_TYPE]?.[e.targetCharacterId] as
        | DefinitionRecord
        | undefined;
      return (ch?.statBlock && concentrationSaveBonus(ch.statBlock)) ?? 0;
    }
    const c = s.store.records[COMBATANT_TYPE]?.[e.targetCombatantId ?? ""] as
      | CombatantView
      | undefined;
    const def = (s.store.records[ENTITY_TYPE]?.[c?.entityId ?? ""] ??
      s.store.records[IMPORTED_ENTITY_TYPE]?.[c?.entityId ?? ""]) as DefinitionRecord | undefined;
    return (def?.statBlock && concentrationSaveBonus(def.statBlock)) ?? 0;
  });
}

function RollDialog({ n, close }: { n: NotificationRecord; close: () => void }) {
  const p = ConcentrationCardPayload.safeParse(n.payload);
  const bonus = useBonus(p.success ? p.data.effectId : undefined);
  const { send, disabled } = useCbtIntent();
  const control = useRollControl({
    expressions: [d20Expression(bonus)],
    category: "saving-throw",
    label: p.success ? `${p.data.targetName} — Concentration save (DC ${p.data.dc})` : undefined,
    onRoll: async (r) => {
      const res = await send(CBTX_INTENTS.rollConcentration, {
        notificationId: n.id,
        mode: r.mode,
        ...(r.manual ? { manual: r.manual[0] } : {}),
        ...(r.public !== undefined ? { public: r.public } : {}),
      });
      if (res !== undefined) close();
    },
  });
  return (
    <DialogContent data-testid="cbtx-note-dialog" data-record-id={n.id}>
      <DialogHeader>
        <DialogTitle>Concentration save</DialogTitle>
        <DialogDescription>{n.text}</DialogDescription>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">
        d20 {signed(bonus)} vs DC {p.success ? p.data.dc : "?"} · Shift advantage, Ctrl disadvantage
      </p>
      {control.isDm && (
        <div className="flex items-center gap-2 text-sm">
          <Switch
            data-testid="cbtx-note-public"
            aria-label="Shown to players"
            checked={control.publicValue}
            onCheckedChange={(v) => control.setPublic(v)}
          />
          {control.publicValue ? <EyeIcon className="size-4" /> : <EyeOffIcon className="size-4" />}
          {control.publicValue ? "Shown to players" : "DM only"}
        </div>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <RollButton
          control={control}
          data-testid="cbtx-note-roll"
          data-record-id={n.id}
          disabled={disabled || n.state !== "pending"}
        >
          Roll save
        </RollButton>
      </DialogFooter>
    </DialogContent>
  );
}

/** Mounted by each client's combat companion: hosts the roll dialog of `onAction`. */
export function ConcentrationRollHost() {
  const noteId = useConcentrationRoll((s) => s.noteId);
  const n = useSync((s) =>
    noteId ? (s.store.records.notification?.[noteId] as NotificationRecord | undefined) : undefined,
  );
  // Register as a host for the action's lifetime (not in render: one per mount).
  useHostCount();
  const close = () => useConcentrationRoll.setState({ noteId: null });
  return (
    <Dialog open={!!n} onOpenChange={(o) => !o && close()}>
      {n && <RollDialog n={n} close={close} />}
    </Dialog>
  );
}

function useHostCount() {
  useEffect(() => {
    useConcentrationRoll.setState((s) => ({ hosts: s.hosts + 1 }));
    return () => useConcentrationRoll.setState((s) => ({ hosts: s.hosts - 1 }));
  }, []);
}

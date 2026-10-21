// Direct damage / heal (FR-CBT-21): from the initiative row menu or the token menu. Sprint 7
// (FR-CBT-136): a From Select credits the change to a combatant (stats "Most healing").
import { COMBATANT_TYPE, type CombatantView } from "@shared/combat-tracker/schemas";
import { Button } from "@ui/components/ui/button";
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
import { Input, Label } from "@ui/components/ui/primitives";
import {
  useCbtIntent,
  useCombatants,
  useStartedEncounter,
} from "@ui/features/combat-tracker/store";
import { useRecords } from "@ui/sync/store";
import { useMemo, useState } from "react";
import { hpOf } from "./attack-popup";
import { useDefinitions } from "./data";
import { autoLabel, FROM_AUTO, FROM_DM, fromOptions, sourceIdFor } from "./hp-from";
import { useCombatDialogs } from "./popup-store";
import { type HpTemp, hpAfter, hpDialogText } from "./targets";

/** FR-CBT-78: "→ 10 / 10 · Temp 2". */
const afterText = (hp: HpTemp) => `→ ${hpDialogText(hp).slice("HP ".length)}`;

function HpForm({ c, close }: { c: CombatantView; close(): void }) {
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState(FROM_AUTO);
  const enc = useStartedEncounter();
  const fighters = useCombatants(enc?.id);
  const options = useMemo(() => fromOptions(fighters), [fighters]);
  const { send, disabled } = useCbtIntent();
  const defs = useDefinitions();
  const hp = hpOf(c, defs);
  const n = Number(amount);
  const valid = Number.isInteger(n) && n >= 1 && n <= 999;
  const go = async (kind: "damage" | "heal") => {
    if (!valid) return;
    const sourceId = sourceIdFor(kind, from, enc?.turnCombatantId, options);
    const r = await send("cbt.applyHp", {
      combatantId: c.id,
      kind,
      amount: n,
      ...(sourceId ? { sourceId } : {}),
    });
    if (r !== undefined) close();
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Damage / heal {c.name}</DialogTitle>
        <DialogDescription data-testid="cbt-hp-current">
          {hp ? hpDialogText(hp) : "Direct HP change"}
        </DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void go("damage");
        }}
      >
        <Label htmlFor="cbt-hp-amount">Amount</Label>
        <Input
          id="cbt-hp-amount"
          data-testid="cbt-hp-amount"
          inputMode="numeric"
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        {hp && valid && (
          // FR-CBT-78 (G5): damage drains temp HP first; heal ignores it.
          <p className="text-xs text-muted-foreground tabular-nums">
            Damage <span data-testid="cbt-hp-preview">{afterText(hpAfter(hp, "damage", n))}</span>
            {" · "}Heal{" "}
            <span data-testid="cbt-hp-preview-heal">{afterText(hpAfter(hp, "heal", n))}</span>
          </p>
        )}
        <Label htmlFor="cbt-hp-from">From</Label>
        <Select value={from} onValueChange={setFrom}>
          <SelectTrigger id="cbt-hp-from" data-testid="cbt-hp-from" className="min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FROM_AUTO}>{autoLabel(enc?.turnCombatantId, options)}</SelectItem>
            <SelectItem value={FROM_DM}>DM</SelectItem>
            {options.map((o) => (
              <SelectItem
                key={o.id}
                value={o.id}
                data-testid="cbt-hp-from-option"
                data-record-id={o.id}
              >
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </form>
      <DialogFooter>
        <Button
          variant="outline"
          data-testid="cbt-hp-heal"
          disabled={disabled || !valid}
          onClick={() => go("heal")}
        >
          Heal
        </Button>
        <Button
          variant="destructive"
          data-testid="cbt-hp-damage"
          disabled={disabled || !valid}
          onClick={() => go("damage")}
        >
          Damage
        </Button>
      </DialogFooter>
    </>
  );
}

export function HpDialog() {
  const id = useCombatDialogs((s) => s.hpCombatantId);
  const close = useCombatDialogs((s) => s.closeHp);
  const all = useRecords<CombatantView>(COMBATANT_TYPE);
  const c = id ? all.find((x) => x.id === id && x.active !== false) : undefined;
  return (
    <Dialog open={c !== undefined} onOpenChange={(o) => !o && close()}>
      <DialogContent data-testid="cbt-hp" data-record-id={id ?? undefined}>
        {c && <HpForm key={c.id} c={c} close={close} />}
      </DialogContent>
    </Dialog>
  );
}

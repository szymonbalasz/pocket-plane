// Direct damage / heal (FR-CBT-21): from the initiative row menu or the token menu.
import { COMBATANT_TYPE, type CombatantView } from "@shared/combat-tracker/schemas";
import { Button } from "@ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ui/components/ui/overlays";
import { Input, Label } from "@ui/components/ui/primitives";
import { useCbtIntent } from "@ui/features/combat-tracker/store";
import { useRecords } from "@ui/sync/store";
import { useState } from "react";
import { hpOf } from "./attack-popup";
import { useDefinitions } from "./data";
import { useCombatDialogs } from "./popup-store";

function HpForm({ c, close }: { c: CombatantView; close(): void }) {
  const [amount, setAmount] = useState("");
  const { send, disabled } = useCbtIntent();
  const defs = useDefinitions();
  const hp = hpOf(c, defs);
  const n = Number(amount);
  const valid = Number.isInteger(n) && n >= 1 && n <= 999;
  const go = async (kind: "damage" | "heal") => {
    if (!valid) return;
    const r = await send("cbt.applyHp", { combatantId: c.id, kind, amount: n });
    if (r !== undefined) close();
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Damage / heal {c.name}</DialogTitle>
        <DialogDescription>
          {hp ? `HP ${hp.cur} / ${hp.max}` : "Direct HP change"}
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

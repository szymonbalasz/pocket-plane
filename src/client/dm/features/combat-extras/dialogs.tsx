// DM combat-extras dialogs (FR-CBTX-33/36): Effect (Condition / Custom, duration, source, link,
// hidden), Concentration, Temp HP, Set death saves, Add combatants (`./add-dialog`: lookup,
// count, HP mode, created tokens; preview as Start). Hosted by `cbt.initiative`'s companion; they send intents, nothing else.

import { CONDITION_INFO, CONDITIONS, type Condition } from "@shared/combat-extras/conditions";
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import { effectName, endsRoundOf } from "@shared/combat-extras/rules";
import { EFFECT_TYPE, type EffectView } from "@shared/combat-extras/schemas";
import { Button } from "@ui/components/ui/button";
import { Checkbox, ToggleGroup, ToggleGroupItem } from "@ui/components/ui/controls";
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
import { activeEffects, creatureOf, effectsOn } from "@ui/features/combat-extras/logic";
import {
  useCbtIntent,
  useCombatants,
  useStartedEncounter,
} from "@ui/features/combat-tracker/store";
import { useSync } from "@ui/sync/store";
import { TrashIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { AddForm } from "./add-dialog";
import { type Target, useCbtxDialogs } from "./store";

const NONE = "none";

/** "" → null; else an integer in range, or undefined (invalid). */
function parseRounds(s: string): number | null | undefined {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : undefined;
}

function Shell({ testId, open, children }: { testId: string; open: boolean; children: ReactNode }) {
  const close = useCbtxDialogs((s) => s.close);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent data-testid={testId}>{children}</DialogContent>
    </Dialog>
  );
}

const targetNames = (ts: readonly Target[]) => ts.map((t) => t.name).join(", ");

// ---------- Effect… (FR-CBTX-36) ----------

function EffectForm({ targets, editId }: { targets: Target[]; editId?: string }) {
  const close = useCbtxDialogs((s) => s.close);
  const { send, disabled } = useCbtIntent();
  const enc = useStartedEncounter();
  const rows = useCombatants(enc?.id).filter((c) => !c.removed);
  const store = useSync((s) => s.store);
  const edit = editId
    ? (store.records[EFFECT_TYPE]?.[editId] as EffectView | undefined)
    : undefined;
  const [tab, setTab] = useState<"condition" | "custom">(
    edit?.kind === "custom" ? "custom" : "condition",
  );
  const [condition, setCondition] = useState<Condition>(edit?.condition ?? "prone");
  const [level, setLevel] = useState(String(edit?.level ?? 1));
  const [label, setLabel] = useState("");
  const [duration, setDuration] = useState(edit?.durationRounds ? String(edit.durationRounds) : "");
  const [source, setSource] = useState<string>(enc?.turnCombatantId ?? NONE);
  const [link, setLink] = useState(false);
  const [secret, setSecret] = useState(edit?.secret ?? false);
  const rounds = parseRounds(duration);
  const src = rows.find((c) => c.id === source);
  const conc = src
    ? effectsOn(activeEffects(store), creatureOf(src)).find((e) => e.kind === "concentration")
    : undefined;
  const lvl = Number(level);
  const valid =
    rounds !== undefined &&
    (rounds === null || enc !== null) &&
    (edit
      ? true
      : tab === "custom"
        ? label.trim().length >= 1 && label.trim().length <= 40
        : condition !== "exhaustion" || (Number.isInteger(lvl) && lvl >= 1 && lvl <= 6));
  const endsHint =
    typeof rounds === "number" && enc
      ? `Ends at the start of ${src?.name ?? "the turn combatant"}'s turn, round ${endsRoundOf(enc.round, rounds)}`
      : "Until removed";
  const save = async () => {
    if (!valid) return;
    let r: unknown;
    if (edit) {
      r = await send(CBTX_INTENTS.updateEffect, {
        effectId: edit.id,
        ...(edit.condition === "exhaustion" ? { level: lvl } : {}),
        ...(rounds !== (edit.durationRounds ?? null) ? { durationRounds: rounds } : {}),
        secret,
      });
    } else {
      r = await send(CBTX_INTENTS.addEffect, {
        targets: targets.map((t) => t.ref),
        kind: tab,
        ...(tab === "condition"
          ? { condition, ...(condition === "exhaustion" ? { level: lvl } : {}) }
          : { label: label.trim() }),
        ...(rounds !== null ? { durationRounds: rounds } : {}),
        ...(src ? { sourceCombatantId: src.id } : {}),
        ...(src && conc && link ? { linkConcentration: true } : {}),
        ...(secret ? { secret: true } : {}),
      });
    }
    if (r !== undefined) close();
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{edit ? `Edit ${effectName(edit)}` : "Add effect"}</DialogTitle>
        <DialogDescription>{targetNames(targets)}</DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {!edit && (
          <ToggleGroup
            type="single"
            value={tab}
            onValueChange={(v) => v && setTab(v as "condition" | "custom")}
            className="justify-start"
          >
            <ToggleGroupItem value="condition" data-testid="cbtx-effect-tab" data-value="condition">
              Condition
            </ToggleGroupItem>
            <ToggleGroupItem value="custom" data-testid="cbtx-effect-tab" data-value="custom">
              Custom
            </ToggleGroupItem>
          </ToggleGroup>
        )}
        {!edit && tab === "condition" && (
          <div className="grid gap-1.5">
            <Label>Condition</Label>
            <Select value={condition} onValueChange={(v) => setCondition(v as Condition)}>
              <SelectTrigger data-testid="cbtx-effect-condition">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONDITIONS.map((k) => (
                  <SelectItem
                    key={k}
                    value={k}
                    data-testid="cbtx-effect-condition-option"
                    data-value={k}
                  >
                    {CONDITION_INFO[k].name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{CONDITION_INFO[condition].reminder}</p>
          </div>
        )}
        {!edit && tab === "custom" && (
          <div className="grid gap-1.5">
            <Label htmlFor="cbtx-effect-label">Label</Label>
            <Input
              id="cbtx-effect-label"
              data-testid="cbtx-effect-label"
              maxLength={40}
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
        )}
        {(edit
          ? edit.condition === "exhaustion"
          : tab === "condition" && condition === "exhaustion") && (
          <div className="grid gap-1.5">
            <Label htmlFor="cbtx-effect-level">Level (1–6)</Label>
            <Input
              id="cbtx-effect-level"
              data-testid="cbtx-effect-level"
              inputMode="numeric"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
            />
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="cbtx-effect-duration">Duration (rounds)</Label>
          <Input
            id="cbtx-effect-duration"
            data-testid="cbtx-effect-duration"
            inputMode="numeric"
            placeholder="Until removed"
            disabled={!enc}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
          {!edit && <p className="text-xs text-muted-foreground">{endsHint}</p>}
        </div>
        {!edit && enc && (
          <div className="grid gap-1.5">
            <Label>Source</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger data-testid="cbtx-effect-source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No source</SelectItem>
                {rows.map((c) => (
                  <SelectItem
                    key={c.id}
                    value={c.id}
                    data-testid="cbtx-effect-source-option"
                    data-value={c.id}
                  >
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {!edit && src && conc && (
          <div className="flex items-center gap-2 text-sm">
            <Checkbox
              id="cbtx-effect-link"
              data-testid="cbtx-effect-link"
              checked={link}
              onCheckedChange={(v) => setLink(v === true)}
            />
            <Label htmlFor="cbtx-effect-link">
              Ends with {src.name}'s concentration ({conc.label})
            </Label>
          </div>
        )}
        <div className="flex items-center gap-2 text-sm">
          <Checkbox
            id="cbtx-effect-secret"
            data-testid="cbtx-effect-secret"
            checked={secret}
            onCheckedChange={(v) => setSecret(v === true)}
          />
          <Label htmlFor="cbtx-effect-secret">Hidden from players</Label>
        </div>
      </form>
      <DialogFooter>
        {edit && (
          <Button
            variant="destructive"
            data-testid="cbtx-effect-end"
            className="mr-auto"
            disabled={disabled}
            onClick={async () => {
              const r = await send(CBTX_INTENTS.endEffect, { effectId: edit.id });
              if (r !== undefined) close();
            }}
          >
            <TrashIcon /> End
          </Button>
        )}
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button data-testid="cbtx-effect-save" disabled={disabled || !valid} onClick={save}>
          {edit ? "Save" : "Add"}
        </Button>
      </DialogFooter>
    </>
  );
}

function EffectDialog() {
  const d = useCbtxDialogs((s) => s.effect);
  return (
    <Shell testId="cbtx-effect" open={d !== null}>
      {d && <EffectForm key={d.editId ?? d.targets.map((t) => t.name).join()} {...d} />}
    </Shell>
  );
}

// ---------- Concentration… ----------

function ConcentrationForm({ target }: { target: Target }) {
  const close = useCbtxDialogs((s) => s.close);
  const { send, disabled } = useCbtIntent();
  const enc = useStartedEncounter();
  const [label, setLabel] = useState("");
  const [duration, setDuration] = useState("");
  const rounds = parseRounds(duration);
  const valid = label.trim().length >= 1 && rounds !== undefined && (rounds === null || !!enc);
  const save = async () => {
    if (!valid) return;
    const r = await send(CBTX_INTENTS.setConcentration, {
      target: target.ref,
      label: label.trim(),
      ...(rounds !== null ? { durationRounds: rounds } : {}),
    });
    if (r !== undefined) close();
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Concentration</DialogTitle>
        <DialogDescription>{target.name} — replaces any concentration it has</DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="cbtx-conc-label">Spell</Label>
          <Input
            id="cbtx-conc-label"
            data-testid="cbtx-conc-label"
            maxLength={40}
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cbtx-conc-duration">Duration (rounds)</Label>
          <Input
            id="cbtx-conc-duration"
            data-testid="cbtx-conc-duration"
            inputMode="numeric"
            placeholder="Until removed"
            disabled={!enc}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>
      </form>
      <DialogFooter>
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button data-testid="cbtx-conc-save" disabled={disabled || !valid} onClick={save}>
          Concentrate
        </Button>
      </DialogFooter>
    </>
  );
}

function ConcentrationDialog() {
  const t = useCbtxDialogs((s) => s.concentration);
  return (
    <Shell testId="cbtx-conc" open={t !== null}>
      {t && <ConcentrationForm key={t.name} target={t} />}
    </Shell>
  );
}

// ---------- Temp HP… ----------

export function TempHpForm({
  targets,
  current,
  onDone,
}: {
  targets: Target[];
  current: number | null;
  onDone(): void;
}) {
  const { send, disabled } = useCbtIntent();
  const [value, setValue] = useState(current === null ? "" : String(current));
  const n = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 999;
  const save = async () => {
    if (!valid) return;
    for (const t of targets) {
      const r = await send(CBTX_INTENTS.setTempHp, { target: t.ref, value: n });
      if (r === undefined) return;
    }
    onDone();
  };
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          data-testid="cbtx-temp-input"
          aria-label="Temp HP"
          inputMode="numeric"
          className="h-8 w-20"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button type="submit" size="sm" data-testid="cbtx-temp-save" disabled={disabled || !valid}>
          Set
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Temp HP doesn't stack — keep the higher</p>
    </form>
  );
}

function TempDialog() {
  const ts = useCbtxDialogs((s) => s.temp);
  const close = useCbtxDialogs((s) => s.close);
  return (
    <Shell testId="cbtx-temp" open={ts !== null}>
      {ts && (
        <>
          <DialogHeader>
            <DialogTitle>Temp HP</DialogTitle>
            <DialogDescription>{targetNames(ts)}</DialogDescription>
          </DialogHeader>
          <TempHpForm targets={ts} current={null} onDone={close} />
        </>
      )}
    </Shell>
  );
}

// ---------- Set death saves… (FR-CBTX-24) ----------

function DeathSetForm({ characterId, name }: { characterId: string; name: string }) {
  const close = useCbtxDialogs((s) => s.close);
  const { send, disabled } = useCbtIntent();
  const ch = useSync(
    (s) =>
      s.store.records.entity?.[characterId] as
        | { deathSuccesses?: number; deathFailures?: number }
        | undefined,
  );
  const [succ, setSucc] = useState(String(ch?.deathSuccesses ?? 0));
  const [fail, setFail] = useState(String(ch?.deathFailures ?? 0));
  const pick = (testId: string, value: string, set: (v: string) => void) => (
    <Select value={value} onValueChange={set}>
      <SelectTrigger data-testid={testId} className="w-20">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {["0", "1", "2", "3"].map((v) => (
          <SelectItem key={v} value={v}>
            {v}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return (
    <>
      <DialogHeader>
        <DialogTitle>Death saves</DialogTitle>
        <DialogDescription>{name} — 3 successes = stable, 3 failures = dead</DialogDescription>
      </DialogHeader>
      <div className="flex items-center gap-4 text-sm">
        <span className="flex items-center gap-2">
          Successes {pick("cbtx-death-set-successes", succ, setSucc)}
        </span>
        <span className="flex items-center gap-2">
          Failures {pick("cbtx-death-set-failures", fail, setFail)}
        </span>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button
          data-testid="cbtx-death-set-save"
          disabled={disabled}
          onClick={async () => {
            const r = await send(CBTX_INTENTS.setDeathSaves, {
              characterId,
              successes: Number(succ),
              failures: Number(fail),
            });
            if (r !== undefined) close();
          }}
        >
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

function DeathSetDialog() {
  const d = useCbtxDialogs((s) => s.deathSet);
  return (
    <Shell testId="cbtx-death-set" open={d !== null}>
      {d && <DeathSetForm key={d.characterId} {...d} />}
    </Shell>
  );
}

// ---------- Add… (FR-CBTX-26/27, -44: `./add-dialog`) ----------

function AddDialog() {
  const open = useCbtxDialogs((s) => s.add);
  return (
    <Shell testId="cbtx-add" open={open}>
      {open && <AddForm />}
    </Shell>
  );
}

/** Every DM combat-extras dialog; mounted once by the combat companion. */
export function CbtxDialogs() {
  return (
    <>
      <EffectDialog />
      <ConcentrationDialog />
      <TempDialog />
      <DeathSetDialog />
      <AddDialog />
    </>
  );
}

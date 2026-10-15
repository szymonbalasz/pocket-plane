// DM Initiative header Add… (FR-CBTX-33 / -44): creature lookup over monsters + characters not in
// combat (FR-CBT-63); rows: creature, count 1–20 (characters 1), HP Average / Rolled (monsters),
// remove; Create tokens + Add hidden (both ticked, OQ-CBTX-22); per-instance preview as Start;
// `at` = the free area's centre cell when the DM views the encounter's scene (FR-CBT-65).
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import {
  ADD_INSTANCES_MAX,
  type AddCombatantItem,
  CBTX_INTENTS,
} from "@shared/combat-extras/intents";
import type { HpMode } from "@shared/combat-tracker/schemas";
import type { SceneFolderRecord, SceneRecord, TokenRecord } from "@shared/scenes-map/schemas";
import { Button } from "@ui/components/ui/button";
import { Checkbox } from "@ui/components/ui/controls";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ui/components/ui/overlays";
import { Label } from "@ui/components/ui/primitives";
import { CreatureLookup } from "@ui/features/combat-tracker/parts";
import {
  useCbtIntent,
  useCombatants,
  useStartedEncounter,
} from "@ui/features/combat-tracker/store";
import { useFreeArea } from "@ui/features/play-shell/free-area";
import { useRecords } from "@ui/sync/store";
import { MinusIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { useDefinitions } from "../combat-tracker/data";
import { HpSelect, JoinPreviewRow } from "../combat-tracker/join-parts";
import { addOptionsState, type JoinSlot, previewJoin } from "../combat-tracker/join-preview";
import { freeAreaCell } from "../combat-tracker/place-at";
import { creatureRows } from "../entities/list";
import { useDmMap, viewedScene } from "../scenes-map/view-state";
import { useCbtxDialogs } from "./store";

export interface AddRow {
  id: string;
  name: string;
  kind: "monster" | "character";
  qty: number;
  hpMode: HpMode;
}

/** FR-CBTX-44: rows → intent items (characters one each; monsters × quantity with HP mode). */
export function addItems(rows: readonly AddRow[]): AddCombatantItem[] {
  return rows.map((r) =>
    r.kind === "character"
      ? { characterId: r.id }
      : { definitionId: r.id, quantity: r.qty, hpMode: r.hpMode },
  );
}

/** FR-CBT-63: a pick adds quantity 1, or +1 if present (characters stay 1). */
export function addPick(
  rows: readonly AddRow[],
  pick: { id: string; name: string; kind: "monster" | "character" },
): AddRow[] {
  const at = rows.findIndex((r) => r.id === pick.id);
  if (at < 0) return [...rows, { ...pick, qty: 1, hpMode: "average" }];
  return rows.map((r, i) =>
    i === at && r.kind === "monster" ? { ...r, qty: Math.min(ADD_INSTANCES_MAX, r.qty + 1) } : r,
  );
}

export const instancesOf = (rows: readonly AddRow[]) => rows.reduce((n, r) => n + r.qty, 0);

export function AddForm() {
  const close = useCbtxDialogs((s) => s.close);
  const { send, disabled } = useCbtIntent();
  const enc = useStartedEncounter();
  const combatants = useCombatants(enc?.id);
  const entities = useRecords<unknown>("entity");
  const imported = useRecords<unknown>("imported-entity");
  const players = useRecords<PlayerRecord>("player");
  const tokens = useRecords<TokenRecord>("token");
  const scenes = useRecords<SceneRecord>("scene");
  const folders = useRecords<SceneFolderRecord>("scene-folder");
  const requested = useDmMap((s) => s.viewedSceneId);
  const viewed = viewedScene(scenes, folders, requested);
  const free = useFreeArea();
  const defs = useDefinitions();
  const options = useMemo(() => {
    const inCombat = new Set(combatants.filter((c) => c.kind === "pc").map((c) => c.entityId));
    return creatureRows(entities, imported, players, "all").filter(
      (r) => r.kind === "monster" || !inCombat.has(r.id),
    );
  }, [entities, imported, players, combatants]);
  const [rows, setRows] = useState<AddRow[]>([]);
  const [createTokens, setCreateTokens] = useState(true);
  const [hidden, setHidden] = useState(true);
  const scene = scenes.find((s) => s.id === enc?.sceneId) ?? null;
  const opts = addOptionsState({ createTokens, hasScene: scene !== null });
  const onOtherScene = scene !== null && viewed?.id !== scene.id;

  // Preview as Start: the encounter scene's tokens not bound to an active combatant.
  const sceneTokens = scene ? tokens.filter((t) => t.sceneId === scene.id) : [];
  const bound = new Set(combatants.map((c) => c.tokenId));
  const slots: JoinSlot[] = rows.flatMap((r) =>
    Array.from({ length: r.qty }, () => ({
      kind: r.kind === "character" ? ("pc" as const) : ("monster" as const),
      entityId: r.id,
      name: r.name,
      portraitAssetId: defs.get(r.id)?.portraitAssetId ?? null,
      hpMode: r.hpMode,
      hasFormula: Boolean(defs.get(r.id)?.statBlock.hpFormula),
    })),
  );
  const preview = previewJoin(
    slots,
    sceneTokens.filter((t) => !bound.has(t.id)),
    {
      createTokens: opts.creating,
      hidden,
      sceneTokenNames: sceneTokens.map((t) => t.name),
    },
  );
  const total = instancesOf(rows);
  const setRow = (id: string, f: (r: AddRow) => AddRow | null) =>
    setRows((rs) => rs.flatMap((r) => (r.id === id ? (f(r) ?? []) : [r])));

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add to combat</DialogTitle>
        <DialogDescription>
          Monsters roll initiative on the way in; characters roll on their sheet. Tokens bind in
          placement order.
        </DialogDescription>
      </DialogHeader>
      <CreatureLookup
        rows={options}
        testId="cbtx-add-picker"
        placeholder="Add monster or character…"
        onPick={(id) => {
          const o = options.find((x) => x.id === id);
          if (!o) return;
          const kind = o.kind === "character" ? "character" : "monster";
          setRows((rs) => addPick(rs, { id: o.id, name: o.name, kind }));
        }}
      />
      {rows.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {rows.map((r) => (
            <li
              key={r.id}
              data-testid="cbtx-add-row"
              data-record-id={r.id}
              className="flex items-center gap-2"
            >
              <span className="flex-1 truncate">{r.name}</span>
              {r.kind === "monster" && (
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label="One fewer"
                    disabled={r.qty <= 1}
                    onClick={() => setRow(r.id, (x) => ({ ...x, qty: x.qty - 1 }))}
                  >
                    <MinusIcon className="size-3.5" />
                  </Button>
                  <span
                    data-testid="cbtx-add-qty"
                    data-record-id={r.id}
                    data-value={r.qty}
                    className="w-5 text-center tabular-nums"
                  >
                    {r.qty}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label="One more"
                    disabled={r.qty >= ADD_INSTANCES_MAX}
                    onClick={() => setRow(r.id, (x) => ({ ...x, qty: x.qty + 1 }))}
                  >
                    <PlusIcon className="size-3.5" />
                  </Button>
                  <HpSelect
                    value={r.hpMode}
                    hasFormula={Boolean(defs.get(r.id)?.statBlock.hpFormula)}
                    disabled={false}
                    testId="cbtx-add-hp"
                    recordId={r.id}
                    onChange={(hpMode) => setRow(r.id, (x) => ({ ...x, hpMode }))}
                  />
                </>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                data-testid="cbtx-add-remove"
                data-record-id={r.id}
                aria-label={`Remove ${r.name}`}
                onClick={() => setRow(r.id, () => null)}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <div className="flex items-center gap-2">
          <Checkbox
            id="cbtx-add-create-tokens"
            data-testid="cbtx-add-create-tokens"
            disabled={opts.createDisabled}
            checked={opts.creating}
            onCheckedChange={(v) => setCreateTokens(v === true)}
          />
          <Label htmlFor="cbtx-add-create-tokens" className="font-normal">
            Create tokens
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="cbtx-add-hidden"
            data-testid="cbtx-add-hidden"
            disabled={opts.hiddenDisabled}
            checked={hidden}
            onCheckedChange={(v) => setHidden(v === true)}
          />
          <Label htmlFor="cbtx-add-hidden" className="font-normal">
            Add hidden
          </Label>
        </div>
        {scene === null && (
          <span className="text-xs text-muted-foreground">This encounter has no scene</span>
        )}
        {opts.creating && onOtherScene && (
          <span className="text-xs text-muted-foreground">Tokens go to {scene.name}</span>
        )}
      </div>
      {preview.length > 0 && (
        <ul className="flex max-h-56 flex-col gap-1 overflow-auto text-sm">
          {preview.map((b, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: one row per new combatant
            <JoinPreviewRow key={i} row={b} testId="cbtx-add-binding" />
          ))}
        </ul>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={() => setRows([])} disabled={rows.length === 0}>
          Clear
        </Button>
        <Button
          data-testid="cbtx-add-confirm"
          disabled={disabled || !enc || total === 0 || total > ADD_INSTANCES_MAX}
          onClick={async () => {
            if (!enc) return;
            // FR-CBT-65: `at` only while this tab views the encounter's scene.
            const at =
              scene && !onOtherScene && opts.creating ? freeAreaCell(free.area, scene) : null;
            const r = await send(CBTX_INTENTS.addCombatants, {
              encounterId: enc.id,
              items: addItems(rows),
              createTokens: opts.creating,
              ...(opts.creating ? { hidden } : {}),
              ...(at ? { at } : {}),
            });
            if (r !== undefined) close();
          }}
        >
          Add {total || ""}
        </Button>
      </DialogFooter>
    </>
  );
}

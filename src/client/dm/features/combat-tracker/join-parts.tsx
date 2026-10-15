// DM parts shared by the encounter builder / Start dialog (FR-CBT-62/64) and combat-extras' Add
// dialog (FR-CBTX-44): the HP Select (Rolled disabled without a formula) and a preview row.
import type { HpMode } from "@shared/combat-tracker/schemas";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
} from "@ui/components/ui/overlays";
import { Badge } from "@ui/components/ui/primitives";
import { EyeOffIcon } from "lucide-react";
import { hpLabel, type JoinBinding, type JoinRow } from "./join-preview";

export const NO_FORMULA = "No HP formula";

/** FR-CBT-62: Average / Rolled; Rolled disabled with Tooltip "No HP formula" (FR-ENT-25). */
export function HpSelect({
  value,
  hasFormula,
  disabled,
  onChange,
  testId,
  recordId,
}: {
  value: HpMode;
  hasFormula: boolean;
  disabled: boolean;
  onChange(v: HpMode): void;
  testId: string;
  recordId: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as HpMode)} disabled={disabled}>
      <SelectTrigger
        data-testid={testId}
        data-record-id={recordId}
        data-value={value}
        aria-label="HP"
        className="h-7 w-24 px-2 text-xs"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="average" data-value="average">
          Average
        </SelectItem>
        {hasFormula ? (
          <SelectItem value="rolled" data-value="rolled">
            Rolled
          </SelectItem>
        ) : (
          <Tooltip content={NO_FORMULA}>
            <SelectItem value="rolled" data-value="rolled" disabled>
              Rolled
            </SelectItem>
          </Tooltip>
        )}
      </SelectContent>
    </Select>
  );
}

const BINDING_LABEL: Record<JoinBinding, string> = {
  token: "token",
  new: "new token",
  none: "no token",
};

/** One preview line: name, binding ("token" / "new token" / "no token"), HP mode, eye-off. */
export function JoinPreviewRow({ row, testId }: { row: JoinRow; testId: string }) {
  const hp = hpLabel(row);
  return (
    <li
      data-testid={testId}
      data-value={row.binding}
      data-record-id={row.tokenId ?? ""}
      data-bound={row.tokenId !== null}
      data-hidden={row.hidden}
      className="flex items-center gap-2"
    >
      <span className="flex-1 truncate">{row.name}</span>
      {row.hidden && <EyeOffIcon className="size-3.5 text-visibility-hidden" aria-label="Hidden" />}
      {hp && <span className="text-xs text-muted-foreground">{hp}</span>}
      <Badge variant={row.binding === "token" ? "outline" : "secondary"}>
        {BINDING_LABEL[row.binding]}
      </Badge>
    </li>
  );
}

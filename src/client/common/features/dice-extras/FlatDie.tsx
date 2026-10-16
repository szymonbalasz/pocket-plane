// A flat die (FR-DICEX-21 `flat`, FR-DICEX-13 chips): the face at its server value in the
// roller's look. Dropped dice dimmed, MOD / offered dice labelled, physical dice badged.
import type { DiceLook } from "@shared/dice-extras/looks";
import { STYLE_LOOK } from "@shared/dice-extras/looks";
import type { ThrowDie } from "@shared/dice-extras/throw";
import { cn } from "../../lib/utils";

const SHAPE_RADIUS: Record<string, string> = {
  d4: "rounded-sm",
  d6: "rounded-md",
  d8: "rounded-lg",
  d10: "rounded-lg",
  d12: "rounded-xl",
  d20: "rounded-2xl",
};

export function FlatDie({
  die,
  look = STYLE_LOOK.ivory,
  size = "md",
  settled,
  flat = false,
}: {
  die: ThrowDie;
  look?: DiceLook;
  size?: "sm" | "md";
  /** At rest: `data-settled` carries the up-face (FR-DICEX-15; flat = the value). */
  settled?: boolean;
  /** Drawn by the flat renderer (FR-DICEX-21): every die is flat, not only chips. */
  flat?: boolean;
}) {
  const chip = die.shape === null;
  return (
    <span
      data-testid={settled === undefined ? "dicex-result-die" : "dicex-throw-die"}
      data-entry-id={die.entryId}
      data-faces={die.faces}
      data-value={die.value ?? ""}
      data-kept={die.kept}
      data-flat={die.flat || flat}
      data-offered={die.offered === true}
      {...(settled && { "data-settled": die.value ?? "" })}
      className="flex flex-col items-center gap-0.5"
    >
      <span
        className={cn(
          "relative flex items-center justify-center border font-bold tabular-nums shadow-sm",
          size === "sm" ? "h-7 min-w-7 px-1 text-xs" : "h-10 min-w-10 px-1.5 text-base",
          chip ? "rounded-full" : (SHAPE_RADIUS[die.shape as string] ?? "rounded-md"),
          !die.kept && "opacity-40 line-through",
          die.offered && "border-dashed",
        )}
        style={{ backgroundColor: look.body, color: look.pips, borderColor: look.pips }}
      >
        {die.sign === -1 && "−"}
        {die.face}
        {!chip && size === "md" && (
          <span className="absolute -bottom-1 right-0.5 text-[8px] font-normal opacity-70">
            {die.d100 === "tens" ? "%" : `d${die.faces === 100 ? 10 : die.faces}`}
          </span>
        )}
      </span>
      {(die.label || die.offered || die.physical) && size === "md" && (
        <span className="max-w-16 truncate text-[10px] leading-none text-muted-foreground">
          {die.physical ? "physical" : die.offered ? `${die.label ?? ""} on a hit` : die.label}
        </span>
      )}
    </span>
  );
}

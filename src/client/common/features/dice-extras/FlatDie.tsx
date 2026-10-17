// A flat die (FR-DICEX-21 `flat`, FR-DICEX-13 chips): the face at its server value in the
// roller's look (`data-style` / `data-material`, FR-DICEX-20), drawn as its die shape
// (FR-DICEX-42; only a sum without per-die values → round, physical dice keep their shape).
// Dropped dice dimmed, MOD / offered dice labelled, physical dice badged. The wrapper keeps the
// throw / result test IDs; the shape inside carries `dicex-die`.
import type { DiceLook } from "@shared/dice-extras/looks";
import { STYLE_LOOK } from "@shared/dice-extras/looks";
import type { ThrowDie } from "@shared/dice-extras/throw";
import { DieShape } from "./DieShape";

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
  return (
    <span
      data-testid={settled === undefined ? "dicex-result-die" : "dicex-throw-die"}
      data-entry-id={die.entryId}
      data-faces={die.faces}
      data-value={die.value ?? ""}
      data-kept={die.kept}
      data-flat={die.flat || flat}
      data-offered={die.offered === true}
      data-style={look.style}
      data-material={look.material}
      {...(settled && { "data-settled": die.value ?? "" })}
      className="flex flex-col items-center gap-0.5"
    >
      <DieShape
        faces={die.faces}
        value={die.value ?? 0}
        kept={die.kept}
        offered={die.offered === true}
        look={look}
        size={size}
        round={die.sum === true}
        part={die.d100}
        negative={die.sign === -1}
      />
      {(die.label || die.offered || die.physical) && size === "md" && (
        <span className="max-w-16 truncate text-[10px] leading-none text-muted-foreground">
          {die.physical ? "physical" : die.offered ? `${die.label ?? ""} on a hit` : die.label}
        </span>
      )}
    </span>
  );
}

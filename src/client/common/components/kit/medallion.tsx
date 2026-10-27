// Kit part: the Medallion (kit-parity FR-KIT-05, glossary "Medallion"): a round portrait, the image
// asset's thumbnail if there is one, else the name's first letter on a colour. One markup for
// every theme (FR-KIT-01); Simple Dark draws it with the plain tokens, a theme styles
// `data-slot="kit-medallion"` (ADR-0069). Decorative: the name always sits beside it. K9: a letter
// with no colour carries `data-tone="neutral"`, so a theme fills it (the kit's slate / blue) without
// structural selectors.
import { contrastRatio, isHexColor } from "@shared/campaign-management/colors";
import type * as React from "react";
import { AssetImg } from "../../features/assets-pipeline/AssetImg";
import { cn } from "../../lib/utils";

export type MedallionSize = "sm" | "md" | "lg";

/** FR-KIT-05 sizes in px: `sm` 22 (companions, targets), `md` 28 (log rows), `lg` 34 (rows, cards). */
export const MEDALLION_PX: Readonly<Record<MedallionSize, number>> = { sm: 22, md: 28, lg: 34 };

const SIZE: Readonly<Record<MedallionSize, string>> = {
  sm: "size-[22px] text-[11px]",
  md: "size-7 text-[13px]",
  lg: "size-[34px] text-[15px]",
};

/** What a medallion shows (kit-parity §8 `medallionOf`), derived from data the client holds. */
export interface MedallionSource {
  /** The name's first letter or digit, upper-cased; "?" for a name without one. */
  letter: string;
  imageAssetId: string | null;
  /** Any CSS colour (a player's hex, a `creature.*` token); null = the neutral muted colour. */
  colour: string | null;
}

export function medallionOf(
  name: string,
  imageAssetId?: string | null,
  colour?: string | null,
): MedallionSource {
  const letter = /[\p{L}\p{N}]/u.exec(name)?.[0]?.toLocaleUpperCase() ?? "?";
  return { letter, imageAssetId: imageAssetId || null, colour: colour || null };
}

/**
 * The letter's ink on `colour`: black (`swatch-ink`) on a light hex such as a player colour, else
 * the white glyph of the creature tokens (FR-ENT-28). Meaning colours, not themed (FR-THEME-09).
 */
export function medallionInk(colour: string): string {
  if (isHexColor(colour) && contrastRatio(colour, "#000000") > contrastRatio(colour, "#ffffff"))
    return "var(--swatch-ink)";
  return "var(--creature-glyph, #fff)";
}

export function Medallion({
  name,
  imageAssetId,
  colour,
  size = "md",
  className,
  "data-testid": testId = "kit-medallion",
  ...props
}: {
  name: string;
  imageAssetId?: string | null;
  colour?: string | null;
  size?: MedallionSize;
  "data-testid"?: string;
} & Omit<React.ComponentProps<"span">, "children" | "color">) {
  const m = medallionOf(name, imageAssetId, colour);
  return (
    <span
      aria-hidden
      data-testid={testId}
      data-slot="kit-medallion"
      data-size={size}
      data-image={m.imageAssetId ? "" : undefined}
      data-tone={!m.colour && !m.imageAssetId ? "neutral" : undefined}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full border font-semibold leading-none",
        SIZE[size],
        !m.colour && !m.imageAssetId && "bg-muted text-muted-foreground",
        className,
      )}
      style={
        m.colour && !m.imageAssetId
          ? { backgroundColor: m.colour, color: medallionInk(m.colour) }
          : undefined
      }
      {...props}
    >
      {m.imageAssetId ? (
        <AssetImg id={m.imageAssetId} file="thumb" alt="" className="size-full object-cover" />
      ) : (
        m.letter
      )}
    </span>
  );
}

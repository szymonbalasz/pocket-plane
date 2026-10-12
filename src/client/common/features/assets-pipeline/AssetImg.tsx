// DOM image from an asset ID (FR-ASSET-16): placeholder while loading, neutral broken-image
// placeholder on error (ASSET §7).
import type { AssetFile } from "@shared/assets-pipeline/schemas";
import { ImageOffIcon } from "lucide-react";
import { Skeleton } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { useAssetImage } from "./useAssetImage";

export function AssetImg({
  id,
  file,
  alt,
  className,
}: {
  id: string;
  file: AssetFile;
  alt: string;
  className?: string;
}) {
  const img = useAssetImage(id, file);
  if (img.state === "ready" && img.url) {
    return (
      <img
        src={img.url}
        alt={alt}
        data-state="ready"
        className={cn("object-contain", className)}
        draggable={false}
      />
    );
  }
  if (img.state === "error") {
    return (
      <div
        role="img"
        aria-label={`${alt} (unavailable)`}
        data-state="error"
        className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}
      >
        <ImageOffIcon className="size-6" />
      </div>
    );
  }
  return <Skeleton data-state="loading" className={className} />;
}
